"""Carga de um município. Idempotente: rodar de novo substitui os dados dele.

    docker compose run --rm backend python -m app.etl.load_city --ibge 2611606
    # etapas separadas:      --steps boundaries,cnpj,locate,counts
    # arquivos já baixados:  --local-path /data/raw/cnpj/2026-10   (pasta com Municipios.zip e Estabelecimentos*.zip)
Para um estado inteiro, use app.etl.load_uf (uma única leitura da base do CNPJ para todos os municípios).
"""
import argparse
import re
import time
from pathlib import Path

from sqlalchemy import text

from app.config import DATA_DIR
from app.db import engine
from app.etl import cnpj, counts, ibge_boundaries, locate, seed_catalog
from app.etl.sources import rfb_latest_month

ALL_STEPS = ["seed", "boundaries", "cnpj", "locate", "counts"]


def add_common_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--steps", default=",".join(ALL_STEPS))
    ap.add_argument("--month", help="mês da base do CNPJ (AAAA-MM); padrão: o da --local-path ou o mais recente publicado")
    ap.add_argument("--local-path", help="pasta com os .zip do CNPJ já baixados")
    ap.add_argument("--bairros-path", help="GeoPackage de bairros já baixado")
    ap.add_argument("--setores-path", help="GeoPackage de setores censitários já baixado")
    ap.add_argument("--threshold", type=float, default=locate.TRIGRAM_THRESHOLD)


def resolve_month(args) -> str:
    if args.month:
        return args.month
    if args.local_path and re.fullmatch(r"\d{4}-\d{2}", Path(args.local_path).name):
        return Path(args.local_path).name
    try:
        return rfb_latest_month()
    except Exception as e:  # sem rede: usa a pasta local mais recente, se houver
        local = sorted(p.name for p in (DATA_DIR / "raw" / "cnpj").glob("????-??"))
        if not local:
            raise SystemExit(f"Não foi possível descobrir o mês mais recente na Receita ({e}). Use --month ou --local-path.")
        return local[-1]


def step(name: str) -> float:
    print(f"\n== {name} ==", flush=True)
    return time.monotonic()


def done(t: float, msg: str = "ok") -> None:
    print(f"  {msg} ({time.monotonic() - t:.0f}s)", flush=True)


def ensure_catalog(steps: list[str], explicit: bool) -> None:
    with engine.connect() as c:
        empty = not c.execute(text("SELECT 1 FROM municipalities LIMIT 1")).first()
    # Na carga padrão, o seed (que consulta o IBGE) só roda se o catálogo estiver vazio; pedido explícito sempre roda.
    if "seed" in steps and (empty or explicit):
        t = step("seed_catalog")
        seed_catalog.main()
        done(t)


def run(uf: str, munis: list[int], args) -> list[dict]:
    """Pipeline comum a load_city e load_uf. Devolve as estatísticas por cidade (etapa counts)."""
    steps = args.steps.split(",")
    month = resolve_month(args) if {"cnpj", "counts"} & set(steps) else None

    if "boundaries" in steps:
        t = step(f"ibge_boundaries ({uf}, {len(munis)} município(s))")
        with engine.begin() as c:
            r = ibge_boundaries.load(c, uf, munis, args.bairros_path, args.setores_path)
        done(t, f"{r['with_bairros']} com bairros oficiais, {r['with_areas']} com áreas por setor censitário; {r['units']} bairros/áreas")

    if "cnpj" in steps:
        t = step(f"cnpj ({uf}, referência {month})")
        with engine.begin() as c:
            r = cnpj.load(c, uf, month, args.local_path, munis)
        done(t, f"{r['active_in_uf']:,} ativos na UF com CNAE do catálogo; {r['inserted']:,} gravados")
        for m in r["non_exact_codes"]:
            print(f"  município da Receita {m['code']} {m['rfb_name']!r} -> {m['ibge_name'] or 'SEM CORRESPONDÊNCIA'} ({m['method'] or '-'}, {m['n']:,} estab.)")

    if "locate" in steps:
        t = step(f"locate (limiar trigram {args.threshold})")
        with engine.begin() as c:
            r = locate.run(c, munis, args.threshold)
            examples = locate.trigram_examples(c, munis)
        done(t, f"exato: {r['exact']:,}; alias: {r['alias']:,}; trigram: {r['trigram']:,}")
        for e in examples:
            print(f"  trigram {e['n']:>6,}  {e['city']}: {e['bairro_raw']!r} -> {e['name']}")

    stats = []
    if "counts" in steps:
        t = step("counts")
        with engine.begin() as c:
            counts.refresh_views(c)
            counts.save_sources(c, uf, month)
            stats = counts.save_status(c, munis, month)
        done(t, f"{len(stats)} cidade(s) disponíveis no explorador")
    return stats


def print_city_report(conn, s: dict) -> None:
    pct = s["located"] / s["total_active"] * 100 if s["total_active"] else 0
    name = conn.execute(text("SELECT name FROM municipalities WHERE ibge = :m"), {"m": s["ibge"]}).scalar()
    unit = "bairros" if s["division_kind"] == "bairro" else "áreas (setores censitários)"
    print(f"\n================ {name} ({s['ibge']}) ================")
    print(f"{unit} ............ {s['neighborhoods']}")
    print(f"Estabelecimentos ativos ....... {s['total_active']:,}")
    print(f"Localizados ................... {s['located']:,} ({pct:.1f}%)")
    print(f"  exato / alias / trigram ..... {s['located_exact']:,} / {s['located_alias']:,} / {s['located_trigram']:,}")
    print("Top 20 textos de bairro NÃO casados:")
    for r in locate.unmatched_top(conn, s["ibge"]):
        print(f"  {r['n']:>7,}  {r['text']}")
    print("5 bairros/áreas com mais estabelecimentos localizados (contagem por tipo):")
    for d in counts.densest_report(conn, s["ibge"]):
        print(f"  {d['name']} ({d['located_count']:,}): {d['by_type']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ibge", type=int, required=True)
    add_common_args(ap)
    args = ap.parse_args()
    ensure_catalog(args.steps.split(","), explicit=args.steps != ",".join(ALL_STEPS))
    with engine.connect() as c:
        uf = c.execute(text("SELECT uf FROM municipalities WHERE ibge = :m"), {"m": args.ibge}).scalar()
    if not uf:
        raise SystemExit(f"Município {args.ibge} não encontrado no catálogo do IBGE.")
    stats = run(uf, [args.ibge], args)
    with engine.connect() as c:
        for s in stats:
            print_city_report(c, s)


if __name__ == "__main__":
    main()
