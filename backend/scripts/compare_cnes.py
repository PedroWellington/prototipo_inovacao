"""Avaliação (só desenvolvimento): compara, num bairro, os hospitais do CNES (Ministério da Saúde) com os
estabelecimentos de CNAE hospitalar contados pelo CNPJ.

    docker compose run --rm backend python scripts/compare_cnes.py --ibge 2611606 --bairro Iputinga
O CNES traz latitude/longitude: a unidade é posta no bairro por ponto-em-polígono (ST_Contains), não pelo texto.
Arquivo: data/raw/cnes/cnes_estabelecimentos_csv.zip (OpenDataSUS). Resultado em docs/DATA.md ("CNES").
"""
import argparse
import csv
import hashlib
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.config import DATA_DIR  # noqa: E402
from app.db import engine  # noqa: E402

CNES_ZIP = DATA_DIR / "raw" / "cnes" / "cnes_estabelecimentos_csv.zip"
# Tipos de unidade do CNES equivalentes ao tipo "hospital" do catálogo (CNAE 8610-1/01 e 8610-1/02).
HOSPITAL_TYPES = {"05": "hospital geral", "07": "hospital especializado", "15": "unidade mista", "20": "pronto-socorro geral",
                  "21": "pronto-socorro especializado", "62": "hospital-dia", "73": "pronto atendimento"}


def rows(ibge6: str):
    with zipfile.ZipFile(CNES_ZIP) as z, z.open(z.namelist()[0]) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "latin-1"), delimiter=";"):
            if r["CO_IBGE"] == ibge6 and r["TP_UNIDADE"].zfill(2) in HOSPITAL_TYPES:
                yield r


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ibge", type=int, required=True)
    ap.add_argument("--bairro", required=True)
    args = ap.parse_args()
    units = list(rows(str(args.ibge)[:6]))  # o CNES usa o código IBGE de 6 dígitos

    with engine.connect() as c:
        nb = c.execute(text("SELECT id, name FROM neighborhoods WHERE municipality_ibge = :m AND name_normalized = norm_text(:b)"),
                       {"m": args.ibge, "b": args.bairro}).mappings().one()
        counted = {r[0]: r[1] for r in c.execute(text(
            "SELECT e.id, e.match_method FROM establishments e JOIN business_type_cnae t ON t.cnae = e.cnae_main "
            "WHERE t.business_type_key = 'hospital' AND e.neighborhood_id = :n"), {"n": nb["id"]})}
        in_city = {r[0]: r[1] for r in c.execute(text(
            "SELECT e.id, coalesce(n.name, '(não localizado)') FROM establishments e LEFT JOIN neighborhoods n ON n.id = e.neighborhood_id "
            "WHERE e.municipality_ibge = :m"), {"m": args.ibge})}
        inside = []
        for u in units:
            try:
                lat, lon = float(u["NU_LATITUDE"]), float(u["NU_LONGITUDE"])
            except ValueError:
                continue
            ok = c.execute(text("SELECT ST_Contains(geom, ST_SetSRID(ST_Point(:x, :y), 4326)) FROM neighborhoods WHERE id = :n"),
                           {"x": lon, "y": lat, "n": nb["id"]}).scalar()
            if ok:
                inside.append(u)

    print(f"\n{nb['name']}: CNPJ conta {len(counted)} estabelecimento(s) com CNAE hospitalar; "
          f"CNES tem {len(inside)} unidade(s) de tipo hospitalar com coordenada dentro do bairro.\n")
    print("| CNES | Tipo | Desativada? | CNPJ básico (unidade ou mantenedora) | Bairro no CNES | No CNPJ (VICUS) |")
    print("|---|---|---|---|---|---|")
    for u in inside:
        cnpj = u["NU_CNPJ"] or u["NU_CNPJ_MANTENEDORA"]
        h = hashlib.sha256(cnpj.encode()).hexdigest() if cnpj else None
        where = ("contado neste bairro" if h in counted else f"no CNPJ, outro CNAE/bairro: {in_city[h]}" if h in in_city
                 else "CNPJ da mantenedora ou fora do catálogo" if cnpj else "sem CNPJ no CNES")
        print(f"| {u['CO_CNES']} | {HOSPITAL_TYPES[u['TP_UNIDADE'].zfill(2)]} | {'sim' if u['CO_MOTIVO_DESAB'] else 'não'} | "
              f"{cnpj[:8] if cnpj else '—'} | {u['NO_BAIRRO']} | {where} |")


if __name__ == "__main__":
    main()
