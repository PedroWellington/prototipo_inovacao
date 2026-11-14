"""Carga do Brasil inteiro (ou de várias UFs) em lote, retomável e com UMA leitura da base do CNPJ.

    docker compose run --rm backend python -m app.etl.load_br --local-path /data/raw/cnpj/2026-10
    #   --ufs PE,SP   só essas UFs        --force   refaz também o que já foi concluído
    #   --steps boundaries,locate,counts --force   refaz limites, localização, renda e contagens sem reler o CNPJ
Etapas: censo (nacional) -> limites de cada UF -> CNES (nacional) -> leitura única do CNPJ -> por UF: estabelecimentos, localização,
renda dos bairros, contagens e status. Cada UF é uma transação registrada em etl_progress: se a carga cair,
rodar o mesmo comando continua de onde parou. Ao final imprime a cobertura por UF (report --all para o detalhe).
"""
import argparse
import time

from sqlalchemy import text

from app.db import engine
from app.etl import census, cnes, cnpj, counts, ibge_boundaries, locate
from app.etl.sources import CNES_URL
from app.etl.load_city import add_common_args, ensure_catalog, resolve_month

CENSUS_REF = "2022"


def is_done(c, uf: str, step: str, ref: str) -> bool:
    return bool(c.execute(text("SELECT 1 FROM etl_progress WHERE uf = :u AND step = :s AND reference = :r"), {"u": uf, "s": step, "r": ref}).first())


def mark(c, uf: str, step: str, ref: str) -> None:
    c.execute(
        text(
            "INSERT INTO etl_progress (uf, step, reference) VALUES (:u, :s, :r) "
            "ON CONFLICT (uf, step) DO UPDATE SET reference = EXCLUDED.reference, done_at = now()"
        ),
        {"u": uf, "s": step, "r": ref},
    )


def log(t0: float, msg: str) -> None:
    print(f"[{(time.monotonic() - t0) / 60:6.1f} min] {msg}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ufs", help="lista separada por vírgula; padrão: todas as 27")
    ap.add_argument("--force", action="store_true")
    add_common_args(ap)
    args = ap.parse_args()
    t0 = time.monotonic()
    ensure_catalog(["seed"], explicit=False)
    month = resolve_month(args)
    with engine.connect() as c:
        all_ufs = [r[0] for r in c.execute(text("SELECT uf FROM states ORDER BY uf"))]
    ufs = [u.strip().upper() for u in args.ufs.split(",")] if args.ufs else all_ufs
    done = lambda c, uf, step, ref: not args.force and is_done(c, uf, step, ref)  # noqa: E731
    steps = set(args.steps.split(","))

    with engine.begin() as c:
        if not is_done(c, "BR", "census", CENSUS_REF) or (args.force and "boundaries" in steps):
            log(t0, "censo 2022: população, área, renda e malha municipal do Brasil")
            log(t0, f"  {census.load_national(c)}")
            mark(c, "BR", "census", CENSUS_REF)

    for i, uf in enumerate(ufs if "boundaries" in steps else [], 1):
        with engine.begin() as c:
            if done(c, uf, "boundaries", CENSUS_REF):
                continue
            munis = [r[0] for r in c.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf ORDER BY ibge"), {"uf": uf})]
            r = ibge_boundaries.load(c, uf, munis)
            mark(c, uf, "boundaries", CENSUS_REF)
        log(t0, f"[{i}/{len(ufs)}] limites {uf}: {r['with_bairros']} cidades com bairros, {r['with_areas']} com áreas; {r['units']:,} unidades")

    # CNES depois dos limites (o bairro sai da coordenada): rode de novo com --steps cnes --force para atualizar.
    with engine.begin() as c:
        if not is_done(c, "BR", "cnes", CNES_URL) or (args.force and ({"cnes", "boundaries"} & steps)):
            r = cnes.load(c)
            counts.refresh_views(c)
            mark(c, "BR", "cnes", CNES_URL)
            log(t0, f"CNES ({r['reference']}): {r['units']:,} unidades ativas dos tipos mapeados; {r['located']:,} localizadas em bairro/área")

    if "cnpj" not in steps:
        return relocate(ufs, args, t0) if {"locate", "counts"} & steps else report(ufs)
    with engine.connect() as c:
        pending = [uf for uf in ufs if not done(c, uf, "cnpj", month)]
    if not pending:
        log(t0, f"CNPJ {month}: todas as UFs pedidas já estão carregadas (use --force para refazer)")
        return report(ufs)

    # Uma conexão para tudo: stage_est é temporária da sessão e sobrevive aos commits por UF.
    with engine.connect() as c:
        log(t0, f"CNPJ {month}: leitura única para {len(pending)} UF(s): {','.join(pending)}")
        r = cnpj.scan(c, pending, month, args.local_path)
        c.commit()
        log(t0, f"  {r['kept']:,} estabelecimentos ativos com CNAE do catálogo")
        for i, uf in enumerate(pending, 1):
            munis = [x[0] for x in c.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf ORDER BY ibge"), {"uf": uf})]
            a = cnpj.apply_uf(c, uf)
            loc = locate.run(c, munis, args.threshold)
            inc = census.update_neighborhood_income(c, munis)
            counts.refresh_views(c)
            counts.save_sources(c, uf, month)
            stats = counts.save_status(c, munis, month)
            mark(c, uf, "cnpj", month)
            c.commit()
            located = loc["exact"] + loc["alias"] + loc["trigram"]
            pct = located / a["inserted"] * 100 if a["inserted"] else 0
            log(
                t0,
                f"[{i}/{len(pending)}] {uf}: {a['inserted']:,} estabelecimentos, {pct:.1f}% localizados; "
                f"{len(stats)} cidades disponíveis; renda em {inc['bairro']:,} bairros e {inc['area']:,} áreas",
            )
            for m in a["non_exact_codes"]:
                print(f"    município da Receita {m['code']} {m['rfb_name']!r} -> {m['ibge_name'] or 'SEM CORRESPONDÊNCIA'} ({m['method'] or '-'}, {m['n']:,} estab.)")
    log(t0, "fim")
    report(ufs)


def relocate(ufs: list[str], args, t0: float) -> None:
    """Sem reler o CNPJ: localização, renda, contagens e status de cada UF (ex.: depois de mudar aliases)."""
    for i, uf in enumerate(ufs, 1):
        with engine.begin() as c:
            month = c.execute(text("SELECT reference FROM etl_progress WHERE uf = :u AND step = 'cnpj'"), {"u": uf}).scalar()
            if not month:
                log(t0, f"[{i}/{len(ufs)}] {uf}: CNPJ ainda não carregado, pulando")
                continue
            munis = [x[0] for x in c.execute(text("SELECT ibge FROM municipalities WHERE uf = :uf ORDER BY ibge"), {"uf": uf})]
            loc = locate.run(c, munis, args.threshold)
            census.update_neighborhood_income(c, munis)
            counts.refresh_views(c)
            stats = counts.save_status(c, munis, month)
        total = sum(x["total_active"] for x in stats)
        pct = (loc["exact"] + loc["alias"] + loc["trigram"]) / total * 100 if total else 0
        log(t0, f"[{i}/{len(ufs)}] {uf}: {pct:.1f}% localizados (exato {loc['exact']:,}, alias {loc['alias']:,}, trigram {loc['trigram']:,})")
    report(ufs)


def report(ufs: list[str]) -> None:
    from app.etl.report import print_br_summary

    print_br_summary(ufs)


if __name__ == "__main__":
    main()
