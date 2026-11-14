"""Mede o tempo de resposta de POST /api/cities/{ibge}/rank e da geometria (ver docs/PERFORMANCE.md).

    docker compose run --rm backend python scripts/perf_rank.py --ibge 2611606
Cria um usuário descartável, roda todas as combinações de pesos (sem cache) e repete (com cache).
"""
import argparse
import itertools
import secrets
import statistics
import time

import httpx


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ibge", type=int, default=2611606)
    ap.add_argument("--base", default="http://backend:8000")
    args = ap.parse_args()

    c = httpx.Client(base_url=args.base, timeout=30)
    email = f"perf-{secrets.token_hex(4)}@example.com"
    c.post("/api/auth/register", json={"name": "Perf", "email": email, "password": "perf-senha-123", "accept_terms": True}).raise_for_status()
    csrf = c.get("/api/auth/me").json()["csrf_token"]
    h = {"X-CSRF-Token": csrf}

    combos = list(itertools.product(range(1, 6), repeat=3))  # 125 combinações de pesos
    def body(w):
        return {"criteria": [
            {"business_type_key": "hospital", "direction": "attract", "weight": w[0]},
            {"business_type_key": "clinica", "direction": "attract", "weight": w[1]},
            {"business_type_key": "farmacia", "direction": "repel", "weight": w[2]},
        ]}

    for label in ("sem cache (1ª vez de cada combinação)", "com cache (repetição)"):
        times = []
        for w in combos:
            t = time.perf_counter()
            r = c.post(f"/api/cities/{args.ibge}/rank", json=body(w), headers=h)
            times.append((time.perf_counter() - t) * 1000)
            r.raise_for_status()
            assert r.json()["status"] == "ok", r.json()
        print(f"rank {label}: n={len(times)} p50={statistics.median(times):.1f} ms p95={pct(times, 95):.1f} ms max={max(times):.1f} ms")

    # Ranking de cidades (Brasil inteiro): mesmas 125 combinações, com mínimo de 20 mil e sem mínimo (~5.570 cidades).
    for min_pop in (20000, 0):
        for label in ("sem cache", "com cache"):
            times, size = [], 0
            for w in combos:
                t = time.perf_counter()
                r = c.post("/api/cities/rank", json={**body(w), "min_population": min_pop}, headers=h)
                times.append((time.perf_counter() - t) * 1000)
                r.raise_for_status()
                size = len(r.content)
            n = r.json()["counts"]["analyzed"]
            print(f"cidades BR (mín. {min_pop}, {n} cidades) {label}: p50={statistics.median(times):.1f} ms "
                  f"p95={pct(times, 95):.1f} ms max={max(times):.1f} ms; resposta {size / 1024:.0f} KB")

    r = c.get(f"/api/cities/{args.ibge}/neighborhoods.geojson", headers={"Accept-Encoding": "gzip"})
    raw = len(r.content)
    gz = int(r.headers.get("content-length") or 0)
    etag = r.headers["etag"]
    t = time.perf_counter()
    again = c.get(f"/api/cities/{args.ibge}/neighborhoods.geojson", headers={"If-None-Match": etag})
    print(f"geojson: {raw/1024:.0f} KB sem compressão, {gz/1024:.0f} KB gzip; revalidação {again.status_code} em {(time.perf_counter()-t)*1000:.1f} ms")
    c.delete("/api/account", headers=h)


if __name__ == "__main__":
    main()
