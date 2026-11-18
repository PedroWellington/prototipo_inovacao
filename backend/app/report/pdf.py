"""PDF do relatório (A4, pt-BR) com fpdf2: Python puro, roda no Docker e na função da Vercel (sem Pango/Cairo).

Paleta = shared/design-tokens.css; fonte Inter embutida (app/report/fonts, OFL). Mapas = SVG próprio a partir das
geometrias do IBGE (app.report.data.city_shapes): sem tiles, sem imagem do Google. Conteúdo do Google (tempo de carro)
só na página "Seus critérios e a sede", que não tem mapa (docs/GOOGLE-MAPS.md, termo 19.2).
Tudo em memória: nenhum arquivo temporário, nenhum log do conteúdo.
"""
import io
from pathlib import Path

from fpdf import FPDF

from app.config import PRODUCT_NAME
from app.scoring.rank import NO_DATA

FONTS = Path(__file__).parent / "fonts"
C = {
    "coal": "#20272d", "coal2": "#313b42", "paper": "#fdfcf9", "stone": "#f6f5f1", "sand": "#e8e5dc", "line": "#e5e2da",
    "ink": "#263039", "muted": "#65706d", "copper": "#ad7651", "copper_dark": "#8f5c3c", "copper_wash": "#f4e9df",
    "copper_soft": "#e2c6ae", "sage": "#688c83", "sage_dark": "#466d67", "sage_light": "#e4eeea", "on_dark": "#f5f1ea",
    "on_dark_muted": "#b9c0bf", "red_dark": "#9c5446", "base": "#e9e6de",
}
# Posição 1..5 -> escala do mapa (do mais escuro ao mais claro; o número vai sempre junto).
SCALE = ["#466d67", "#688c83", "#b0a185", "#e0b6a8", "#f0dcd4"]
LEGAL = ("Este relatório organiza dados públicos para apoiar a sua análise. Não garante resultado, faturamento nem lucro, "
         "e não substitui estudo de viabilidade.")
LEGAL_APP = ("Informações de caráter informativo. Não substituem análise própria ou profissional. "
             "Não constituem aconselhamento jurídico nem financeiro.")
NOT_ADVICE = "Análise de dados abertos. Não é uma recomendação."
COVERAGE = {"high": "alta", "medium": "média", "low": "baixa"}
M = 18  # margem (mm)
W = 210 - 2 * M


def num(x, d: int = 0) -> str:
    s = f"{x:,.{d}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def money(x) -> str:
    return "R$ " + num(x)


def ordinal(n: int) -> str:
    return f"{n}º"


def direction(c: dict) -> str:
    return "perto" if c["direction"] == "attract" else "longe"


class Doc(FPDF):
    def __init__(self, d: dict, title: str, orientation: str = "P"):
        super().__init__(orientation, "mm", "A4")
        self.d = d
        self.doc_title = title
        self.set_margins(M, M, M)
        self.set_auto_page_break(False)
        for fam, style, f in (("Inter", "", "Regular"), ("Inter", "B", "Bold"), ("InterM", "", "Medium"), ("InterSB", "", "SemiBold")):
            self.add_font(fam, style, str(FONTS / f"Inter-{f}.ttf"))
        self.set_lang("pt-BR")
        self.set_title(title)
        self.set_author(PRODUCT_NAME)
        self.set_creator(PRODUCT_NAME)
        self.set_subject(f"{title}: {d['city']['name']} – {d['city']['uf']}")
        self.set_display_mode("fullpage")
        self.dark_page = False
        self.has_cover = False  # só o relatório tem capa (página 1 sem cabeçalho e rodapé)

    # ---- utilidades de desenho --------------------------------------------------------------------------------
    def color(self, kind: str, c: str):
        getattr(self, f"set_{kind}_color")(c)

    def font(self, size: float, weight: str = "", color: str = "ink"):
        fam, style = {"": ("Inter", ""), "b": ("Inter", "B"), "m": ("InterM", ""), "sb": ("InterSB", "")}[weight]
        self.set_font(fam, style, size)
        self.color("text", C[color])

    def text_at(self, x, y, w, txt, size=9, weight="", color="ink", align="L", h=None, spacing=0.0):
        self.font(size, weight, color)
        self.set_char_spacing(spacing)
        self.set_xy(x, y)
        self.multi_cell(w, h or size * 0.47, txt, align=align, new_x="LMARGIN", new_y="NEXT")
        self.set_char_spacing(0)
        return self.get_y()

    def label(self, x, y, txt, color="muted", w=W):
        return self.text_at(x, y, w, txt.upper(), 6.6, "sb", color, spacing=0.6)

    def box(self, x, y, w, h, fill="stone", border=None, r=2.2):
        self.color("fill", C[fill])
        if border:
            self.color("draw", C[border])
            self.set_line_width(0.25)
        self.rect(x, y, w, h, "DF" if border else "F", round_corners=True, corner_radius=r)

    def hr(self, y, x0=M, x1=210 - M, color="line", lw=0.25):
        self.color("draw", C[color])
        self.set_line_width(lw)
        self.line(x0, y, x1, y)

    def badge(self, cx, cy, r, n, fill="coal", color="on_dark", size=None):
        self.color("fill", C[fill])
        self.circle(cx, cy, r, "F")
        self.font(size or r * 2.9, "b", color)
        self.set_xy(cx - r, cy - r)
        self.cell(2 * r, 2 * r, str(n), align="C")

    def lines(self, w, txt, size, weight="") -> int:
        self.font(size, weight)
        return len(self.multi_cell(w, 1, txt, dry_run=True, output="LINES"))

    def source(self, x, y, w, txt):
        return self.text_at(x, y, w, txt, 6.4, "", "muted", h=3.1)

    def page_title(self, kicker: str, title: str, lead: str | None = None):
        y = self.label(M, 30, kicker, "copper_dark")
        y = self.text_at(M, y + 1.5, W, title, 21, "b", "ink", h=9)
        if lead:
            y = self.text_at(M, y + 1, W * 0.86, lead, 9.5, "", "muted", h=4.8)
        return y + 6

    # ---- cabeçalho e rodapé ---------------------------------------------------------------------------------------
    def header(self):
        if self.page_no() == 1 and self.has_cover:
            return
        self.color("fill", C["paper"])
        self.rect(0, 0, 210, 297, "F")
        self.font(7.5, "b", "ink")
        self.set_char_spacing(1.2)
        self.set_xy(M, 12)
        self.cell(40, 4, PRODUCT_NAME.upper())
        self.set_char_spacing(0)
        self.font(7.5, "", "muted")
        self.set_xy(M, 12)
        self.cell(W, 4, f"{self.doc_title} · {self.d['city']['name']} – {self.d['city']['uf']}", align="R")
        self.hr(18.5)

    def footer(self):
        if self.page_no() == 1 and self.has_cover:
            return
        self.hr(283)
        self.font(7, "", "muted")
        self.set_xy(M, 285)
        self.cell(W / 2, 4, f"Gerado em {self.d['generated_label']} · código dos parâmetros {self.d['params_code']}")
        self.set_xy(M, 285)
        self.cell(W, 4, f"Página {self.page_no()} de {{nb}}", align="R")

    # ---- mapa SVG próprio ----------------------------------------------------------------------------------------
    def city_map(self, shapes: dict, x, y, w, h, ranks: dict[int, int], focus: int | None = None, alt: str = ""):
        """ranks: id -> posição (1..5) desenhada com cor E número. focus: só este bairro em destaque (mini-mapa)."""
        sw, sh = shapes["w"], shapes["h"]
        if not shapes["paths"] or not sw or not sh:
            self.text_at(x, y + h / 2 - 3, w, NO_DATA.format(item="limites"), 8, "", "muted", "C")
            return
        s = min(w / sw, h / sh)
        mw, mh = sw * s, sh * s
        ox, oy = x + (w - mw) / 2, y + (h - mh) / 2
        stroke = max(sw, sh) / (500 if focus is None else 260)
        parts = []
        for p in shapes["paths"]:
            if focus is not None:
                fill = C["copper"] if p["id"] == focus else C["sand"]
            else:
                fill = SCALE[ranks[p["id"]] - 1] if p["id"] in ranks else C["base"]
            parts.append(f'<path d="{p["d"]}" fill="{fill}" stroke="{C["paper"]}" stroke-width="{stroke:.0f}" stroke-linejoin="round"/>')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{sw:.0f}" height="{sh:.0f}" viewBox="0 0 {sw:.0f} {sh:.0f}">'
               + "".join(parts) + "</svg>")
        self.image(io.BytesIO(svg.encode()), x=ox, y=oy, w=mw, h=mh, alt_text=alt)
        labels = {p["id"]: p["label"] for p in shapes["paths"]}
        r = 2.5 if focus is None else 2.2
        items = [(n, ox + labels[i][0] * s, oy + labels[i][1] * s) for i, n in
                 (ranks.items() if focus is None else ((focus, ranks[focus]),)) if i in labels]
        pos = {n: [x0, y0] for n, x0, y0 in items}
        for _ in range(40):  # afasta os círculos que se tocam (bairros pequenos e vizinhos)
            moved = False
            for a in pos:
                for b in pos:
                    if a < b:
                        dx, dy = pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]
                        dist = (dx * dx + dy * dy) ** 0.5
                        if dist < 2 * r + 0.6:
                            ux, uy = (dx / dist, dy / dist) if dist > 1e-6 else (0.6, 0.8)
                            push = (2 * r + 0.6 - dist) / 2
                            pos[a][0] -= ux * push
                            pos[a][1] -= uy * push
                            pos[b][0] += ux * push
                            pos[b][1] += uy * push
                            moved = True
            if not moved:
                break
        for n, x0, y0 in sorted(items, reverse=True):  # o 1º fica por cima
            cx, cy = pos[n]
            if abs(cx - x0) + abs(cy - y0) > r * 0.6:  # deslocado: linha até o ponto real do bairro
                self.color("draw", C["coal"])
                self.set_line_width(0.25)
                self.line(x0, y0, cx, cy)
                self.color("fill", C["coal"])
                self.circle(x0, y0, 0.6, "F")
            self.color("draw", C["paper"])
            self.set_line_width(0.4)
            self.color("fill", C["coal"])
            self.circle(cx, cy, r, "DF")
            self.font(r * 2.8, "b", "on_dark")
            self.set_xy(cx - r, cy - r)
            self.cell(2 * r, 2 * r, str(n), align="C")


# ---- páginas -----------------------------------------------------------------------------------------------------

def cover(pdf: Doc, d: dict, shapes: dict, title: str, subtitle: str):
    pdf.add_page()
    pdf.color("fill", C["coal"])
    pdf.rect(0, 0, 210, 297, "F")
    # silhueta da cidade (desenho próprio) em tom discreto
    if shapes["paths"]:
        sw, sh = shapes["w"], shapes["h"]
        s = min(120 / sw, 130 / sh)
        stroke = max(sw, sh) / 400
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{sw:.0f}" height="{sh:.0f}" viewBox="0 0 {sw:.0f} {sh:.0f}">'
               + "".join(f'<path d="{p["d"]}" fill="{C["coal2"]}" stroke="{C["copper"]}" stroke-width="{stroke:.0f}"/>' for p in shapes["paths"])
               + "</svg>")
        pdf.image(io.BytesIO(svg.encode()), x=210 - M - sw * s, y=34, w=sw * s, h=sh * s, alt_text="Contorno dos bairros da cidade")
    pdf.font(11, "b", "on_dark")
    pdf.set_char_spacing(3)
    pdf.set_xy(M, 22)
    pdf.cell(60, 6, PRODUCT_NAME.upper())
    pdf.set_char_spacing(0)
    pdf.color("fill", C["copper"])
    pdf.rect(M, 31, 14, 0.9, "F")
    y = 182
    pdf.label(M, y, title, "copper_soft")
    y = pdf.text_at(M, y + 6, W, f"{d['city']['name']} – {d['city']['uf']}", 34, "b", "on_dark", h=14)
    y = pdf.text_at(M, y + 2, W * 0.8, subtitle, 13, "", "on_dark_muted", h=6.2)
    y += 10
    pdf.hr(y, color="coal2", lw=0.3)
    company = d["company"]
    rows = [("Empresa", company["name"] or "não informada"), ("Ramo", company["segment"] or "não informado"),
            ("Gerado em", d["generated_label"]), ("Código dos parâmetros", d["params_code"])]
    cw = W / 4
    for i, (k, v) in enumerate(rows):
        pdf.label(M + i * cw, y + 5, k, "on_dark_muted", w=cw - 4)
        pdf.text_at(M + i * cw, y + 10, cw - 4, v, 9.5, "m", "on_dark", h=4.6)
    pdf.color("draw", C["copper_soft"])
    pdf.set_line_width(0.3)
    pdf.font(7.5, "sb", "copper_soft")
    pdf.set_char_spacing(0.5)
    tw = pdf.get_string_width(NOT_ADVICE.upper()) + 8
    pdf.rect(M, 268, tw, 7, "D", round_corners=True, corner_radius=3.5)
    pdf.set_xy(M, 268)
    pdf.cell(tw, 7, NOT_ADVICE.upper(), align="C")
    pdf.set_char_spacing(0)


def cell_or(v, fmt) -> str:
    return "sem dado¹" if v is None else fmt(v)


def summary(pdf: Doc, d: dict, shapes: dict):
    pdf.add_page()
    n = len(d["neighborhoods"])
    y = pdf.page_title("Resumo", f"Os {n} {d['unit']} que mais combinam com os seus critérios",
                       f"Entre os {num(d['count'])} {d['unit']} de {d['city']['name']} com dados, ordenados pela nota de 0 a 100 "
                       "calculada com os critérios e pesos que você definiu.")
    ranks = {h["id"]: h["rank"] for h in d["neighborhoods"]}
    mx, mw, mh = M, 92, 104
    pdf.box(mx, y, mw, mh, "stone")
    pdf.city_map(shapes, mx + 4, y + 4, mw - 8, mh - 16, ranks,
                 alt=f"Mapa de {d['city']['name']} com os {n} {d['unit']} numerados pela posição")
    # legenda: cor + número
    lx = mx + 5
    for h in d["neighborhoods"]:
        pdf.color("fill", SCALE[h["rank"] - 1])
        pdf.rect(lx, y + mh - 8.5, 4, 4, "F")
        pdf.font(7, "sb", "ink")
        pdf.set_xy(lx + 4.6, y + mh - 8.5)
        pdf.cell(8, 4, f"{h['rank']}º")
        lx += 13
    pdf.source(lx + 1, y + mh - 9, mx + mw - lx - 3, "Número = posição no ranking. Limites: IBGE, 2022.")
    # como ler
    rx, rw = mx + mw + 8, W - mw - 8
    ry = pdf.label(rx, y + 2, "Como ler este relatório", "copper_dark", w=rw)
    reading = [
        ("A nota compara bairros desta cidade entre si.", "Ela diz quanto cada bairro combina com os seus critérios em relação aos outros, não uma chance de sucesso."),
        ("Cada número tem fonte e data.", "Quando falta um dado, o relatório diz isso na linha do dado, sem estimar."),
        ("Quem decide é você.", "Use os números para escolher onde olhar de perto; visite e confira no local."),
    ]
    for i, (t, s) in enumerate(reading, 1):
        pdf.badge(rx + 3, ry + 5.2, 3, i, "copper_wash", "copper_dark", 8)
        yy = pdf.text_at(rx + 9, ry + 2.5, rw - 9, t, 9.5, "sb", "ink", h=4.6)
        ry = pdf.text_at(rx + 9, yy + 0.5, rw - 9, s, 8.6, "", "muted", h=4.2) + 4.5
    # tabela
    y = y + mh + 8
    cols = [("Pos.", 11, "C"), ("Bairro" if d["unit"] == "bairros" else "Área", 39, "L"), ("Nota", 15, "R"), ("População", 21, "R"),
            ("hab/km²", 18, "R"), ("Renda mediana", 24, "R"), ("Mesmo ramo", 23, "R"), ("Linha reta até a sede", 23, "R")]
    x = M
    pdf.color("fill", C["coal"])
    pdf.rect(M, y, W, 10, "F")
    for t, w, a in cols:
        pdf.text_at(x + 1.5, y + 2, w - 3, t.upper(), 6.2, "sb", "on_dark", a, h=3, spacing=0.3)
        x += w
    y += 10
    for i, h in enumerate(d["neighborhoods"]):
        inc = h["income"]
        comp = h["competition"]
        vals = [
            str(h["rank"]), h["name"], num(h["score"], 1), cell_or(h["population"], num), cell_or(h["pop_density"], num),
            (money(inc["median"]) + ("*" if inc.get("approximate") else "")) if inc.get("available") else "sem dado¹",
            "sem dado¹" if comp is None else f"{num(comp['n'])}",
            "sem sede²" if not d["hq"] else cell_or(h["straight_km"], lambda v: num(v, 1) + " km"),
        ]
        pdf.color("fill", C["stone"] if i % 2 == 0 else C["paper"])
        pdf.rect(M, y, W, 9, "F")
        pdf.color("fill", SCALE[h["rank"] - 1])
        pdf.rect(M, y, 1.4, 9, "F")
        x = M
        for (t, w, a), v in zip(cols, vals):
            weight = "b" if t in ("Pos.", "Nota") else ("sb" if t.startswith(("Bairro", "Área")) else "")
            pdf.font(8.4, weight, "ink")
            pdf.set_xy(x + 1.5, y)
            vv = v
            while pdf.get_string_width(vv) > w - 3 and len(vv) > 4:
                vv = vv[:-2] + "…" if not vv.endswith("…") else vv[:-2] + "…"
            pdf.cell(w - 3, 9, vv, align=a)
            x += w
        y += 9
    y += 2.5
    missing = d["competitor"] is None or any(
        h["population"] is None or h["pop_density"] is None or not h["income"].get("available") for h in d["neighborhoods"])
    notes = ["Nota de 0 a 100: motor de ranking do " + PRODUCT_NAME + " sobre os dados abaixo.",
             f"População e renda: IBGE, Censo 2022. Concorrência: estabelecimentos de {d['competitor']['name_plural'].lower()} no bairro "
             f"({'CNES' if d['competitor']['source'] == 'cnes' else 'Receita Federal, CNPJ'}, ref. {d['reference_dates']['establishments']})."
             if d["competitor"] else "População e renda: IBGE, Censo 2022.",
             "Linha reta: distância calculada por nós entre um ponto dentro do bairro e o ponto da sede.",
             ]
    if any(h["income"].get("approximate") for h in d["neighborhoods"]):
        notes.append("* Renda aproximada: média das medianas dos setores censitários da área, ponderada pelos domicílios.")
    if missing:
        notes.append("¹ sem dado: " + NO_DATA.format(item="[item da coluna]"))
    if not d["hq"]:
        notes.append("² Sem sede cadastrada no perfil: a distância não é calculada.")
    for t in notes:
        y = pdf.source(M, y, W, t.strip())


def criteria_page(pdf: Doc, d: dict, google: dict):
    pdf.add_page()
    y = pdf.page_title("Seus critérios", "O que você pediu para esta análise",
                       "Os critérios, pesos e a cidade são os da tela do explorador no momento em que o relatório foi gerado.")
    c = d["company"]
    cw = W / 3
    pdf.box(M, y, W, 20, "stone")
    for i, (k, v, note) in enumerate([
        ("Empresa", c["name"] or "não informada", None),
        ("Ramo", c["segment"] or "não informado", None),
        ("Faixa de faturamento informada", c["revenue"], "Não entra no cálculo da nota."),
    ]):
        ly = pdf.label(M + 5 + i * cw, y + 4, k, w=cw - 8)
        yy = pdf.text_at(M + 5 + i * cw, max(y + 8.5, ly + 1), cw - 8, v, 9.5, "sb", "ink", h=4.4)
        if note:
            pdf.source(M + 5 + i * cw, yy + 0.3, cw - 8, note)
    y += 27
    colw = (W - 8) / 2
    for j, (dirk, title) in enumerate((("attract", "O que você quer perto"), ("repel", "O que você quer longe"))):
        x = M + j * (colw + 8)
        yy = pdf.label(x, y, title, "copper_dark", w=colw) + 1.5
        items = [k for k in d["criteria"] if k["direction"] == dirk]
        if not items:
            yy = pdf.text_at(x, yy, colw, "Nenhum critério nesta lista.", 9, "", "muted")
        for k in items:
            pdf.hr(yy, x, x + colw)
            pdf.text_at(x, yy + 2.6, colw - 30, k["name_plural"] + (" (aprox.)" if k["precision"] == "approx" else ""), 10, "sb", "ink", h=4.6)
            for s in range(5):  # peso: 5 quadrados + o número
                pdf.color("fill", C["copper"] if s < k["weight"] else C["sand"])
                pdf.rect(x + colw - 29 + s * 3.6, yy + 3.4, 2.8, 2.8, "F")
            pdf.text_at(x + colw - 10, yy + 2.6, 10, f"{k['weight']}/5", 8.5, "sb", "ink", "R")
            yy += 10
        y_end = yy
        if j == 0:
            y_left = y_end
    y = max(y_left, y_end) + 2
    y = pdf.source(M, y, W, "Peso de 1 (pouco importante) a 5 (muito importante). Fonte de cada tipo: Receita Federal (CNPJ) ou "
                         "Ministério da Saúde (CNES), conforme a página de fontes.") + 6

    # cidade em números
    y = pdf.label(M, y, f"{d['city']['name']} em números", "copper_dark") + 2
    cc = d["city_coverage"]
    tiles = [
        ("População", num(d["city"]["population"]) if d["city"]["population"] else "sem dado", "IBGE, Censo 2022"),
        ("Área", (num(d["city"]["area_km2"], 1) + " km²") if d["city"]["area_km2"] else "sem dado", "IBGE, Censo 2022"),
        (d["unit"].capitalize() + " no ranking", num(d["count"]), "IBGE, malha 2022"),
        ("Localizados", f"{num(cc['share'] * 100)}%", f"de {num(cc['total_active'])} ativos, CNPJ ref. {d['reference_dates']['establishments']}"),
    ]
    tw = (W - 3 * 4) / 4
    for i, (k, v, s) in enumerate(tiles):
        x = M + i * (tw + 4)
        pdf.box(x, y, tw, 24, "stone")
        pdf.label(x + 4, y + 3.5, k, w=tw - 8)
        pdf.text_at(x + 4, y + 8, tw - 8, v, 14, "b", "ink", h=6.5)
        pdf.source(x + 4, y + 16.5, tw - 8, s)
    y += 32

    # sede e deslocamento
    y = pdf.label(M, y, "Sede e deslocamento", "copper_dark") + 1.5
    hq = d["hq"]
    if not hq:
        pdf.text_at(M, y, W, "Sem sede cadastrada no perfil: as distâncias não são calculadas.", 9.5, "", "muted")
        return
    y = pdf.text_at(M, y, W, f"Sede: {hq['label']}", 10, "sb", "ink", h=5)
    if hq.get("note"):
        y = pdf.source(M, y + 0.5, W, hq["note"])
    y += 3
    ok = google.get("ok")
    cols = [("Pos.", 12), (d["unit"][:-1].capitalize() if d["unit"] == "bairros" else "Área", 62), ("Linha reta (nossa conta)", 34)]
    if ok:
        cols += [("De carro: tempo", 32), ("De carro: distância", 34)]
    tw = sum(w for _, w in cols)
    top = y
    pdf.color("fill", C["coal"])
    pdf.rect(M, y, tw, 8, "F")
    x = M
    for t, w in cols:
        pdf.text_at(x + 2, y + 2.6, w - 4, t.upper(), 6.2, "sb", "on_dark", h=3, spacing=0.3)
        x += w
    y += 8
    for i, h in enumerate(d["neighborhoods"]):
        cell = google["cells"].get(i) if ok else None
        vals = [str(h["rank"]), h["name"], num(h["straight_km"], 1) + " km" if h["straight_km"] is not None else "sem dado"]
        if ok:
            vals += [f"{cell['min']} min" if cell else "sem rota", f"{num(cell['km'], 1)} km" if cell else "sem rota"]
        pdf.color("fill", C["stone"] if i % 2 == 0 else C["paper"])
        pdf.rect(M, y, tw, 8, "F")
        x = M
        for (t, w), v in zip(cols, vals):
            pdf.font(8.6, "b" if t == "Pos." else "", "ink")
            pdf.set_xy(x + 2, y)
            pdf.cell(w - 4, 8, v)
            x += w
        y += 8
    if ok:  # bloco do Google separado por borda e com atribuição (docs/GOOGLE-MAPS.md)
        gx = M + 108
        pdf.color("draw", C["sage_dark"])
        pdf.set_line_width(0.4)
        pdf.rect(gx, top, tw - 108, y - top, "D")
        y = pdf.text_at(gx, y + 1.5, tw - 108, "Fonte: Google Maps", 7.5, "sb", "sage_dark", "R") + 0.5
        pdf.source(M, y, W, f"Tempo e distância de carro: Google Maps, consultado em {d['generated_label']}, sem trânsito em tempo real, "
                            "do ponto do bairro até a sede. Não são guardados pelo " + PRODUCT_NAME + ".")
    else:
        y = pdf.text_at(M, y + 2, W, "Tempo de deslocamento indisponível neste relatório.", 9, "sb", "muted") + 0.5
        pdf.source(M, y, W, "Linha reta: calculada por nós (PostGIS) entre um ponto dentro do bairro e o ponto da sede; "
                            "não considera ruas nem trânsito.")


def neighborhood_page(pdf: Doc, d: dict, h: dict, shapes: dict, google_ok: bool):
    pdf.add_page()
    unit1 = "bairro" if d["unit"] == "bairros" else "área"
    y = 28
    pdf.badge(M + 9, y + 9, 9, h["rank"], "coal", "on_dark", 22)
    tx, tw = M + 24, 94
    pdf.label(tx, y + 1, f"Posição {h['rank']} de {d['count']} · {unit1}", "copper_dark", w=tw)
    yy = pdf.text_at(tx, y + 5.5, tw, h["name"], 22 if len(h["name"]) < 24 else 17, "b", "ink", h=9)
    # nota com barra 0-100
    yy += 2
    pdf.font(26, "b", "ink")
    pdf.set_xy(tx, yy)
    sc = num(h["score"], 1)
    pdf.cell(pdf.get_string_width(sc) + 1, 11, sc)
    pdf.font(10, "", "muted")
    pdf.cell(20, 13, " de 100")
    bar_y = yy + 13.5
    pdf.color("fill", C["sand"])
    pdf.rect(tx, bar_y, tw, 2.2, "F", round_corners=True, corner_radius=1.1)
    pdf.color("fill", SCALE[h["rank"] - 1] if h["rank"] <= 5 else C["sage"])
    pdf.rect(tx, bar_y, max(2.2, tw * h["score"] / 100), 2.2, "F", round_corners=True, corner_radius=1.1)
    pdf.source(tx, bar_y + 3.4, tw, "Nota de 0 a 100 entre os " + d["unit"] + " da cidade, pelos seus critérios e pesos.")
    # mini-mapa
    mx, mw = 210 - M - 52, 52
    pdf.box(mx, y - 1, mw, 56, "stone")
    pdf.city_map(shapes, mx + 3, y + 2, mw - 6, 46, {h["id"]: h["rank"]}, focus=h["id"],
                 alt=f"Mini-mapa: {h['name']} destacado dentro de {d['city']['name']}")
    pdf.source(mx + 3, y + 49.5, mw - 6, f"{h['name']} em cobre. Limites: IBGE, 2022.")
    y = 90

    # indicadores
    inc = h["income"]
    pop_src = "IBGE, Censo 2022" + (" (soma dos setores)" if h["population_method"] == "setores" else "")
    tiles = [
        ("População", num(h["population"]) if h["population"] is not None else None, "habitantes", pop_src, "população"),
        ("Densidade", num(h["pop_density"]) if h["pop_density"] is not None else None, "hab/km²", "IBGE, Censo 2022 ÷ área", "densidade demográfica"),
        ("Renda (mediana)", money(inc["median"]) if inc.get("available") else None,
         ("aproximado, por setores" if inc.get("approximate") else "por responsável, mensal"),
         "IBGE, Censo 2022", "renda"),
        ("Área", num(h["area_km2"], 2) if h["area_km2"] else None, "km²", "IBGE, malha 2022", "área"),
    ]
    tw4 = (W - 12) / 4
    for i, (k, v, unit, src, item) in enumerate(tiles):
        x = M + i * (tw4 + 4)
        pdf.box(x, y, tw4, 30, "stone")
        ly = pdf.label(x + 4, y + 3.5, k, w=tw4 - 8)
        if v is None:
            pdf.text_at(x + 4, ly + 1.5, tw4 - 8, NO_DATA.format(item=item), 7.6, "m", "muted", h=3.6)
        else:
            yv = pdf.text_at(x + 4, ly + 1, tw4 - 8, v, 15 if len(v) < 10 else 12.5, "b", "ink", h=7)
            pdf.text_at(x + 4, yv, tw4 - 8, unit, 7.5, "", "muted", h=3.4)
        pdf.source(x + 4, y + 24, tw4 - 8, src)
    if inc.get("available"):
        y2 = pdf.source(M, y + 31.5, W, inc["text"] + " " + inc["note"])
    else:
        y2 = y + 31.5
    y = y2 + 5

    # barras por critério
    y = pdf.label(M, y, "Como cada critério pesou na nota", "copper_dark") + 0.5
    y = pdf.source(M, y, W, "A nota parte de 50. Cada critério soma (+) ou tira (–) pontos conforme a densidade do tipo no "
                            f"{unit1} comparada à dos outros {d['unit']} e o peso que você deu. Valores em pontos da nota.") + 2.5
    total_w = sum(k["weight"] for k in d["criteria"]) or 1
    max_abs = 50 * max(k["weight"] for k in d["criteria"]) / total_w
    lw_, bw = 92, 56
    cx = M + lw_ + bw / 2 + 4
    row_h = 12.5 if len(h["criteria"]) <= 4 else 11
    for c in h["criteria"]:
        pdf.hr(y)
        pdf.text_at(M, y + 2, lw_, f"{c['name_plural']}" + (" (aprox.)" if c["precision"] == "approx" else "")
                    + f" · quer {direction(c)} · peso {c['weight']}/5", 9.2, "sb", "ink", h=4.2)
        pdf.text_at(M, y + 6.6, lw_, f"{num(c['n'])} no {unit1} · {num(c['density_per_km2'], 2)}/km² · "
                                     f"{ordinal(c['position'])} de {d['count']} neste critério", 7.6, "", "muted", h=3.4)
        pdf.color("fill", C["sand"])
        pdf.rect(cx - bw / 2, y + 4.2, bw, 2.6, "F")
        v = float(c["contribution"])
        L = (bw / 2) * abs(v) / max_abs if max_abs else 0
        pdf.color("fill", C["sage_dark"] if v >= 0 else C["copper"])
        pdf.rect(cx if v >= 0 else cx - L, y + 3.6, max(L, 0.4), 3.8, "F")
        pdf.color("draw", C["ink"])
        pdf.set_line_width(0.35)
        pdf.line(cx, y + 2.6, cx, y + 8.4)
        pdf.font(9.5, "b", "sage_dark" if v >= 0 else "copper_dark")
        pdf.set_xy(cx + bw / 2 + 2, y + 2.6)
        pdf.cell(16, 5, ("+" if v > 0 else "") + num(v, 1).replace("-", "–"))
        y += row_h
    pdf.hr(y)
    y = pdf.source(M, y + 1.2, W, f"Contagens: estabelecimentos distintos localizados no {unit1} (Receita Federal, CNPJ, ref. "
                                  f"{d['reference_dates']['establishments']}; tipos de saúde: CNES). Posição no critério: 1º = o que mais combina com "
                                  "o que você pediu (perto: mais densidade; longe: menos).") + 4

    # concorrência | distância
    bw2 = (W - 6) / 2
    pdf.box(M, y, bw2, 27, "stone")
    pdf.label(M + 4, y + 3.5, "Concorrência", w=bw2 - 8)
    comp = h["competition"]
    if comp is None:
        pdf.text_at(M + 4, y + 8.5, bw2 - 8, d["competition_missing"], 8.4, "m", "muted", h=4)
    else:
        pdf.text_at(M + 4, y + 8, bw2 - 8, f"{num(comp['n'])} {d['competitor']['name_plural'].lower()}", 13, "b", "ink", h=6)
        dens = f"{num(comp['density_per_km2'], 2)} por km²" if comp["density_per_km2"] is not None else NO_DATA.format(item="área")
        pdf.text_at(M + 4, y + 14.5, bw2 - 8, dens + " no " + unit1 + " (mesmo ramo da sua empresa)", 7.8, "", "muted", h=3.6)
        pdf.source(M + 4, y + 21.5, bw2 - 8, ("CNES" if d["competitor"]["source"] == "cnes" else "Receita Federal, CNPJ") +
                   f", ref. {d['reference_dates']['establishments']}")
    x2 = M + bw2 + 6
    pdf.box(x2, y, bw2, 27, "stone")
    pdf.label(x2 + 4, y + 3.5, "Distância até a sede", w=bw2 - 8)
    if not d["hq"]:
        pdf.text_at(x2 + 4, y + 8.5, bw2 - 8, "Sem sede cadastrada no perfil: a distância não é calculada.", 8.4, "m", "muted", h=4)
    elif h["straight_km"] is None:
        pdf.text_at(x2 + 4, y + 8.5, bw2 - 8, NO_DATA.format(item="distância"), 8.4, "m", "muted", h=4)
    else:
        pdf.text_at(x2 + 4, y + 8, bw2 - 8, f"{num(h['straight_km'], 1)} km em linha reta", 13, "b", "ink", h=6)
        pdf.text_at(x2 + 4, y + 14.5, bw2 - 8, "Tempo e distância de carro na página 3." if google_ok
                    else "Tempo de deslocamento indisponível neste relatório.", 7.8, "", "muted", h=3.6)
        pdf.source(x2 + 4, y + 21.5, bw2 - 8, "Calculada por nós (PostGIS), do ponto do bairro à sede")
    y += 32

    # cobertura e avisos
    cov = h["coverage"]
    notes = [f"Cobertura dos dados: {COVERAGE.get(cov['level'], cov['level'])} ({num(cov['located_count'])} cadastros localizados neste {unit1}; "
             f"a faixa compara com os outros {d['unit']} da cidade)."]
    notes.append("Localização por texto: o " + unit1 + " de cada cadastro vem do campo de bairro informado à Receita Federal.")
    if inc.get("approximate"):
        notes.append("Renda aproximada: média das medianas dos setores censitários, ponderada pelos domicílios.")
    if any(c["precision"] == "approx" for c in h["criteria"]):
        notes.append("Tipos marcados \"aprox.\" usam códigos de atividade que incluem outros negócios parecidos.")
    hh = min(283 - 4 - y, 6 + 4.2 * len(notes) + 4)
    pdf.box(y=y, x=M, w=W, h=hh, fill="copper_wash")
    yy = pdf.label(M + 4, y + 3, "Cobertura e avisos", "copper_dark", w=W - 8) + 0.5
    for t in notes:
        yy = pdf.text_at(M + 4, yy, W - 8, "· " + t, 7.6, "", "ink", h=3.7) + 0.4


def method_page(pdf: Doc, d: dict):
    pdf.add_page()
    y = pdf.page_title("Como lemos os dados", "Como a nota é calculada",
                       "Em linguagem simples. O cálculo é o mesmo do explorador e roda no banco de dados; o relatório só o mostra.")
    steps = [
        ("Contamos.", f"Para cada tipo que você escolheu, contamos os estabelecimentos distintos (local = CEP, logradouro e número) "
                      f"localizados em cada {d['unit'][:-1]} da cidade."),
        ("Dividimos pela área.", "Densidade = estabelecimentos por km². Assim um bairro grande não leva vantagem só por ser grande."),
        ("Comparamos com os outros.", f"Percentil: em quantos % dos {d['unit']} a densidade é menor. 0 = a menor da cidade; 1 = a maior."),
        ("Aplicamos perto ou longe.", "Perto: quanto mais densidade, mais combina (encaixe = percentil). Longe: o contrário (encaixe = 1 – percentil)."),
        ("Pesamos.", "Nota = média dos encaixes ponderada pelos pesos de 1 a 5, vezes 100. Empate: ordem alfabética do nome."),
    ]
    for i, (t, s) in enumerate(steps, 1):
        pdf.badge(M + 4, y + 4, 4, i, "coal", "on_dark", 10)
        yy = pdf.text_at(M + 12, y + 0.6, W - 12, t, 10.5, "sb", "ink", h=5)
        y = pdf.text_at(M + 12, yy + 0.3, W - 12, s, 9, "", "muted", h=4.4) + 5
    # exemplo com os dados deste relatório
    h = d["neighborhoods"][0]
    c = h["criteria"][0]
    fit = c["percentile"] if c["direction"] == "attract" else 1 - c["percentile"]
    total_w = sum(k["weight"] for k in d["criteria"])
    y += 2
    pdf.box(M, y, W, 52, "stone")
    yy = pdf.label(M + 6, y + 5, "Exemplo com os números deste relatório", "copper_dark", w=W - 12) + 1.5
    lines = [
        f"{h['name']}, {c['name_plural'].lower()} ({'quer perto' if c['direction'] == 'attract' else 'quer longe'}, peso {c['weight']}):",
        f"· {num(c['n'])} {'estabelecimento' if c['n'] == 1 else 'estabelecimentos'} em {num(h['area_km2'] or 0, 2)} km² = {num(c['density_per_km2'], 2)} por km².",
        f"· Densidade maior que a de {num(c['percentile'] * 100)}% dos {d['unit']}: percentil {num(c['percentile'], 2)}.",
        f"· {'Perto' if c['direction'] == 'attract' else 'Longe'}: encaixe {num(fit, 2)}.",
        f"· Os pesos somam {total_w}; este critério vale {c['weight']}/{total_w} da nota: "
        f"{('+' if c['contribution'] > 0 else '')}{num(c['contribution'], 1).replace('-', '–')} pontos a partir de 50.",
        f"· Somando todos os critérios: nota {num(h['score'], 1)}, {h['rank']}ª posição entre {num(d['count'])} {d['unit']}.",
    ]
    for i, t in enumerate(lines):
        yy = pdf.text_at(M + 6, yy + (0 if i else 0.5), W - 12, t, 9.6 if i == 0 else 9, "sb" if i == 0 else "", "ink", h=4.8) + 1.6
    y += 60
    y = pdf.label(M, y, "O que a nota não diz", "copper_dark") + 1.5
    for t in [
        "Não prevê vendas, faturamento, lucro nem chance de sucesso. Aluguel, fluxo de pessoas e segurança não entram no cálculo.",
        "Faturamento da empresa e localização da sede não mudam a nota; a sede só serve para medir distâncias.",
        f"Nenhum dado é estimado: quando falta um número, o relatório escreve \"{NO_DATA.format(item='[item]')}\"",
    ]:
        y = pdf.text_at(M, y, W, "· " + t, 9, "", "ink", h=4.5) + 1.5


def sources_page(pdf: Doc, d: dict, google: dict):
    pdf.add_page()
    y = pdf.page_title("Fontes, datas e cobertura", "De onde vem cada número")
    use = {
        "rfb_cnpj": "contagens de estabelecimentos e concorrência", "ms_cnes": "tipos de saúde (hospitais e afins)",
        "ibge_bairros": "limites dos bairros e mapas", "ibge_setores": "limites das áreas e mapas",
        "ibge_censo_renda": "renda mediana", "ibge_censo_basico": "população e área da cidade",
        "ibge_censo_basico_bairros": "população dos bairros", "ibge_malha_municipal": "contorno da cidade",
        "ibge_malhas": "malhas do explorador",
    }
    cols = [("Fonte", 104), ("Referência", 30), ("Uso neste relatório", W - 134)]
    pdf.color("fill", C["coal"])
    pdf.rect(M, y, W, 8, "F")
    x = M
    for t, w in cols:
        pdf.text_at(x + 2, y + 2.6, w - 4, t.upper(), 6.2, "sb", "on_dark", h=3, spacing=0.3)
        x += w
    y += 8
    rows = [(s["name"], s["reference_date"], use[s["key"]]) for s in d["sources"] if s["key"] in use and s["key"] != "ibge_malhas"]
    if google.get("ok"):
        rows.append(("Google Maps (Routes API), tempo e distância de carro", f"consulta em {d['generated_label']}", "deslocamento até a sede (página 3)"))
    for i, row in enumerate(rows):
        hgt = 3.2 + 3.3 * max(pdf.lines(w - 4, v, 7.4, "m" if t == "Fonte" else "") for (t, w), v in zip(cols, row))
        pdf.color("fill", C["stone"] if i % 2 == 0 else C["paper"])
        pdf.rect(M, y, W, hgt, "F")
        x = M
        for (t, w), v in zip(cols, row):
            pdf.text_at(x + 2, y + 1.6, w - 4, v, 7.4, "m" if t == "Fonte" else "", "ink", h=3.3)
            x += w
        y += hgt
    y += 6
    cc = d["city_coverage"]
    y = pdf.label(M, y, f"Cobertura em {d['city']['name']}", "copper_dark") + 1.5
    located = (f"{num(cc['share'] * 100)}% dos {num(cc['total_active'])} cadastros ativos do CNPJ (ref. {d['reference_dates']['establishments']}) "
               f"foram localizados em um dos {d['unit']}")
    if cc.get("located_exact") is not None:
        located += (f": {num(cc['located_exact'])} pelo nome exato do bairro, {num(cc['located_alias'] or 0)} por nome alternativo "
                    f"conhecido e {num(cc['located_trigram'] or 0)} por semelhança de texto")
    y = pdf.text_at(M, y, W, located + ". Os não localizados não entram nas contagens.", 9, "", "ink", h=4.5) + 2
    if d["excluded"]:
        y = pdf.text_at(M, y, W, f"Fora do ranking: {', '.join(e['name'] for e in d['excluded'])} (área inválida no limite do IBGE).", 8.4, "", "muted", h=4.2) + 2
    y = pdf.text_at(M, y + 2, W, "Mapas deste relatório: desenho próprio a partir dos limites do IBGE, sem mapa-base de terceiros "
                                 "(sem OpenStreetMap e sem Google). "
                                 + ("Tempos de carro: Google Maps, na página 3, que não tem mapa." if google.get("ok") else ""),
                    8.4, "", "muted", h=4.2) + 8
    # aviso legal
    hh = 36
    pdf.box(M, y, W, hh, "coal")
    yy = pdf.label(M + 6, y + 5, "Aviso legal", "copper_soft", w=W - 12) + 1.5
    yy = pdf.text_at(M + 6, yy, W - 12, LEGAL, 10, "sb", "on_dark", h=5) + 1.5
    pdf.text_at(M + 6, yy, W - 12, LEGAL_APP + f" Código dos parâmetros: {d['params_code']} (mesmos critérios e mesma base geram o mesmo ranking).",
                8.2, "", "on_dark_muted", h=4)


def render_report(d: dict, shapes: dict, google: dict) -> bytes:
    pdf = Doc(d, "Relatório de localização")
    pdf.has_cover = True
    n = len(d["neighborhoods"])
    cover(pdf, d, shapes, "Relatório de localização", f"Os {n} {d['unit']} que mais combinam com os seus critérios")
    summary(pdf, d, shapes)
    criteria_page(pdf, d, google)
    for h in d["neighborhoods"]:
        neighborhood_page(pdf, d, h, shapes, bool(google.get("ok")))
    method_page(pdf, d)
    sources_page(pdf, d, google)
    return bytes(pdf.output())

