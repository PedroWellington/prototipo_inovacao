"""Carga de todos os municípios de uma UF, com uma única leitura da base do CNPJ.

    docker compose run --rm backend python -m app.etl.load_uf --uf PE --local-path /data/raw/cnpj/2026-10
Mesmas opções de load_city (--steps, --month, --local-path, ...). Ao final, imprime o resumo por cidade;
o detalhe de uma cidade sai com: python -m app.etl.report --ibge <código>
"""
import argparse

from sqlalchemy import text

from app.db import engine
from app.etl.load_city import ALL_STEPS, add_common_args, ensure_catalog, run
from app.etl.report import print_uf_table


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", required=True)
    add_common_args(ap)
    args = ap.parse_args()
    uf = args.uf.upper()
    ensure_catalog(args.steps.split(","), explicit=args.steps != ",".join(ALL_STEPS))
    with engine.connect() as c:
        munis = [r[0] for r in c.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf ORDER BY ibge"), {"uf": uf})]
    if not munis:
        raise SystemExit(f"UF {uf} não encontrada no catálogo do IBGE.")
    run(uf, munis, args)
    print_uf_table(uf)


if __name__ == "__main__":
    main()
