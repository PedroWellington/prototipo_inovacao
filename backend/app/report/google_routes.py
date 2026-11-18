"""Routes API (computeRouteMatrix, SKU Essentials): tempo e distância de carro. Regras em docs/GOOGLE-MAPS.md.

- Só no servidor; a chave vem de GOOGLE_MAPS_API_KEY. Sem chave = desligado (o relatório usa a linha reta).
- Antes de chamar, reserva os elementos no contador do mês (uma instrução SQL atômica que só soma abaixo da trava).
  Falhou depois de reservar: a reserva fica (o Google pode ter cobrado). Nunca passa da trava.
- Nada da resposta é gravado. Logs só com o tipo do erro e o código HTTP.
"""
import logging
import re

import httpx
from sqlalchemy import text

from app import config

log = logging.getLogger(__name__)
URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
FIELDS = "originIndex,destinationIndex,status,condition,distanceMeters,duration"
# Mês de cobrança do Google (fuso do Pacífico).
MONTH_SQL = "date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date"
ATTRIBUTION = "Google Maps"


def enabled() -> bool:
    return bool(config.GOOGLE_MAPS_API_KEY)


def cap() -> int:
    return int(config.GOOGLE_ROUTES_MONTHLY_FREE * config.GOOGLE_ROUTES_CAP_SHARE)


def reserve(db, elements: int) -> bool:
    """Soma `elements` ao mês se couber abaixo da trava; devolve False (e não soma) se não couber."""
    got = db.execute(
        text(
            f"INSERT INTO google_routes_usage (month, elements, requests) SELECT {MONTH_SQL}, :n, 1 WHERE :n <= :cap "
            "ON CONFLICT (month) DO UPDATE SET elements = google_routes_usage.elements + :n, requests = google_routes_usage.requests + 1 "
            "WHERE google_routes_usage.elements + :n <= :cap RETURNING elements"
        ),
        {"n": elements, "cap": cap()},
    ).scalar()
    db.commit()
    return got is not None


def used(db) -> int:
    return int(db.execute(text(f"SELECT coalesce((SELECT elements FROM google_routes_usage WHERE month = {MONTH_SQL}), 0)")).scalar())


def _waypoint(p: dict) -> dict:
    return {"waypoint": {"location": {"latLng": {"latitude": round(p["lat"], 6), "longitude": round(p["lng"], 6)}}}}


def post(body: dict) -> httpx.Response:
    """Ponto único da rede (os testes trocam esta função por um falso)."""
    return httpx.post(URL, json=body, timeout=config.GOOGLE_ROUTES_TIMEOUT_SECONDS,
                      headers={"X-Goog-Api-Key": config.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": FIELDS})


def matrix(db, origins: list[dict], destinations: list[dict]) -> dict:
    """{"ok": True, "cells": {(i, j): {"km", "min"}}} ou {"ok": False, "reason": ...}. Nunca levanta exceção."""
    if not enabled():
        return {"ok": False, "reason": "disabled"}
    n = len(origins) * len(destinations)
    if not n:
        return {"ok": False, "reason": "empty"}
    if not reserve(db, n):
        return {"ok": False, "reason": "quota"}
    body = {"origins": [_waypoint(o) for o in origins], "destinations": [_waypoint(d) for d in destinations],
            "travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE"}
    try:
        r = post(body)
    except httpx.HTTPError as e:
        log.warning("routes: falha de rede (%s)", type(e).__name__)
        return {"ok": False, "reason": "error"}
    if r.status_code != 200:
        log.warning("routes: Google respondeu %s", r.status_code)
        return {"ok": False, "reason": "error"}
    try:
        cells = {}
        for e in r.json():
            if e.get("condition") != "ROUTE_EXISTS" or (e.get("status") or {}).get("code", 0) != 0:
                continue
            secs = int(re.fullmatch(r"(\d+)s", e["duration"]).group(1))
            cells[(e.get("originIndex", 0), e.get("destinationIndex", 0))] = {
                "km": round(e.get("distanceMeters", 0) / 1000, 1), "min": max(1, round(secs / 60))}
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("routes: resposta inválida (%s)", type(e).__name__)
        return {"ok": False, "reason": "error"}
    return {"ok": True, "cells": cells}


UNAVAILABLE = "Tempo de deslocamento indisponível neste relatório."
