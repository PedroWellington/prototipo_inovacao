"""Compara os bairros do Recife usados na landing (IBGE, Censo 2022, do banco) com os da Prefeitura (2023).

    # depois de npm run build-geo (gera landing/.build/bairros-recife.geojson) e de baixar o arquivo da Prefeitura
    # em data/raw/recife/limites-dos-bairros-2023.geojson (ver landing/README.md):
    docker compose run --rm -v ./landing:/landing backend python /landing/scripts/compare_bairros.py

Escreve landing/docs/COMPARACAO-BAIRROS.md. Só desenvolvimento.
"""
import json
import math
import unicodedata
from datetime import date

from shapely.geometry import shape
from shapely.ops import transform, unary_union

IBGE = "/landing/.build/bairros-recife.geojson"
PREF = "/data/raw/recife/limites-dos-bairros-2023.geojson"
OUT = "/landing/docs/COMPARACAO-BAIRROS.md"
# Projeção local (metros) suficiente para comparar áreas dentro de uma cidade.
KX, KY = 111_320 * math.cos(math.radians(8.06)), 110_574


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return " ".join(s.replace("-", " ").split())


def load(path: str, key: str) -> dict:
    with open(path, encoding="utf-8") as f:
        feats = json.load(f)["features"]
    to_m = lambda x, y, z=None: (x * KX, y * KY)  # noqa: E731
    return {norm(f["properties"][key]): (f["properties"][key], transform(to_m, shape(f["geometry"]).buffer(0))) for f in feats}


def main() -> None:
    ibge, pref = load(IBGE, "name"), load(PREF, "EBAIRRNOMEOF")
    both = sorted(set(ibge) & set(pref))
    rows = []
    for k in both:
        a, b = ibge[k][1], pref[k][1]
        rows.append((ibge[k][0], a.area / 1e6, b.area / 1e6, a.intersection(b).area / a.union(b).area))
    ua, ub = unary_union([g for _, g in ibge.values()]), unary_union([g for _, g in pref.values()])
    iou = sorted(r[3] for r in rows)
    # Para cada nome sem par, o bairro do outro lado com maior sobreposição.
    def best(k):
        a = ibge[k][1]
        n, g = max(pref.values(), key=lambda v: a.intersection(v[1]).area)
        return f"{ibge[k][0]} ↔ {n} (IoU {a.intersection(g).area / a.union(g).area:.3f})"
    unmatched = [best(k) for k in sorted(set(ibge) - set(pref))]
    lines = [
        "# Bairros do Recife: IBGE (Censo 2022) x Prefeitura do Recife (2023)",
        "",
        f"Gerado por `scripts/compare_bairros.py` em {date.today().isoformat()}.",
        "",
        "**Base usada na landing e no produto:** malha de bairros do IBGE (Censo 2022), já carregada no banco.",
        "A da Prefeitura serve só de conferência.",
        "",
        "| Medida | IBGE 2022 | Prefeitura 2023 |",
        "|---|---|---|",
        f"| Feições | {len(ibge)} | {len(pref)} |",
        f"| Área total (km²) | {ua.area / 1e6:.2f} | {ub.area / 1e6:.2f} |",
        "",
        f"- Nomes iguais (sem acento e caixa): {len(both)}.",
        f"- Só no IBGE: {', '.join(ibge[k][0] for k in sorted(set(ibge) - set(pref))) or 'nenhum'}.",
        f"- Só na Prefeitura: {', '.join(pref[k][0] for k in sorted(set(pref) - set(ibge))) or 'nenhum'}.",
        f"- Par mais provável de cada nome sem correspondência: {'; '.join(unmatched) or 'nenhum'}.",
        f"- Sobreposição do contorno da cidade (IoU): {ua.intersection(ub).area / ua.union(ub).area:.3f}.",
        f"- Sobreposição por bairro (IoU): mediana {iou[len(iou) // 2]:.3f}, mínima {iou[0]:.3f}"
        f"; {sum(v >= 0.95 for v in iou)} de {len(iou)} bairros acima de 0,95.",
        "",
        "Leitura: as maiores diferenças ficam em bairros à beira d'água e do porto (Recife, Brasília Teimosa,",
        "Santo Antônio, Cabanga, São José), onde a Prefeitura tem área maior. Não conferimos a causa feição por feição.",
        "",
        "## Bairros com IoU abaixo de 0,95",
        "",
        "| Bairro | Área IBGE (km²) | Área Prefeitura (km²) | IoU |",
        "|---|---|---|---|",
        *[f"| {n} | {a:.3f} | {b:.3f} | {i:.3f} |" for n, a, b, i in sorted(rows, key=lambda r: r[3]) if i < 0.95],
        "",
    ]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines[:20]))


if __name__ == "__main__":
    main()
