"""Estabelecimentos ativos de uma UF (ou de alguns municípios dela) a partir da base pública do CNPJ.

Layout conferido no PDF oficial (docs/DATA.md): CSV sem cabeçalho, ';', ISO-8859-1, 30 colunas.
Lê cada .zip em streaming (sem descompactar em disco) e filtra a UF ANTES de gravar. Uma única passada
pelos 10 arquivos serve para todos os municípios da UF. Os .zip ficam em data/raw e nunca são apagados.
"""
import csv
import hashlib
import zipfile
from pathlib import Path

from sqlalchemy import text

from app.config import DATA_DIR
from app.etl.sources import RFB_SHARE_TOKEN, RFB_WEBDAV, download

# Posições (0-based) no layout oficial de ESTABELECIMENTOS.
COL_CNPJ_BASICO, COL_CNPJ_ORDEM, COL_CNPJ_DV = 0, 1, 2
COL_SITUACAO = 5
COL_CNAE_PRINCIPAL = 11
COL_BAIRRO, COL_CEP, COL_UF, COL_MUNICIPIO = 17, 18, 19, 20
N_COLUMNS = 30
SITUACAO_ATIVA = 2  # "2 – ATIVA" (no arquivo vem "02")
N_FILES = 10  # Estabelecimentos0.zip … Estabelecimentos9.zip
# Nome da Receita ≠ nome do IBGE (grafia): aceita o melhor candidato da UF acima deste limiar, se único.
NAME_SIMILARITY = 0.5


def fetch(month: str, local_path: str | None, name: str) -> Path:
    folder = Path(local_path) if local_path else DATA_DIR / "raw" / "cnpj" / month
    path = folder / f"{name}.zip"
    if local_path and not path.exists():
        raise FileNotFoundError(f"{path} não encontrado em --local-path.")
    return download(f"{RFB_WEBDAV}/{month}/{name}.zip", path, auth=(RFB_SHARE_TOKEN, ""))


def read_zip_lines(path: Path):
    with zipfile.ZipFile(path) as z:
        for member in z.namelist():
            with z.open(member) as f:
                yield from f


def map_rfb_codes(conn, uf: str) -> list[dict]:
    """Código do município da Receita (TOM) -> código IBGE, só para os códigos que aparecem na UF.

    A tabela Municipios da Receita não tem UF; como cada linha de estabelecimento traz a UF, basta casar
    os nomes dentro da UF: primeiro exato (normalizado), depois o candidato único mais parecido."""
    conn.execute(
        text(
            """
            INSERT INTO rfb_map (code, name, ibge, method)
            SELECT s.code, r.name, m.ibge, 'exact'
            FROM (SELECT DISTINCT rfb_mun AS code FROM stage_est) s
            JOIN rfb_names r ON r.code = s.code
            JOIN municipalities m ON m.uf = :uf AND m.name_normalized = norm_text(r.name)
            """
        ),
        {"uf": uf},
    )
    conn.execute(
        text(
            """
            INSERT INTO rfb_map (code, name, ibge, method)
            SELECT DISTINCT ON (s.code) s.code, r.name, m.ibge, 'similar'
            FROM (SELECT DISTINCT rfb_mun AS code FROM stage_est WHERE rfb_mun NOT IN (SELECT code FROM rfb_map)) s
            JOIN rfb_names r ON r.code = s.code
            JOIN municipalities m ON m.uf = :uf AND m.ibge NOT IN (SELECT ibge FROM rfb_map)
                                 AND similarity(m.name_normalized, norm_text(r.name)) >= :th
            ORDER BY s.code, similarity(m.name_normalized, norm_text(r.name)) DESC
            """
        ),
        {"uf": uf, "th": NAME_SIMILARITY},
    )
    return [
        dict(r)
        for r in conn.execute(
            text(
                """
                SELECT s.code, coalesce(r.name, '?') AS rfb_name, m.name AS ibge_name, m.ibge, map.method, s.n
                FROM (SELECT rfb_mun AS code, count(*) AS n FROM stage_est GROUP BY 1) s
                LEFT JOIN rfb_names r ON r.code = s.code
                LEFT JOIN rfb_map map ON map.code = s.code
                LEFT JOIN municipalities m ON m.ibge = map.ibge
                WHERE map.method IS DISTINCT FROM 'exact' ORDER BY s.n DESC
                """
            )
        ).mappings()
    ]


def load(conn, uf: str, month: str, local_path: str | None = None, munis: list[int] | None = None) -> dict:
    """Carrega os estabelecimentos ativos da UF; com munis, grava só esses municípios."""
    conn.execute(
        text(
            "CREATE TEMP TABLE stage_est (id char(64), cnae_main char(7), situation text, bairro_raw text, cep text, rfb_mun text) "
            "ON COMMIT DROP; "
            "CREATE TEMP TABLE rfb_names (code text PRIMARY KEY, name text) ON COMMIT DROP; "
            "CREATE TEMP TABLE rfb_map (code text PRIMARY KEY, name text, ibge int, method text) ON COMMIT DROP"
        )
    )
    names = list(csv.reader((line.decode("latin-1") for line in read_zip_lines(fetch(month, local_path, "Municipios"))), delimiter=";"))
    conn.execute(text("INSERT INTO rfb_names VALUES (:c, :n) ON CONFLICT DO NOTHING"), [{"c": c, "n": n} for c, n in names])

    needle = f'"{uf}";"'.encode()  # filtro rápido em bytes; a UF é conferida de novo depois do parse
    pg = conn.connection.driver_connection
    scanned = active = 0
    with pg.cursor().copy("COPY stage_est FROM STDIN") as copy:
        for i in range(N_FILES):
            path = fetch(month, local_path, f"Estabelecimentos{i}")
            print(f"  lendo {path.name} …", flush=True)
            for line in read_zip_lines(path):
                scanned += 1
                if needle not in line:
                    continue
                row = next(csv.reader([line.decode("latin-1")], delimiter=";"))
                if len(row) != N_COLUMNS or row[COL_UF] != uf:
                    continue
                if not row[COL_SITUACAO].isdigit() or int(row[COL_SITUACAO]) != SITUACAO_ATIVA:
                    continue
                cnpj = row[COL_CNPJ_BASICO] + row[COL_CNPJ_ORDEM] + row[COL_CNPJ_DV]
                copy.write_row(
                    (
                        hashlib.sha256(cnpj.encode()).hexdigest(),
                        row[COL_CNAE_PRINCIPAL],
                        row[COL_SITUACAO],
                        row[COL_BAIRRO].strip() or None,
                        row[COL_CEP].strip() or None,
                        row[COL_MUNICIPIO],
                    )
                )
                active += 1

    non_exact = map_rfb_codes(conn, uf)
    target = munis or [r[0] for r in conn.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf"), {"uf": uf})]
    conn.execute(text("DELETE FROM establishments WHERE municipality_ibge = ANY(:m)"), {"m": target})
    inserted = conn.execute(
        text(
            """
            INSERT INTO establishments (id, cnae_main, situation, bairro_raw, bairro_normalized, cep, municipality_ibge)
            SELECT DISTINCT ON (s.id) s.id, s.cnae_main, s.situation, s.bairro_raw, norm_text(s.bairro_raw), s.cep, m.ibge
            FROM stage_est s JOIN rfb_map m ON m.code = s.rfb_mun
            WHERE m.ibge = ANY(:t)
            """
        ),
        {"t": target},
    ).rowcount
    conn.execute(
        text("UPDATE municipalities m SET rfb_code = r.code FROM rfb_map r WHERE r.ibge = m.ibge AND m.ibge = ANY(:t)"),
        {"t": target},
    )
    return {"scanned_lines": scanned, "active_in_uf": active, "inserted": inserted, "non_exact_codes": non_exact}
