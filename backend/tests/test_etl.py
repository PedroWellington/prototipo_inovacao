"""ETL do CNPJ + localização com arquivos sintéticos no layout oficial (sem rede)."""
import zipfile

import pytest
from sqlalchemy import text

from app.db import engine
from app.etl import cnpj, locate
from tests.helpers import seed_minimal_catalog

RECIFE, CABROBO = 2611606, 2603009


def est_row(basico, cnae, bairro, uf="PE", mun="2531", situacao="02"):
    row = [""] * cnpj.N_COLUMNS
    row[0], row[1], row[2] = basico, "0001", "99"
    row[4] = "NOME FANTASIA QUE NAO PODE SER GUARDADO"
    row[cnpj.COL_SITUACAO] = situacao
    row[cnpj.COL_CNAE_PRINCIPAL] = cnae
    row[cnpj.COL_BAIRRO], row[cnpj.COL_CEP], row[cnpj.COL_UF], row[cnpj.COL_MUNICIPIO] = bairro, "50000000", uf, mun
    row[27] = "contato@empresa.com"
    return ";".join(f'"{v}"' for v in row)


def write_zip(path, lines):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("DATA.CSV", ("\n".join(lines) + "\n").encode("latin-1"))


@pytest.fixture
def cnpj_dir(tmp_path):
    # A tabela da Receita não tem UF: "RECIFE" de outro estado (código 9999) não pode ser confundido.
    write_zip(tmp_path / "Municipios.zip", ['"2531";"RECIFE"', '"2349";"CABROBO"', '"9999";"RECIFE"'])
    rows = [
        est_row("00000001", "4771701", "BOA VIAGEM"),
        est_row("00000002", "4771701", "Boa  Viagem."),  # normalização
        est_row("00000003", "8610101", "JARDIM SAO PAULO S"),  # trigram -> único candidato >= 0,85
        est_row("00000008", "8610101", "BOA VIAJEM"),  # parecido, mas abaixo do limiar -> não localizado
        est_row("00000009", "8610101", "JARDIM SAO PAULO I"),  # dois candidatos >= limiar -> ambíguo
        est_row("00000004", "8610101", "CENTRO"),  # Recife não tem bairro "Centro" nem alias -> não localizado
        est_row("00000005", "4771701", "BOA VIAGEM", situacao="08"),  # baixada -> fora
        est_row("00000006", "4771701", "BOA VIAGEM", uf="SP", mun="9999"),  # outra UF -> fora
        est_row("00000007", "4771701", "GRAÇAS"),  # acento + ISO-8859-1
        est_row("00000010", "4771701", "CENTRO", mun="2349"),  # Cabrobó (áreas): alias -> área urbana da sede
        est_row("00000011", "4771701", "Povoado Lama", mun="2349"),  # nome do aglomerado -> exato
    ]
    write_zip(tmp_path / "Estabelecimentos0.zip", rows)
    for i in range(1, cnpj.N_FILES):
        write_zip(tmp_path / f"Estabelecimentos{i}.zip", [])
    return tmp_path


def add_unit(c, mun, code, name, kind="bairro", aliases=()):
    c.execute(
        text(
            "INSERT INTO neighborhoods (municipality_ibge, ibge_code, name, name_normalized, kind, aliases, geom, geom_simplified, "
            "label_point, area_km2, source, source_date) VALUES (:m, :c, :n, norm_text(:n), :k, :a, "
            "ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), "
            "ST_Point(0.5,0.5,4326), 1, 'test', '2022')"
        ),
        {"m": mun, "c": code, "n": name, "k": kind, "a": list(aliases)},
    )


def test_cnpj_load_and_locate(cnpj_dir):
    seed_minimal_catalog()
    with engine.begin() as c:
        c.execute(text("DELETE FROM establishments; DELETE FROM neighborhoods"))
        c.execute(text("INSERT INTO municipalities (ibge, name, name_normalized, uf) VALUES (:m, 'Cabrobó', 'cabrobo', 'PE') ON CONFLICT DO NOTHING"), {"m": CABROBO})
        for code, name in [("1", "Boa Viagem"), ("2", "Graças"), ("3", "Jardim São Paulo"), ("4", "Jardim São Paulo II")]:
            add_unit(c, RECIFE, code, name)
        add_unit(c, CABROBO, "A1-U", "Cabrobó – área urbana", "area", ["centro"])
        add_unit(c, CABROBO, "A1-R", "Cabrobó – área rural", "area", ["zona rural"])
        add_unit(c, CABROBO, "A1-A9", "Povoado Lama", "area")

        result = cnpj.load(c, "PE", "2026-10", str(cnpj_dir), [RECIFE, CABROBO])
        loc = locate.run(c, [RECIFE, CABROBO])
        rows = c.execute(
            text(
                "SELECT e.bairro_raw, e.municipality_ibge, e.match_method, n.name FROM establishments e "
                "LEFT JOIN neighborhoods n ON n.id = e.neighborhood_id"
            )
        ).all()
        columns = c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'establishments'")).scalars().all()
        unmatched = {r["text"] for r in locate.unmatched_top(c, RECIFE)}

    assert result["active_in_uf"] == 9 and result["inserted"] == 9  # 11 linhas - 1 baixada - 1 de SP
    assert result["non_exact_codes"] == []  # todos os códigos da UF casaram pelo nome exato
    assert loc == {"exact": 4, "alias": 1, "trigram": 1, "threshold": 0.85}
    by = {(r.bairro_raw, r.municipality_ibge): (r.match_method, r.name) for r in rows}
    assert by[("Boa  Viagem.", RECIFE)] == ("exact", "Boa Viagem")
    assert by[("JARDIM SAO PAULO S", RECIFE)] == ("trigram", "Jardim São Paulo")
    assert by[("BOA VIAJEM", RECIFE)] == ("none", None)
    assert by[("JARDIM SAO PAULO I", RECIFE)] == ("none", None)
    assert by[("CENTRO", RECIFE)] == ("none", None)
    assert by[("GRAÇAS", RECIFE)] == ("exact", "Graças")
    assert by[("CENTRO", CABROBO)] == ("alias", "Cabrobó – área urbana")
    assert by[("Povoado Lama", CABROBO)] == ("exact", "Povoado Lama")
    assert unmatched == {"CENTRO", "BOA VIAJEM", "JARDIM SAO PAULO I"}
    # Nada de dado pessoal: sem nome fantasia, razão social, e-mail, telefone ou CNPJ em claro.
    assert not {"nome_fantasia", "razao_social", "email", "telefone", "cnpj"} & set(columns)


def test_area_aliases_use_district_name_and_named_seat():
    from app.etl.ibge_boundaries import norm

    # Mesmo critério do norm_text do banco; sede = distrito com o nome do município (não o código "05").
    assert norm("Água Rasa") == "agua rasa" and norm("São Paulo") == norm("SAO  PAULO.")
    with engine.connect() as c:
        assert c.execute(text("SELECT norm_text('Sé – área urbana')")).scalar() == norm("Sé – área urbana")


def test_location_key_groups_same_address_only_when_provable():
    def row(basico, cep="50670260", tipo="RUA", rua="DO BOM PASTOR", num="141"):
        r = [""] * cnpj.N_COLUMNS
        r[0], r[1], r[2] = basico, "0001", "99"
        r[cnpj.COL_CEP], r[cnpj.COL_TIPO_LOGRADOURO], r[cnpj.COL_LOGRADOURO], r[cnpj.COL_NUMERO] = cep, tipo, rua, num
        return r

    a, b = row("00000001"), row("00000002", rua="Do Bom  Pastor.")  # mesma grafia normalizada
    assert cnpj.location_key(a) == cnpj.location_key(b)
    assert cnpj.location_key(row("00000003", num="143")) != cnpj.location_key(a)
    assert cnpj.location_key(row("00000004", cep="50670000")) != cnpj.location_key(a)
    # sem número ou sem CEP não dá para provar que é o mesmo local: cada CNPJ é um local
    for sn in ("S/N", "SN", "", "0", "S/Nº"):
        r = row("00000005", num=sn)
        assert cnpj.location_key(r) == cnpj.cnpj_hash(r)
    assert cnpj.location_key(row("00000006", cep="")) == cnpj.cnpj_hash(row("00000006", cep=""))


def test_counts_are_distinct_locations():
    seed_minimal_catalog()
    with engine.begin() as c:
        c.execute(text("DELETE FROM establishments; DELETE FROM neighborhoods"))
        add_unit(c, RECIFE, "1", "Iputinga")
        nid = c.execute(text("SELECT id FROM neighborhoods WHERE ibge_code = '1'")).scalar()
        # três farmácias: dois CNPJs no mesmo local (mesmo location_id), um em outro
        for i, loc in (("1", "A"), ("2", "A"), ("3", "B")):
            c.execute(
                text("INSERT INTO establishments (id, cnae_main, situation, municipality_ibge, neighborhood_id, match_method, location_id) "
                     "VALUES (lpad(:i, 64, '0'), '4771701', '02', :m, :n, 'exact', lpad(:l, 64, '0'))"),
                {"i": i, "m": RECIFE, "n": nid, "l": loc},
            )
        c.execute(text("REFRESH MATERIALIZED VIEW neighborhood_type_counts; REFRESH MATERIALIZED VIEW municipality_type_counts; "
                       "REFRESH MATERIALIZED VIEW neighborhood_coverage"))
        assert c.execute(text("SELECT n_establishments FROM neighborhood_type_counts WHERE neighborhood_id = :n"), {"n": nid}).scalar() == 2
        assert c.execute(text("SELECT n_establishments FROM municipality_type_counts WHERE municipality_ibge = :m AND business_type_key = 'farmacia'"),
                         {"m": RECIFE}).scalar() == 2
        assert c.execute(text("SELECT located_count FROM neighborhood_coverage WHERE neighborhood_id = :n"), {"n": nid}).scalar() == 2
