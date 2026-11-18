"""Desenvolvimento: gera o relatório de uma cidade com os critérios de uma conta e salva o PDF e as páginas em PNG.

    docker compose exec backend python scripts/sample_report.py --ibge 2611606 --email ana@exemplo.com [--png]

O PNG precisa do pypdfium2 (só desenvolvimento: pip install pypdfium2). Sem Google (a não ser que a chave exista).
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.api.report import render  # noqa: E402
from app.db import DataSessionLocal, SessionLocal  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ibge", type=int, default=2611606)
    ap.add_argument("--email", required=True)
    ap.add_argument("--kind", choices=["report", "route", "slides"], default="report")
    ap.add_argument("--out", default="/data/report_sample")
    ap.add_argument("--png", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db, DataSessionLocal() as data:
        uid = db.execute(text("SELECT id FROM users WHERE lower(email) = lower(:e)"), {"e": a.email}).scalar()
        crit = [dict(r) for r in db.execute(text("SELECT business_type_key, direction, weight FROM profile_criteria WHERE user_id = :u"),
                                            {"u": uid}).mappings()]
        ids = None
        if a.kind == "route":
            from app.scoring.rank import rank
            ids = [n["id"] for n in rank(data, a.ibge, crit)["neighborhoods"][:3]]
        t = time.perf_counter()
        pdf, name = render(db, data, uid, a.ibge, crit, a.kind, ids)
        print(f"{name}: {len(pdf) / 1024:.0f} KB em {time.perf_counter() - t:.2f} s")
    (out / name).write_bytes(pdf)
    if a.png:
        import pypdfium2

        doc = pypdfium2.PdfDocument(pdf)
        for i in range(len(doc)):
            doc[i].render(scale=1.4).to_pil().save(out / f"{a.kind}-{i + 1:02d}.png")
        print(f"{len(doc)} páginas em {out}")


if __name__ == "__main__":
    main()
