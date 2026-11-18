"""Relatório em PDF, roteiro e modo apresentação. Nenhum teste chama o Google: `google_routes.post` é sempre um falso."""
import io
import re

import pytest
from pypdf import PdfReader
from sqlalchemy import text

from app import config
from app.api import report as report_api
from app.db import engine
from app.report import google_routes
from tests.test_scoring import FARMACIA, HOSPITAL, RECIFE, city  # noqa: F401 (fixture autouse da cidade de 4 bairros)
from tests.helpers import grant, login_new_user, unlock_city

FORBIDDEN = re.compile(r"melhor(es)? (bairro|cidade|ponto)|garantid[oa]|recomend(o|amos)|ideal para voc|100\s?% preciso|"
                       r"protótipo|lucro (certo|garantido)", re.IGNORECASE)
CRIT = {"criteria": [HOSPITAL, FARMACIA]}


class FakeGoogle:
    def __init__(self, status=200):
        self.calls, self.status = [], status

    def __call__(self, body):
        self.calls.append(body)
        n_o, n_d = len(body["origins"]), len(body["destinations"])
        cells = [{"originIndex": i, "destinationIndex": j, "condition": "ROUTE_EXISTS", "distanceMeters": 1000 * (i + j + 1),
                  "duration": f"{600 * (i + j + 1)}s"} for i in range(n_o) for j in range(n_d)]
        return type("R", (), {"status_code": self.status, "json": lambda self_: cells})()


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    def never(_):  # se algo escapar do falso, o teste quebra em vez de ir à rede
        raise AssertionError("chamada real ao Google")
    monkeypatch.setattr(google_routes, "post", never)
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", "")
    report_api.clear_ip_limits()
    with engine.begin() as c:
        c.execute(text("DELETE FROM google_routes_usage; DELETE FROM report_usage"))
        # população para o relatório (do Censo no ETL real)
        c.execute(text("UPDATE neighborhoods SET population = 1000, population_method = 'ibge_bairro' WHERE name <> 'Delta'"))


def setup_user(client, hq=True):
    csrf = login_new_user(client)
    r = client.put("/api/profile", headers={"X-CSRF-Token": csrf}, json={
        "company_name": "Loja <b>Teste</b>", "segment_key": "farmacia", "revenue_band": "81k_360k", "has_hq": hq,
        "hq_uf": "PE" if hq else None, "hq_municipality_ibge": RECIFE if hq else None, "hq_neighborhood_text": "beta" if hq else None,
        **CRIT})
    assert r.status_code == 200, r.text
    unlock_city(client, csrf, RECIFE)
    return csrf


def pdf_of(client, csrf, **extra):
    return client.post(f"/api/cities/{RECIFE}/report", json={**CRIT, **extra}, headers={"X-CSRF-Token": csrf})


def text_of(content: bytes) -> tuple[PdfReader, str]:
    reader = PdfReader(io.BytesIO(content))
    return reader, "\n".join(p.extract_text() for p in reader.pages)


def test_report_pdf_structure_and_language(client):
    csrf = setup_user(client)
    r = pdf_of(client, csrf)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.headers["cache-control"] == "no-store"
    assert re.search(r'filename="\w+-relatorio-Recife-\d{4}-\d{2}-\d{2}\.pdf"', r.headers["content-disposition"])
    assert len(r.content) < 2 * 1024 * 1024
    reader, txt = text_of(r.content)
    # capa, resumo, critérios, 4 bairros (a cidade de teste só tem 4), método, fontes
    assert len(reader.pages) == 9
    assert reader.metadata.title == "Relatório de localização"
    assert reader.trailer["/Root"]["/Lang"] == "pt-BR"
    fonts = set()
    for p in reader.pages:
        for f in (p["/Resources"].get("/Font") or {}).values():
            fd = f.get_object()["/DescendantFonts"][0].get_object()["/FontDescriptor"]
            assert "/FontFile2" in fd  # fonte embutida
            fonts.add(str(f.get_object()["/BaseFont"]))
    assert any("Inter" in f for f in fonts)
    flat = " ".join(txt.split())
    assert "4 bairros que mais combinam com os seus critérios" in flat
    assert "Loja <b>Teste</b>" in flat  # texto puro: nada é interpretado como marcação
    assert not FORBIDDEN.findall(txt), FORBIDDEN.findall(txt)
    assert "Não garante resultado, faturamento nem lucro" in flat
    assert "Não constituem aconselhamento jurídico nem financeiro" in flat
    # Delta sem população: mensagem padrão, nunca um número inventado
    assert "Não foi possível encontrar dados de população desta área." in flat
    assert "Tempo de deslocamento indisponível neste relatório." in flat
    assert "Google" not in flat.replace("sem Google", "")  # sem chave: nada do Google


def test_contributions_add_up_to_the_score(client):
    from app.scoring.rank import rank
    with engine.connect() as c:
        res = rank(c, RECIFE, [HOSPITAL, FARMACIA])
    for n in res["neighborhoods"]:
        assert n["score"] == pytest.approx(50 + sum(c["contribution"] for c in n["criteria"]), abs=0.15)
    alfa = res["neighborhoods"][0]
    assert [c["position"] for c in alfa["criteria"]] == [1, 4]  # mais hospitais; mais farmácias (longe -> último)


def test_params_code_is_reproducible():
    from app.report.data import params_code
    a = params_code(RECIFE, [HOSPITAL, FARMACIA], "v1")
    assert a == params_code(RECIFE, [FARMACIA, HOSPITAL], "v1")
    assert a != params_code(RECIFE, [{**HOSPITAL, "weight": 2}, FARMACIA], "v1")
    assert a != params_code(RECIFE, [HOSPITAL, FARMACIA], "v2")
    assert re.fullmatch(r"[0-9A-F]{5}-[0-9A-F]{5}", a)


def test_google_used_once_counted_and_attributed(client, monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(google_routes, "post", fake)
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", "chave-de-teste")
    csrf = setup_user(client)
    r = pdf_of(client, csrf)
    assert r.status_code == 200, r.text
    assert len(fake.calls) == 1  # uma chamada em lote
    body = fake.calls[0]
    assert len(body["origins"]) == 4 and len(body["destinations"]) == 1
    assert body["routingPreference"] == "TRAFFIC_UNAWARE" and body["travelMode"] == "DRIVE"
    with engine.connect() as c:
        assert c.execute(text("SELECT elements, requests FROM google_routes_usage")).one() == (4, 1)
        # nada do Google gravado: a tabela só tem contagens
        cols = [r[0] for r in c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'google_routes_usage'"))]
        assert sorted(cols) == ["elements", "month", "requests"]
    _, txt = text_of(r.content)
    flat = " ".join(txt.split())
    assert "Fonte: Google Maps" in flat and "10 min" in flat


def test_cap_at_80_percent_degrades_without_calling(client, monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(google_routes, "post", fake)
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", "chave-de-teste")
    monkeypatch.setattr(config, "GOOGLE_ROUTES_MONTHLY_FREE", 100)  # trava = 80
    with engine.begin() as c:
        c.execute(text(f"INSERT INTO google_routes_usage VALUES ({google_routes.MONTH_SQL}, 78, 10)"))
    csrf = setup_user(client)
    r = pdf_of(client, csrf)
    assert r.status_code == 200
    assert fake.calls == []  # 78 + 4 > 80: não chama
    with engine.connect() as c:
        assert c.execute(text("SELECT elements FROM google_routes_usage")).scalar() == 78
    assert "Tempo de deslocamento indisponível neste relatório." in " ".join(text_of(r.content)[1].split())


def test_reserve_never_passes_the_cap(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_ROUTES_MONTHLY_FREE", 10)  # trava = 8
    from app.db import SessionLocal
    with SessionLocal() as db:
        assert google_routes.reserve(db, 5) and google_routes.reserve(db, 3)
        assert not google_routes.reserve(db, 1)
        assert google_routes.used(db) == 8


def test_google_error_never_breaks_the_report(client, monkeypatch):
    monkeypatch.setattr(google_routes, "post", FakeGoogle(status=500))
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", "chave-de-teste")
    csrf = setup_user(client)
    r = pdf_of(client, csrf)
    assert r.status_code == 200
    assert "Tempo de deslocamento indisponível neste relatório." in " ".join(text_of(r.content)[1].split())


def test_daily_limit_and_locked_city(client, monkeypatch):
    monkeypatch.setattr(config, "REPORT_DAILY_LIMIT", 1)
    csrf = setup_user(client)
    assert pdf_of(client, csrf).status_code == 200
    r = pdf_of(client, csrf)
    assert r.status_code == 429 and r.json()["error"]["code"] == "daily_limit"
    other = login_new_user(client, "bia@example.com")
    r = client.post(f"/api/cities/{RECIFE}/report", json=CRIT, headers={"X-CSRF-Token": other})
    assert r.status_code == 402


def test_ip_limit(client, monkeypatch):
    monkeypatch.setattr(report_api, "IP_LIMIT", 2)
    csrf = setup_user(client)
    for _ in range(2):
        assert client.post(f"/api/cities/{RECIFE}/report/data", json=CRIT, headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.post(f"/api/cities/{RECIFE}/report/data", json=CRIT, headers={"X-CSRF-Token": csrf}).status_code == 429


def test_report_is_free_by_default_and_cost_is_configurable(client):
    from app import credits
    csrf = setup_user(client)
    with engine.connect() as c:
        uid = c.execute(text("SELECT id FROM users WHERE email = 'ana@example.com'")).scalar()
        before = credits.balance(c, uid)
    assert pdf_of(client, csrf).status_code == 200
    with engine.begin() as c:
        assert credits.balance(c, uid) == before
        c.execute(text("UPDATE credit_settings SET value = 1 WHERE key = 'report_cost'"))
    try:
        grant("ana@example.com", 1)
        assert pdf_of(client, csrf).status_code == 200
        with engine.connect() as c:
            assert credits.balance(c, uid) == before  # +1 concedido, -1 do relatório
    finally:
        with engine.begin() as c:
            c.execute(text("UPDATE credit_settings SET value = 0 WHERE key = 'report_cost'"))


def test_route_three_neighborhoods_with_google_order(client, monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(google_routes, "post", fake)
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", "chave-de-teste")
    csrf = setup_user(client)
    ranking = client.post(f"/api/cities/{RECIFE}/rank", json=CRIT, headers={"X-CSRF-Token": csrf}).json()
    ids = [n["id"] for n in ranking["neighborhoods"][:3]]
    r = client.post(f"/api/cities/{RECIFE}/route", json={**CRIT, "neighborhoods": ids}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["google_ok"] and out["attribution"] == "Google Maps"
    assert sorted(s["id"] for s in out["stops"]) == sorted(ids) and [s["order"] for s in out["stops"]] == [1, 2, 3]
    assert len(fake.calls[0]["origins"]) == 4 and len(fake.calls[0]["destinations"]) == 3  # 12 elementos
    assert all(s["leg"]["car_min"] for s in out["stops"])
    assert [c["title"] for c in out["checklist"]][:3] == ["Movimento de pessoas", "Estacionamento", "Concorrentes visíveis"]
    pdf = client.post(f"/api/cities/{RECIFE}/report", json={**CRIT, "kind": "route", "neighborhoods": ids}, headers={"X-CSRF-Token": csrf})
    assert pdf.status_code == 200
    reader, txt = text_of(pdf.content)
    assert len(reader.pages) == 4 and not FORBIDDEN.findall(txt)
    bad = client.post(f"/api/cities/{RECIFE}/route", json={**CRIT, "neighborhoods": ids[:2]}, headers={"X-CSRF-Token": csrf})
    assert bad.status_code == 422


def test_route_without_google_uses_straight_line(client):
    csrf = setup_user(client, hq=False)
    ranking = client.post(f"/api/cities/{RECIFE}/rank", json=CRIT, headers={"X-CSRF-Token": csrf}).json()
    ids = [n["id"] for n in ranking["neighborhoods"][:3]]
    out = client.post(f"/api/cities/{RECIFE}/route", json={**CRIT, "neighborhoods": ids}, headers={"X-CSRF-Token": csrf}).json()
    assert not out["google_ok"] and out["unavailable"] == "Tempo de deslocamento indisponível neste roteiro."
    assert out["stops"][0]["leg"] is None


def test_slides_data_and_pdf_carry_the_same_legal_notes(client):
    csrf = setup_user(client)
    d = client.post(f"/api/cities/{RECIFE}/report/data", json=CRIT, headers={"X-CSRF-Token": csrf}).json()
    assert d["legal"].startswith("Este relatório organiza dados públicos") and "aconselhamento jurídico" in d["legal_app"]
    assert len(d["neighborhoods"]) == 4 and d["params_code"]
    r = client.post(f"/api/cities/{RECIFE}/report", json={**CRIT, "kind": "slides"}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    reader, txt = text_of(r.content)
    flat = " ".join(txt.split())
    assert reader.pages[0].mediabox.width > reader.pages[0].mediabox.height  # paisagem
    assert "Não garante resultado" in flat and "Não é uma recomendação" in flat and not FORBIDDEN.findall(txt)
