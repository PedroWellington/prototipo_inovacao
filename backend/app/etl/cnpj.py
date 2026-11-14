"""Estabelecimentos ativos com CNAE do catálogo, de uma ou mais UFs, a partir da base pública do CNPJ.

Layout conferido no PDF oficial (docs/DATA.md): CSV sem cabeçalho, ';', ISO-8859-1, 30 colunas.
Lê cada .zip em streaming (sem descompactar em disco) e filtra situação, CNAE e UF ANTES de gravar. Uma única
passada pelos 10 arquivos serve para todas as UFs pedidas (load_br). Os .zip ficam em data/raw e nunca são apagados.
"""
import csv
import hashlib
import re
import unicodedata
import zipfile
from pathlib import Path

from sqlalchemy import text

from app.config import DATA_DIR
from app.etl.sources import RFB_SHARE_TOKEN, RFB_WEBDAV, download

# Posições (0-based) no layout oficial de ESTABELECIMENTOS.
COL_CNPJ_BASICO, COL_CNPJ_ORDEM, COL_CNPJ_DV = 0, 1, 2
COL_SITUACAO = 5
COL_CNAE_PRINCIPAL = 11
COL_TIPO_LOGRADOURO, COL_LOGRADOURO, COL_NUMERO, COL_COMPLEMENTO = 13, 14, 15, 16
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


def catalog_cnaes(conn) -> set[bytes]:
    return {r[0].encode() for r in conn.execute(text("SELECT DISTINCT cnae FROM business_type_cnae"))}


def matching_rows(paths, ufs: set[bytes], cnaes: set[bytes]):
    """Linhas ativas das UFs com CNAE principal no conjunto. Devolve (linhas lidas, linha parseada) a cada match."""
    scanned = 0
    for path in paths:
        print(f"  lendo {path.name} …", flush=True)
        for line in read_zip_lines(path):
            scanned += 1
            # Filtro rápido em bytes (situação, CNAE, UF); a linha que passa é conferida pelo parser de CSV.
            parts = line.split(b'";"')
            if len(parts) == N_COLUMNS and (
                parts[COL_SITUACAO] != b"02" or parts[COL_CNAE_PRINCIPAL] not in cnaes or parts[COL_UF] not in ufs
            ):
                continue
            row = next(csv.reader([line.decode("latin-1")], delimiter=";"))
            if len(row) != N_COLUMNS or row[COL_UF].encode() not in ufs or row[COL_CNAE_PRINCIPAL].encode() not in cnaes:
                continue
            if not row[COL_SITUACAO].isdigit() or int(row[COL_SITUACAO]) != SITUACAO_ATIVA:
                continue
            yield scanned, row


NO_NUMBER = {"", "SN", "SNO", "SEMNUMERO", "SNR", "0", "00", "000"}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", s).split())


def location_key(row: list[str]) -> str:
    """Chave do LOCAL (CEP + logradouro + número), só para agrupar na carga; nunca é gravada.

    Sem CEP ou sem número ("S/N", vazio, "0"), não há como provar que é o mesmo local: a chave é o próprio CNPJ."""
    cep = re.sub(r"\D", "", row[COL_CEP])
    number = _norm(row[COL_NUMERO]).replace(" ", "")
    street = _norm(f"{row[COL_TIPO_LOGRADOURO]} {row[COL_LOGRADOURO]}")
    if not cep or not street or number in NO_NUMBER:
        return cnpj_hash(row)
    return hashlib.sha256(f"loc|{cep}|{street}|{number}".encode()).hexdigest()


def cnpj_hash(row: list[str]) -> str:
    return hashlib.sha256((row[COL_CNPJ_BASICO] + row[COL_CNPJ_ORDEM] + row[COL_CNPJ_DV]).encode()).hexdigest()


def scan(conn, ufs: list[str], month: str, local_path: str | None = None) -> dict:
    """Uma passada pelos 10 arquivos: guarda em stage_est os ativos das UFs pedidas cujo CNAE principal está no catálogo.

    stage_est é tabela temporária da sessão (sobrevive aos commits por UF de load_br). Só o catálogo entra, para o
    banco não crescer: um CNAE novo no CSV exige recarregar o CNPJ (docs/DATA.md)."""
    conn.execute(
        text(
            "DROP TABLE IF EXISTS stage_est, rfb_names, rfb_map; "
            "CREATE TEMP TABLE stage_est (id char(64), cnae_main char(7), situation text, bairro_raw text, cep text, "
            "rfb_mun text, uf char(2), loc_key char(64)); "
            "CREATE TEMP TABLE rfb_names (code text PRIMARY KEY, name text); "
            "CREATE TEMP TABLE rfb_map (code text PRIMARY KEY, name text, ibge int, method text)"
        )
    )
    names = list(csv.reader((line.decode("latin-1") for line in read_zip_lines(fetch(month, local_path, "Municipios"))), delimiter=";"))
    conn.execute(text("INSERT INTO rfb_names VALUES (:c, :n) ON CONFLICT DO NOTHING"), [{"c": c, "n": n} for c, n in names])

    paths = [fetch(month, local_path, f"Estabelecimentos{i}") for i in range(N_FILES)]
    cnaes = catalog_cnaes(conn)  # antes do COPY: com ele aberto, a conexão não aceita outra consulta
    pg = conn.connection.driver_connection
    kept = 0
    with pg.cursor().copy("COPY stage_est FROM STDIN") as copy:
        for _, row in matching_rows(paths, {u.encode() for u in ufs}, cnaes):
            copy.write_row(
                (
                    cnpj_hash(row),
                    row[COL_CNAE_PRINCIPAL],
                    row[COL_SITUACAO],
                    row[COL_BAIRRO].strip() or None,
                    row[COL_CEP].strip() or None,
                    row[COL_MUNICIPIO],
                    row[COL_UF],
                    location_key(row),
                )
            )
            kept += 1
    conn.execute(text("CREATE INDEX ON stage_est (uf)"))
    return {"kept": kept}


def map_rfb_codes(conn, uf: str) -> list[dict]:
    """Código do município da Receita (TOM) -> código IBGE, só para os códigos que aparecem na UF.

    A tabela Municipios da Receita não tem UF; como cada linha de estabelecimento traz a UF, basta casar
    os nomes dentro da UF: primeiro exato (normalizado), depois o candidato único mais parecido."""
    conn.execute(text("TRUNCATE rfb_map"))
    conn.execute(
        text(
            """
            INSERT INTO rfb_map (code, name, ibge, method)
            SELECT s.code, r.name, m.ibge, 'exact'
            FROM (SELECT DISTINCT rfb_mun AS code FROM stage_est WHERE uf = :uf) s
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
            FROM (SELECT DISTINCT rfb_mun AS code FROM stage_est WHERE uf = :uf AND rfb_mun NOT IN (SELECT code FROM rfb_map)) s
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
                FROM (SELECT rfb_mun AS code, count(*) AS n FROM stage_est WHERE uf = :uf GROUP BY 1) s
                LEFT JOIN rfb_names r ON r.code = s.code
                LEFT JOIN rfb_map map ON map.code = s.code
                LEFT JOIN municipalities m ON m.ibge = map.ibge
                WHERE map.method IS DISTINCT FROM 'exact' ORDER BY s.n DESC
                """
            ),
            {"uf": uf},
        ).mappings()
    ]


def apply_uf(conn, uf: str, munis: list[int] | None = None) -> dict:
    """Substitui os estabelecimentos dos municípios da UF pelos de stage_est."""
    non_exact = map_rfb_codes(conn, uf)
    target = munis or [r[0] for r in conn.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf"), {"uf": uf})]
    conn.execute(text("DELETE FROM establishments WHERE municipality_ibge = ANY(:m)"), {"m": target})
    inserted = conn.execute(
        text(
            """
            INSERT INTO establishments (id, cnae_main, situation, bairro_raw, bairro_normalized, cep, municipality_ibge, location_id)
            SELECT DISTINCT ON (x.id) x.id, x.cnae_main, x.situation, x.bairro_raw, norm_text(x.bairro_raw), x.cep, x.ibge,
                   -- local = menor hash de CNPJ entre os do mesmo endereço no município (ver docs/DATA.md)
                   min(x.id) OVER (PARTITION BY x.ibge, x.loc_key)
            FROM (SELECT s.*, m.ibge FROM stage_est s JOIN rfb_map m ON m.code = s.rfb_mun WHERE s.uf = :uf AND m.ibge = ANY(:t)) x
            ORDER BY x.id
            """
        ),
        {"uf": uf, "t": target},
    ).rowcount
    conn.execute(
        text("UPDATE municipalities m SET rfb_code = r.code FROM rfb_map r WHERE r.ibge = m.ibge AND m.ibge = ANY(:t)"),
        {"t": target},
    )
    in_uf = conn.execute(text("SELECT count(*) FROM stage_est WHERE uf = :uf"), {"uf": uf}).scalar()
    return {"active_in_uf": in_uf, "inserted": inserted, "non_exact_codes": non_exact}


def load(conn, uf: str, month: str, local_path: str | None = None, munis: list[int] | None = None) -> dict:
    """Carrega os estabelecimentos ativos (CNAE do catálogo) da UF; com munis, grava só esses municípios."""
    scan(conn, [uf], month, local_path)
    return apply_uf(conn, uf, munis)
