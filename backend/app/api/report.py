"""Relatório em PDF, roteiro de visita e modo apresentação de uma cidade liberada.

POST /api/cities/{ibge}/report        -> PDF (kind: report | route | slides)
POST /api/cities/{ibge}/report/data   -> JSON do relatório para os slides (sem Google)
POST /api/cities/{ibge}/route         -> JSON do roteiro de 3 bairros (com Google, se ligado e dentro da cota)

O ranking é recalculado no servidor com os critérios da tela (mesmo motor, mesmo resultado). Nada do conteúdo vai
para log; o PDF é gerado em memória e não fica cópia. Endpoints síncronos: rodam no pool de threads do servidor,
fora do laço principal; o semáforo limita a REPORT_MAX_CONCURRENT gerações ao mesmo tempo.
"""
import re
import time
import unicodedata
from collections import defaultdict, deque
from itertools import permutations
from threading import BoundedSemaphore, Lock
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config, credits
from app.api.profile import CriteriaIn, validate_references
from app.auth.deps import CurrentUser, current_user
from app.auth.routes import client_ip
from app.db import get_data_db, get_db
from app.report import data as rdata
from app.report import extras, google_routes, pdf as rpdf

router = APIRouter(prefix="/api/cities", tags=["report"])

IP_LIMIT, IP_WINDOW = 20, 60.0
# shortcut: em memória, por processo; zera ao reiniciar e não soma entre funções da Vercel. Trocar por tabela/Redis se houver abuso.
_hits: dict[str, deque] = defaultdict(deque)
_lock = Lock()
_slots = BoundedSemaphore(config.REPORT_MAX_CONCURRENT)
CHECKLIST = [
    ("Movimento de pessoas", "Anote dia, horário e se o movimento é baixo, médio ou alto."),
    ("Estacionamento", "Vagas na rua, estacionamentos pagos e facilidade para parar."),
    ("Concorrentes visíveis", "Quantos você viu no caminho e em que ruas."),
    ("Acesso e transporte", "Pontos de ônibus, metrô e calçadas no entorno."),
]


def ip_allowed(ip: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > IP_WINDOW:
            q.popleft()
        if len(q) >= IP_LIMIT:
            return False
        q.append(now)
        return True


def clear_ip_limits() -> None:  # testes
    with _lock:
        _hits.clear()


class ReportIn(CriteriaIn):
    kind: Literal["report", "route", "slides"] = "report"
    neighborhoods: list[int] | None = Field(default=None, max_length=3)

    @model_validator(mode="after")
    def check_route(self):
        if self.kind == "route" and (not self.neighborhoods or len(set(self.neighborhoods)) != 3):
            raise ValueError("Marque 3 bairros diferentes para montar o roteiro.")
        return self


def err(status: int, code: str, message: str):
    raise HTTPException(status, {"code": code, "message": message})


def guard(request: Request, db: Session, user_id: int, ibge: int, body: CriteriaIn) -> None:
    if not config.PDF_ENABLED:
        err(404, "not_found", "Relatório desligado.")
    credits.require_city(db, user_id, ibge)
    if not body.criteria:
        err(422, "validation_error", "Adicione pelo menos um critério para gerar o relatório.")
    validate_references(db, body)
    if not ip_allowed(client_ip(request)):
        err(429, "rate_limited", "Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.")


def take_daily(db: Session, user_id: int) -> None:
    """Conta antes de gerar (atômico); devolve com give_back se a geração falhar."""
    got = db.execute(
        text(
            "INSERT INTO report_usage (user_id, day, reports) VALUES (:u, current_date, 1) "
            "ON CONFLICT (user_id, day) DO UPDATE SET reports = report_usage.reports + 1 "
            "WHERE report_usage.reports < :lim RETURNING reports"
        ),
        {"u": user_id, "lim": config.REPORT_DAILY_LIMIT},
    ).scalar()
    db.commit()
    if got is None:
        err(429, "daily_limit", f"Você chegou ao limite de {config.REPORT_DAILY_LIMIT} relatórios por dia. Ele volta amanhã.")


def give_back(db: Session, user_id: int) -> None:
    db.execute(text("UPDATE report_usage SET reports = reports - 1 WHERE user_id = :u AND day = current_date AND reports > 0"), {"u": user_id})
    db.commit()


def slot():
    if not _slots.acquire(timeout=20):
        err(503, "busy", "Muitos relatórios sendo gerados agora. Tente de novo em alguns segundos.")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-") or "cidade"


def hq_matrix(db: Session, d: dict) -> dict:
    """Relatório: origens = os bairros, destino = a sede (5 elementos). cells: índice do bairro -> {km, min}."""
    if not d["hq"]:
        return {"ok": False, "reason": "no_hq"}
    g = google_routes.matrix(db, [h["point"] for h in d["neighborhoods"]], [d["hq"]])
    if g["ok"]:
        g["cells"] = {i: c for (i, _), c in g["cells"].items()}
    return g


def straight_legs(data: Session, pts: list[dict]) -> dict:
    """Distâncias em linha reta (PostGIS, km) entre todos os pares de pontos."""
    rows = data.execute(
        text(
            """
            WITH p AS (SELECT i, ST_SetSRID(ST_MakePoint(x, y), 4326)::geography AS g
                       FROM unnest(CAST(:xs AS float8[]), CAST(:ys AS float8[])) WITH ORDINALITY AS t(x, y, i))
            SELECT a.i - 1 AS a, b.i - 1 AS b, ST_Distance(a.g, b.g) / 1000 AS km FROM p a CROSS JOIN p b
            """
        ),
        {"xs": [p["lng"] for p in pts], "ys": [p["lat"] for p in pts]},
    ).all()
    return {(r.a, r.b): round(r.km, 1) for r in rows}


def route_plan(db: Session, data: Session, d: dict) -> dict:
    """Ordem de visita dos 3 bairros: a que soma menos tempo de carro (Google) ou, sem ele, menos linha reta.
    Saída da sede quando há sede. Nada é guardado."""
    hoods = d["neighborhoods"]
    start = [d["hq"]] if d["hq"] else []
    pts = start + [h["point"] for h in hoods]
    off = len(start)
    straight = straight_legs(data, pts)
    g = google_routes.matrix(db, pts, [h["point"] for h in hoods]) if d["hq"] else {"ok": False, "reason": "no_hq"}
    car = g["cells"] if g["ok"] else {}

    def cost(order):
        legs = ([(None, order[0])] if start else []) + list(zip(order, order[1:]))
        if g["ok"]:
            return sum(car.get((0 if a is None else a + off, b), {"min": 10**6})["min"] for a, b in legs)
        return sum(straight[(0 if a is None else a + off, b + off)] for a, b in legs)

    # empate desfeito pela posição no ranking (ordem estável das permutações)
    order = min(permutations(range(len(hoods))), key=cost)
    stops = []
    prev = None
    for k, i in enumerate(order, 1):
        h = hoods[i]
        if prev is None and not start:
            leg = None
        else:
            a = 0 if prev is None else prev + off
            c = car.get((a, i))
            leg = {"from": d["hq"]["label"] if prev is None else hoods[prev]["name"],
                   "straight_km": straight[(a, i + off)],
                   "car_min": c["min"] if c else None, "car_km": c["km"] if c else None}
        stops.append({"order": k, "id": h["id"], "rank": h["rank"], "name": h["name"], "score": h["score"], "leg": leg})
        prev = i
    return {"google_ok": g["ok"], "google_reason": None if g["ok"] else g["reason"], "stops": stops,
            "basis": "tempo de carro (Google Maps)" if g["ok"] else ("distância em linha reta" if start or len(hoods) > 1 else "posição")}


def render(db: Session, data: Session, user_id: int, ibge: int, criteria: list[dict], kind: str,
           ids: list[int] | None = None) -> tuple[bytes, str]:
    d = rdata.build(db, data, user_id, ibge, criteria, ids=ids)
    shapes = rdata.city_shapes(data, ibge)
    if kind == "report":
        out = rpdf.render_report(d, shapes, hq_matrix(db, d))
        name = "relatorio"
    elif kind == "route":
        out = extras.render_route(d, shapes, route_plan(db, data, d), CHECKLIST)
        name = "roteiro"
    else:
        out = extras.render_slides(d, shapes)
        name = "apresentacao"
    return out, f"{config.PRODUCT_NAME}-{name}-{slug(d['city']['name'])}-{d['date']}.pdf"


@router.post("/{ibge}/report")
def report_pdf(ibge: int, body: ReportIn, request: Request, user: CurrentUser = Depends(current_user),
               db: Session = Depends(get_db), data: Session = Depends(get_data_db)):
    guard(request, db, user.id, ibge, body)
    take_daily(db, user.id)
    slot()
    try:
        pdf, name = render(db, data, user.id, ibge, [c.model_dump() for c in body.criteria], body.kind, body.neighborhoods)
    except BaseException:
        give_back(db, user.id)
        raise
    finally:
        _slots.release()
    if body.kind == "report":
        cost = credits.settings(db).get("report_cost", 0)
        if cost:  # configurável em credit_settings; padrão 0 (cidade liberada não paga relatório)
            credits._spend(db, user.id, cost, "report", ibge=ibge)
            db.commit()
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/{ibge}/report/data")
def report_data(ibge: int, body: CriteriaIn, request: Request, user: CurrentUser = Depends(current_user),
                db: Session = Depends(get_db), data: Session = Depends(get_data_db)):
    """Os mesmos dados do PDF (sem Google), para o modo apresentação."""
    guard(request, db, user.id, ibge, body)
    d = rdata.build(db, data, user.id, ibge, [c.model_dump() for c in body.criteria])
    return {**d, "legal": rpdf.LEGAL, "legal_app": rpdf.LEGAL_APP, "not_advice": rpdf.NOT_ADVICE}


@router.post("/{ibge}/route")
def route(ibge: int, body: ReportIn, request: Request, user: CurrentUser = Depends(current_user),
          db: Session = Depends(get_db), data: Session = Depends(get_data_db)):
    if not body.neighborhoods or len(set(body.neighborhoods)) != 3:
        err(422, "validation_error", "Marque 3 bairros diferentes para montar o roteiro.")
    guard(request, db, user.id, ibge, body)
    take_daily(db, user.id)  # usa o Google: conta no limite diário
    try:
        d = rdata.build(db, data, user.id, ibge, [c.model_dump() for c in body.criteria], ids=body.neighborhoods)
        plan = route_plan(db, data, d)
    except BaseException:
        give_back(db, user.id)
        raise
    by_id = {h["id"]: h for h in d["neighborhoods"]}
    for s in plan["stops"]:
        h = by_id[s["id"]]
        s |= {"population": h["population"], "competition": h["competition"],
              "criteria": [{"type": c["type"], "name_plural": c["name_plural"], "n": c["n"], "direction": c["direction"]} for c in h["criteria"]]}
    return {"city": d["city"], "hq": d["hq"], "params_code": d["params_code"], "generated_label": d["generated_label"],
            "competitor": d["competitor"], "reference_dates": d["reference_dates"], **plan,
            "checklist": [{"title": t, "hint": h} for t, h in CHECKLIST],
            "unavailable": None if plan["google_ok"] else "Tempo de deslocamento indisponível neste roteiro.",
            "attribution": google_routes.ATTRIBUTION if plan["google_ok"] else None,
            "legal": rpdf.LEGAL, "legal_app": rpdf.LEGAL_APP}
