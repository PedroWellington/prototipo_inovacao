"""Relatórios da carga (só leitura).

    docker compose run --rm backend python -m app.etl.report --uf PE              # tabela por cidade (Markdown)
    docker compose run --rm backend python -m app.etl.report --ibge 2611606       # detalhe de uma cidade
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
    print(f"\n{len(rows)} de {n_munis} municípios de {uf} carregados ({bairros} com bairros oficiais, {len(rows) - bairros} com áreas por setor censitário).")
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--uf")
    g.add_argument("--ibge", type=int)
    args = ap.parse_args()
    if args.uf:
        return print_uf_table(args.uf.upper())
    from app.etl.load_city import print_city_report
    from app.etl.counts import STATUS_SQL

    with engine.connect() as c:
        s = dict(c.execute(STATUS_SQL, {"m": args.ibge}).mappings().one())
        print_city_report(c, {"ibge": args.ibge, **s})


if __name__ == "__main__":
    main()
