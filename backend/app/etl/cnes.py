"""CNES (Ministério da Saúde): unidades ativas dos tipos mapeados em business_type_cnes.csv -> health_units.

    docker compose run --rm backend python -m app.etl.cnes      # também roda dentro de load_br (etapa nacional)
Só entram unidades sem motivo de desativação e dos TP_UNIDADE mapeados (hoje: hospital). Não guarda nome, telefone
nem responsável. Município pelo código IBGE de 6 dígitos do CNES; bairro/área pela coordenada (ST_Contains), não pelo
texto. Coordenada ausente ou fora do município: a unidade conta na cidade, mas em nenhum bairro. Ver docs/DATA.md.
"""
import csv
import io
import zipfile
from datetime import date

from sqlalchemy import text

from app.config import DATA_DIR
from app.etl.sources import CNES_URL, download


def load(conn) -> dict:
    path = download(CNES_URL, DATA_DIR / "raw" / "cnes" / CNES_URL.rsplit("/", 1)[1])
    tps = {r[0] for r in conn.execute(text("SELECT DISTINCT tp_unidade FROM business_type_cnes"))}
    rows = []
    with zipfile.ZipFile(path) as z:
        info = z.infolist()[0]
        reference = date(*info.date_time[:3]).isoformat()  # data de geração do arquivo pelo OpenDataSUS
        with z.open(info) as f:
            for r in csv.DictReader(io.TextIOWrapper(f, "latin-1"), delimiter=";"):
                if r["CO_MOTIVO_DESAB"] or r["TP_UNIDADE"].zfill(2) not in tps:
                    continue
                try:
                    lon, lat = float(r["NU_LONGITUDE"]), float(r["NU_LATITUDE"])
                except ValueError:
                    lon = lat = None
                rows.append({"c": r["CO_CNES"], "t": r["TP_UNIDADE"].zfill(2), "m": r["CO_IBGE"], "x": lon, "y": lat})

    conn.execute(text("CREATE TEMP TABLE raw_cnes (cnes text, tp text, ibge6 text, lon float, lat float) ON COMMIT DROP"))
    conn.execute(text("INSERT INTO raw_cnes VALUES (:c, :t, :m, :x, :y)"), rows)
    conn.execute(text("TRUNCATE health_units"))
    inserted = conn.execute(
        text(
            """
            INSERT INTO health_units (cnes, tp_unidade, municipality_ibge, neighborhood_id)
            SELECT DISTINCT ON (r.cnes) r.cnes, r.tp, m.ibge,
                   (SELECT n.id FROM neighborhoods n
                    WHERE n.municipality_ibge = m.ibge AND r.lon IS NOT NULL AND r.lon <> 0
                      AND ST_Contains(n.geom, ST_SetSRID(ST_Point(r.lon, r.lat), 4326))
                    ORDER BY n.id LIMIT 1)
            FROM raw_cnes r JOIN municipalities m ON left(m.ibge::text, 6) = r.ibge6
            ORDER BY r.cnes
            """
        )
    ).rowcount
    located = conn.execute(text("SELECT count(*) FROM health_units WHERE neighborhood_id IS NOT NULL")).scalar()
    conn.execute(
        text(
            "INSERT INTO data_sources VALUES ('ms_cnes', :n, :u, :d, NULL) "
            "ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, reference_date = EXCLUDED.reference_date"
        ),
        {"n": "Ministério da Saúde, CNES (Cadastro Nacional de Estabelecimentos de Saúde), OpenDataSUS", "u": CNES_URL, "d": reference},
    )
    return {"read": len(rows), "units": inserted, "located": located, "reference": reference}


def main() -> None:
    from app.db import engine
    from app.etl.counts import refresh_views

    with engine.begin() as c:
        print(load(c))
        refresh_views(c)


if __name__ == "__main__":
    main()
