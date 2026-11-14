"""Avaliação (só desenvolvimento): o CNES serve de fonte principal para os tipos de saúde?

    docker compose run --rm backend python scripts/evaluate_cnes.py
Compara, por município, as unidades ATIVAS do CNES (sem motivo de desativação) de cada tipo de unidade com a
contagem do CNPJ (locais distintos, municipality_type_counts). Mede também a qualidade das coordenadas do CNES
(preenchidas e dentro do município). Resultado em docs/DATA.md ("CNES").
"""
import csv
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.config import DATA_DIR  # noqa: E402
from app.db import engine  # noqa: E402

CNES_ZIP = DATA_DIR / "raw" / "cnes" / "cnes_estabelecimentos_csv.zip"
# Tipo do catálogo -> tipos de unidade do CNES que correspondem a ele (tabela TP_UNIDADE do CNES).
CANDIDATES = {
    "hospital": ["05", "07", "15", "62", "20", "21"],  # hospital geral/especializado, unidade mista, hospital-dia, pronto-socorro
    "clinica": ["04", "36"],  # policlínica, clínica/centro de especialidade
    "laboratorio": ["39"],  # unidade de apoio diagnose e terapia (SADT): laboratório E imagem, terapia...
}
SAMPLE = [2600807, 2604106, 2611606, 3550308, 3304557, 5300108]  # Altinho, Caruaru, Recife, São Paulo, Rio, Brasília


def main() -> None:
    with engine.begin() as c:
        c.execute(text("CREATE TEMP TABLE cnes (cnes text, ibge6 text, tp text, lon float, lat float, active bool, has_cnpj bool) ON COMMIT DROP"))
        rows = []
        with zipfile.ZipFile(CNES_ZIP) as z, z.open(z.namelist()[0]) as f:
            for r in csv.DictReader(io.TextIOWrapper(f, "latin-1"), delimiter=";"):
                try:
                    lat, lon = float(r["NU_LATITUDE"] or "nan"), float(r["NU_LONGITUDE"] or "nan")
                except ValueError:
                    lat = lon = float("nan")
                rows.append({"c": r["CO_CNES"], "m": r["CO_IBGE"], "t": r["TP_UNIDADE"].zfill(2),
                             "x": None if lon != lon else lon, "y": None if lat != lat else lat,
                             "a": not r["CO_MOTIVO_DESAB"], "j": bool(r["NU_CNPJ"])})
        c.execute(text("INSERT INTO cnes VALUES (:c, :m, :t, :x, :y, :a, :j)"), rows)
        total = c.execute(text("SELECT count(*), count(*) FILTER (WHERE active) FROM cnes")).one()
        print(f"CNES: {total[0]:,} unidades, {total[1]:,} ativas\n")

        for key, tps in CANDIDATES.items():
            q = c.execute(
                text(
                    """
                    WITH cn AS (
                      SELECT m.ibge, count(*) AS n,
                             count(*) FILTER (WHERE x.lon IS NOT NULL AND x.lat IS NOT NULL AND x.lon <> 0) AS with_coord,
                             count(*) FILTER (WHERE ST_Contains(ST_Transform(m.geom_high, 4326), ST_SetSRID(ST_Point(x.lon, x.lat), 4326))) AS inside
                      FROM cnes x JOIN municipalities m ON left(m.ibge::text, 6) = x.ibge6
                      WHERE x.active AND x.tp = ANY(:tps) GROUP BY m.ibge
                    ), cj AS (
                      SELECT municipality_ibge AS ibge, n_establishments AS n FROM municipality_type_counts WHERE business_type_key = :k
                    ), j AS (
                      SELECT coalesce(cn.ibge, cj.ibge) AS ibge, coalesce(cn.n, 0) AS cnes, coalesce(cj.n, 0) AS cnpj,
                             coalesce(cn.with_coord, 0) AS with_coord, coalesce(cn.inside, 0) AS inside
                      FROM cn FULL JOIN cj ON cj.ibge = cn.ibge
                    )
                    SELECT sum(cnes) AS cnes, sum(cnpj) AS cnpj, sum(with_coord) AS with_coord, sum(inside) AS inside,
                           corr(cnes, cnpj) AS corr,
                           count(*) FILTER (WHERE cnpj > 2 * cnes + 2) AS cnpj_much_higher,
                           count(*) FILTER (WHERE cnes > 2 * cnpj + 2) AS cnes_much_higher,
                           count(*) AS munis,
                           json_object_agg(ibge, json_build_array(cnes, cnpj)) FILTER (WHERE ibge = ANY(:sample)) AS sample
                    FROM j
                    """
                ),
                {"tps": tps, "k": key, "sample": SAMPLE},
            ).mappings().one()
            names = dict(c.execute(text("SELECT ibge, name FROM municipalities WHERE ibge = ANY(:s)"), {"s": SAMPLE}).all())
            print(f"## {key} (CNES TP_UNIDADE {', '.join(tps)})")
            print(f"- unidades CNES ativas: {q['cnes']:,}; locais no CNPJ: {q['cnpj']:,}; correlação por município: {q['corr']:.2f}")
            print(f"- coordenadas: {q['with_coord']:,} preenchidas, {q['inside']:,} dentro do município ({q['inside'] / max(q['cnes'], 1):.1%})")
            print(f"- municípios com CNPJ muito acima do CNES (> 2× + 2): {q['cnpj_much_higher']}; CNES muito acima do CNPJ: {q['cnes_much_higher']} (de {q['munis']})")
            for ibge, (a, b) in sorted((q["sample"] or {}).items()):
                print(f"  - {names.get(int(ibge), ibge)}: CNES {a}, CNPJ {b}")
            print()


if __name__ == "__main__":
    main()
