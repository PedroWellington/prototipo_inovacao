"""Relatórios da carga (só leitura).

    docker compose run --rm backend python -m app.etl.report --uf PE              # tabela por cidade (Markdown)
    docker compose run --rm backend python -m app.etl.report --ibge 2611606       # detalhe de uma cidade
    docker compose run --rm -T backend python -m app.etl.report --all > docs/COBERTURA.md   # todas as cidades
"""
import argparse

from sqlalchemy import text

from app.db import engine

TABLE_SQL = text(
    """
    SELECT m.name, s.municipality_ibge AS ibge, s.division_kind, s.neighborhoods, s.total_active, s.located,
           s.located_exact, s.located_alias, s.located_trigram, s.reference_month
    FROM city_data_status s JOIN municipalities m ON m.ibge = s.municipality_ibge
    WHERE m.uf = :uf ORDER BY s.total_active DESC, m.name
    """
)


def pct(a: int, b: int) -> str:
    return f"{a / b * 100:.1f}%".replace(".", ",") if b else "—"


def print_uf_table(uf: str) -> None:
    with engine.connect() as c:
        rows = c.execute(TABLE_SQL, {"uf": uf}).mappings().all()
        n_munis = c.execute(text("SELECT count(*) FROM municipalities WHERE uf = :uf"), {"uf": uf}).scalar()
    total = sum(r["total_active"] for r in rows)
    located = sum(r["located"] for r in rows)
    bairros = sum(r["division_kind"] == "bairro" for r in rows)
    print(f"\n{len(rows)} de {n_munis} municípios de {uf} carregados ({bairros} com bairros na malha do IBGE, {len(rows) - bairros} com áreas por setor censitário).")
    thousands = lambda n: f"{n:,}".replace(",", ".")  # noqa: E731
    print(f"Estabelecimentos ativos: {thousands(total)}; localizados: {thousands(located)} ({pct(located, total)}).\n")
    print("| Cidade | IBGE | Divisão | Unidades | Ativos | Localizados | % | Exato | Alias | Trigram |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        kind = "bairros" if r["division_kind"] == "bairro" else "áreas"
        print(
            f"| {r['name']} | {r['ibge']} | {kind} | {r['neighborhoods']} | {r['total_active']} | {r['located']} | "
            f"{pct(r['located'], r['total_active'])} | {r['located_exact']} | {r['located_alias']} | {r['located_trigram']} |"
        )


BR_SQL = text(
    """
    SELECT st.uf, st.name, count(m.ibge) AS munis, count(s.municipality_ibge) AS loaded,
           count(*) FILTER (WHERE s.division_kind = 'bairro') AS with_bairros,
           coalesce(sum(s.total_active), 0) AS total, coalesce(sum(s.located), 0) AS located,
           (SELECT reference FROM etl_progress p WHERE p.uf = st.uf AND p.step = 'cnpj') AS month
    FROM states st JOIN municipalities m ON m.uf = st.uf
    LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge
    WHERE st.uf = ANY(:ufs) GROUP BY st.uf, st.name ORDER BY st.uf
    """
)


def br_rows(ufs: list[str]):
    with engine.connect() as c:
        return c.execute(BR_SQL, {"ufs": ufs}).mappings().all()


def print_br_summary(ufs: list[str]) -> None:
    rows = br_rows(ufs)
    print()
    print("| UF | Estado | Municípios | Carregados | Com bairros na malha do IBGE | Cadastros CNPJ | Localizados | % | Ref. CNPJ |")
    print("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['uf']} | {r['name']} | {r['munis']} | {r['loaded']} | {r['with_bairros']} | {r['total']} | {r['located']} | {pct(r['located'], r['total'])} | {r['month'] or '—'} |")
    t = {k: sum(r[k] for r in rows) for k in ("munis", "loaded", "with_bairros", "total", "located")}
    print(f"| **Total** | | {t['munis']} | {t['loaded']} | {t['with_bairros']} | {t['total']} | {t['located']} | {pct(t['located'], t['total'])} | |")


ALL_SQL = text(
    """
    SELECT m.uf, m.name, s.municipality_ibge AS ibge, s.division_kind, s.neighborhoods, s.total_active, s.located,
           s.located_exact, s.located_alias, s.located_trigram, s.reference_month
    FROM city_data_status s JOIN municipalities m ON m.ibge = s.municipality_ibge
    ORDER BY m.uf, m.name, s.municipality_ibge
    """
)


def print_all() -> None:
    """Gera o Markdown com a taxa de localização de todas as cidades carregadas (docs/COBERTURA.md)."""
    with engine.connect() as c:
        rows = c.execute(ALL_SQL).mappings().all()
        ufs = [r[0] for r in c.execute(text("SELECT uf FROM states ORDER BY uf"))]
    lines = [
        "# Cobertura de localização por cidade",
        "",
        "Gerado por `docker compose run --rm -T backend python -m app.etl.report --all > docs/COBERTURA.md`. Não edite à mão.",
        "",
        "Cadastros = cadastros ativos de CNPJ com atividade principal (CNAE) de algum tipo do catálogo (a contagem da tela",
        "usa locais distintos; ver [DATA.md](DATA.md)). Localizados = cadastros atribuídos a um bairro ou área pelo texto do",
        "campo BAIRRO do CNPJ (exato, alias ou trigram).",
        "",
    ]
    for uf in ufs:
        part = [r for r in rows if r["uf"] == uf]
        if not part:
            continue
        lines += [f"## {uf}", "", "| Cidade | IBGE | Divisão | Unidades | Cadastros | Localizados | % | Exato | Alias | Trigram |", "|---|---|---|---|---|---|---|---|---|---|"]
        for r in part:
            kind = "bairros" if r["division_kind"] == "bairro" else "áreas"
            lines.append(
                f"| {r['name']} | {r['ibge']} | {kind} | {r['neighborhoods']} | {r['total_active']} | {r['located']} | "
                f"{pct(r['located'], r['total_active'])} | {r['located_exact']} | {r['located_alias']} | {r['located_trigram']} |"
            )
        lines.append("")
    print(*lines, sep="\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--uf")
    g.add_argument("--ibge", type=int)
    g.add_argument("--all", action="store_true", help="todas as cidades carregadas, em Markdown")
    args = ap.parse_args()
    if args.all:
        return print_all()
    if args.uf:
        return print_uf_table(args.uf.upper())
    from app.etl.load_city import print_city_report
    from app.etl.counts import STATUS_SQL

    with engine.connect() as c:
        s = dict(c.execute(STATUS_SQL, {"m": args.ibge}).mappings().one())
        print_city_report(c, {"ibge": args.ibge, **s})


if __name__ == "__main__":
    main()
