"""Roteiro de visita (impressão, uma página por bairro) e modo apresentação em PDF (A4 paisagem).

Mesmos dados, avisos e paleta do relatório (app/report/pdf.py). Tempo de carro do Google só na página 1 do roteiro,
que não tem mapa; os slides não usam Google.
"""
from app.config import PRODUCT_NAME
from app.report.pdf import C, COVERAGE, LEGAL, LEGAL_APP, NOT_ADVICE, SCALE, M, W, Doc, direction, money, num, ordinal
from app.scoring.rank import NO_DATA


def render_route(d: dict, shapes: dict, plan: dict, checklist: list[tuple[str, str]]) -> bytes:
    pdf = Doc(d, "Roteiro de visita")
    by_id = {h["id"]: h for h in d["neighborhoods"]}
    unit1 = "bairro" if d["unit"] == "bairros" else "área"
    pdf.add_page()
    y = pdf.page_title("Roteiro de visita", f"3 {d['unit']} para conhecer de perto",
                       f"{d['city']['name']} – {d['city']['uf']}. Ordem sugerida pela menor soma de {plan['basis']}"
                       + (", saindo da sede." if d["hq"] else ".") + " A ordem é só uma sugestão de trajeto; leve as páginas "
                       "seguintes para anotar o que observar no local.")
    for s in plan["stops"]:
        h = by_id[s["id"]]
        pdf.box(M, y, W, 34, "stone")
        pdf.badge(M + 10, y + 11, 6.5, s["order"], "coal", "on_dark", 16)
        pdf.label(M + 21, y + 4.5, f"Parada {s['order']} · posição {h['rank']} de {d['count']} no ranking", "copper_dark", w=106)
        pdf.text_at(M + 21, y + 9, 106, h["name"], 15, "b", "ink", h=6.5)
        pdf.text_at(M + 21, y + 17, 106, f"Nota {num(h['score'], 1)} de 100", 9, "m", "muted")
        leg, lx = s["leg"], M + 130
        if leg is None:
            pdf.text_at(lx, y + 5, W - 134, "Primeira parada (sem sede cadastrada).", 8.4, "", "muted", h=4)
        else:
            yy = pdf.label(lx, y + 4.5, f"Saindo de {leg['from']}", w=W - 134)
            yy = pdf.text_at(lx, yy + 1.5, W - 134, f"{num(leg['straight_km'], 1)} km em linha reta", 9.5, "sb", "ink", h=4.5)
            if leg["car_min"] is not None:
                yy = pdf.text_at(lx, yy + 1, W - 134, f"De carro: {leg['car_min']} min · {num(leg['car_km'], 1)} km", 9.5, "sb", "sage_dark", h=4.5)
                pdf.source(lx, yy + 0.5, W - 134, "Fonte: Google Maps")
            else:
                pdf.source(lx, yy + 1, W - 134, "Tempo de deslocamento indisponível neste roteiro.")
        y += 38
    note = (f"Tempos e distâncias de carro: Google Maps, consultados em {d['generated_label']}, sem trânsito em tempo real. "
            "Linha reta: calculada por nós (PostGIS).") if plan["google_ok"] else (
        "Tempo de deslocamento indisponível neste roteiro. Linha reta: calculada por nós (PostGIS), não considera ruas.")
    y = pdf.source(M, y, W, note) + 8
    y = pdf.label(M, y, "Como usar", "copper_dark") + 1.5
    for t in [f"Imprima as próximas páginas (uma por {unit1}) ou abra o roteiro no celular e marque as caixas no local.",
              f"Visite em dias e horários parecidos com os do seu negócio, para comparar os {d['unit']} de forma justa.",
              "O checklist está em branco de propósito: quem observa e anota é você."]:
        y = pdf.text_at(M, y, W, "· " + t, 9, "", "ink", h=4.5) + 1.5
    pdf.box(M, 254, W, 24, "coal")
    yy = pdf.text_at(M + 6, 258, W - 12, LEGAL, 9, "sb", "on_dark", h=4.4)
    pdf.text_at(M + 6, yy + 0.5, W - 12, LEGAL_APP, 7.6, "", "on_dark_muted", h=3.8)

    for s in plan["stops"]:
        h = by_id[s["id"]]
        pdf.add_page()
        y = 28
        pdf.badge(M + 8, y + 8, 8, s["order"], "coal", "on_dark", 18)
        pdf.label(M + 21, y + 1, f"Parada {s['order']} de 3 · posição {h['rank']} no ranking", "copper_dark", w=100)
        yy = pdf.text_at(M + 21, y + 5.5, 100, h["name"], 20, "b", "ink", h=8.5)
        pdf.text_at(M + 21, yy + 1, 100, f"Nota {num(h['score'], 1)} de 100", 9.5, "m", "muted")
        mx = 210 - M - 40
        pdf.box(mx, y - 1, 40, 40, "stone")
        pdf.city_map(shapes, mx + 3, y + 2, 34, 34, {h["id"]: h["rank"]}, focus=h["id"], alt=f"Mini-mapa: {h['name']}")
        y = 74
        facts = [("População", num(h["population"]) if h["population"] is not None else "sem dado¹", "IBGE, Censo 2022")]
        if h["competition"] is not None:
            facts.append((d["competitor"]["name_plural"], num(h["competition"]["n"]), f"no {unit1}, mesmo ramo"))
        for c in h["criteria"]:
            if len(facts) >= 4:
                break
            if not (d["competitor"] and c["type"] == d["competitor"]["key"]):
                facts.append((c["name_plural"], num(c["n"]), f"no {unit1}, quer {direction(c)}"))
        fw = (W - 4 * (len(facts) - 1)) / len(facts)
        for i, (k, v, src) in enumerate(facts):
            x = M + i * (fw + 4)
            pdf.box(x, y, fw, 24, "stone")
            pdf.label(x + 3.5, y + 3, k, w=fw - 7)
            pdf.text_at(x + 3.5, y + 9.5, fw - 7, v, 13, "b", "ink", h=6)
            pdf.source(x + 3.5, y + 17, fw - 7, src)
        y += 26
        y = pdf.source(M, y, W, f"Contagens: Receita Federal (CNPJ) e CNES, ref. {d['reference_dates']['establishments']}. "
                                + ("" if h["population"] is not None else "¹ " + NO_DATA.format(item="população"))) + 5
        y = pdf.label(M, y, "Checklist de campo (preencha no local)", "copper_dark") + 2.5
        for t, hint in checklist:
            pdf.color("draw", C["ink"])
            pdf.set_line_width(0.35)
            pdf.rect(M, y + 0.6, 4.2, 4.2, "D")
            pdf.text_at(M + 7, y, 80, t, 10, "sb", "ink", h=5)
            pdf.text_at(M + 7, y + 5, W - 7, hint, 7.8, "", "muted", h=3.6)
            for k in range(2):
                pdf.hr(y + 15 + k * 7, M + 7, 210 - M, "line", 0.3)
            y += 31
        y = pdf.label(M, y, "Anotações livres", "copper_dark") + 3
        while y < 274:
            pdf.hr(y + 4, color="line", lw=0.3)
            y += 7
    return bytes(pdf.output())


class Slides(Doc):
    def header(self):
        self.color("fill", C["paper"])
        self.rect(0, 0, 297, 210, "F")

    def footer(self):
        if self.dark_page:
            return
        self.font(7, "", "muted")
        self.set_xy(16, 199)
        self.cell(220, 4, f"{PRODUCT_NAME} · {self.d['city']['name']} – {self.d['city']['uf']} · {NOT_ADVICE} · "
                          f"código dos parâmetros {self.d['params_code']}")
        self.set_xy(16, 199)
        self.cell(265, 4, f"{self.page_no()} / {{nb}}", align="R")


def render_slides(d: dict, shapes: dict) -> bytes:
    pdf = Slides(d, "Apresentação", "L")
    X, SW = 16, 265
    n = len(d["neighborhoods"])
    unit1 = "bairro" if d["unit"] == "bairros" else "área"
    ranks = {h["id"]: h["rank"] for h in d["neighborhoods"]}
    # 1. título (escuro)
    pdf.dark_page = True
    pdf.add_page()
    pdf.color("fill", C["coal"])
    pdf.rect(0, 0, 297, 210, "F")
    pdf.font(10, "b", "on_dark")
    pdf.set_char_spacing(3)
    pdf.set_xy(X, 18)
    pdf.cell(60, 6, PRODUCT_NAME.upper())
    pdf.set_char_spacing(0)
    pdf.color("fill", C["copper"])
    pdf.rect(X, 27, 14, 0.9, "F")
    pdf.city_map(shapes, 170, 26, 112, 150, ranks, alt="Mapa da cidade com as posições numeradas")
    pdf.label(X, 104, "Apresentação", "copper_soft", w=140)
    y = pdf.text_at(X, 110, 145, f"{d['city']['name']} – {d['city']['uf']}", 32, "b", "on_dark", h=13)
    pdf.text_at(X, y + 2, 145, f"Os {n} {d['unit']} que mais combinam com os critérios de {d['company']['name'] or 'sua empresa'}",
                13, "", "on_dark_muted", h=6.2)
    pdf.text_at(X, 178, 150, f"{d['generated_label']} · código dos parâmetros {d['params_code']}", 8.5, "", "on_dark_muted")
    pdf.text_at(X, 184, 150, NOT_ADVICE, 8.5, "sb", "copper_soft")
    pdf.dark_page = False

    def title(kicker, t):
        pdf.label(X, 16, kicker, "copper_dark", w=SW)
        return pdf.text_at(X, 21, SW, t, 20, "b", "ink", h=9) + 6

    # 2. critérios
    pdf.add_page()
    y = title("Critérios usados", "O que a empresa pediu")
    colw = (SW - 10) / 2
    for j, (dirk, t) in enumerate((("attract", "Quer perto"), ("repel", "Quer longe"))):
        x = X + j * (colw + 10)
        yy = pdf.label(x, y, t, w=colw) + 2
        items = [k for k in d["criteria"] if k["direction"] == dirk]
        if not items:
            pdf.text_at(x, yy + 2, colw, "Nenhum critério.", 11, "", "muted")
        for k in items:
            pdf.hr(yy, x, x + colw)
            pdf.text_at(x, yy + 3, colw - 30, k["name_plural"], 13, "sb", "ink", h=6)
            pdf.text_at(x + colw - 28, yy + 3.5, 28, f"peso {k['weight']}/5", 11, "m", "copper_dark", "R")
            yy += 13
    pdf.box(X, 148, SW, 36, "stone")
    cc = d["city_coverage"]
    facts = [("Ramo", d["company"]["segment"] or "não informado"), (d["unit"].capitalize() + " comparados", num(d["count"])),
             ("Cadastros localizados", f"{num(cc['share'] * 100)}%"), ("Base do CNPJ", f"ref. {d['reference_dates']['establishments']}")]
    fw = SW / 4
    for i, (k, v) in enumerate(facts):
        pdf.label(X + 6 + i * fw, 155, k, w=fw - 10)
        pdf.text_at(X + 6 + i * fw, 161, fw - 10, v, 14, "b", "ink", h=6.5)
    pdf.source(X + 6, 175, SW - 12, "Faixa de faturamento e sede não entram na nota. Fontes completas no último slide.")

    # 3. resumo
    pdf.add_page()
    y = title("Resumo", f"Os {n} {d['unit']} que mais combinam com os critérios")
    pdf.box(X, y, 100, 142, "stone")
    pdf.city_map(shapes, X + 4, y + 4, 92, 134, ranks, alt="Mapa da cidade com as posições numeradas")
    tx, tw = X + 110, SW - 110
    for h in d["neighborhoods"]:
        pdf.color("fill", SCALE[h["rank"] - 1])
        pdf.rect(tx, y, 2, 23, "F")
        pdf.badge(tx + 11, y + 11.5, 6, h["rank"], "coal", "on_dark", 15)
        pdf.text_at(tx + 21, y + 4, tw - 70, h["name"], 14, "sb", "ink", h=6.2)
        pdf.text_at(tx + 21, y + 13, tw - 70, f"{num(h['population'])} habitantes (IBGE, Censo 2022)" if h["population"] is not None
                    else NO_DATA.format(item="população"), 9, "", "muted")
        pdf.text_at(tx + tw - 48, y + 3, 48, num(h["score"], 1), 22, "b", "ink", "R", h=9)
        pdf.text_at(tx + tw - 48, y + 13, 48, "nota de 0 a 100", 7.5, "", "muted", "R")
        y += 28

    # 4. um slide por bairro
    total_w = sum(k["weight"] for k in d["criteria"]) or 1
    max_abs = 50 * max(k["weight"] for k in d["criteria"]) / total_w
    for h in d["neighborhoods"]:
        pdf.add_page()
        pdf.badge(X + 10, 27, 10, h["rank"], "coal", "on_dark", 24)
        pdf.label(X + 25, 18, f"Posição {h['rank']} de {d['count']}", "copper_dark", w=150)
        pdf.text_at(X + 25, 23, 150, h["name"], 24 if len(h["name"]) < 26 else 18, "b", "ink", h=10)
        pdf.text_at(X + 180, 15, 85, num(h["score"], 1), 34, "b", "ink", "R", h=14)
        pdf.text_at(X + 180, 30, 85, "nota de 0 a 100", 8, "", "muted", "R")
        inc = h["income"]
        comp = h["competition"]
        tiles = [
            ("População", num(h["population"]) if h["population"] is not None else None, "IBGE, Censo 2022", NO_DATA.format(item="população")),
            ("hab/km²", num(h["pop_density"]) if h["pop_density"] is not None else None, "IBGE, Censo 2022", NO_DATA.format(item="densidade demográfica")),
            ("Renda mediana" + (" (aprox.)" if inc.get("approximate") else ""), money(inc["median"]) if inc.get("available") else None,
             "IBGE, Censo 2022", NO_DATA.format(item="renda")),
            ("Concorrência", None if comp is None else num(comp["n"]),
             f"{d['competitor']['name_plural']}, ref. {d['reference_dates']['establishments']}" if d["competitor"] else "", d["competition_missing"]),
            ("Linha reta à sede", num(h["straight_km"], 1) + " km" if h["straight_km"] is not None else None, "nossa conta (PostGIS)",
             "Sem sede cadastrada." if not d["hq"] else NO_DATA.format(item="distância")),
        ]
        tw = (200 - 16) / 5
        for i, (k, v, src, missing) in enumerate(tiles):
            x = X + i * (tw + 4)
            pdf.box(x, 48, tw, 31, "stone")
            ly = pdf.label(x + 3, 51.5, k, w=tw - 6)
            if v is None:
                pdf.text_at(x + 3, max(57, ly + 1), tw - 6, missing, 7, "m", "muted", h=3.3)
            else:
                pdf.text_at(x + 3, max(57, ly + 1), tw - 6, v, 13, "b", "ink", h=6)
            pdf.source(x + 3, 70.5, tw - 6, src)
        pdf.box(X + 205, 48, 60, 72, "stone")
        pdf.city_map(shapes, X + 208, 51, 54, 60, {h["id"]: h["rank"]}, focus=h["id"], alt=f"Mini-mapa: {h['name']}")
        pdf.source(X + 208, 113, 54, "Limites: IBGE, 2022")
        y = pdf.label(X, 87, "Quanto cada critério somou ou tirou da nota (pontos, a partir de 50)", "copper_dark", w=200) + 2.5
        cx, bw = X + 112, 56
        for c in h["criteria"]:
            pdf.text_at(X, y + 0.5, 80, f"{c['name_plural']} · quer {direction(c)} · peso {c['weight']}", 9, "sb", "ink", h=4.4)
            pdf.text_at(X, y + 5.2, 80, f"{num(c['n'])} no {unit1} · {ordinal(c['position'])} de {d['count']} neste critério", 7.4, "", "muted", h=3.4)
            pdf.color("fill", C["sand"])
            pdf.rect(cx - bw / 2, y + 3, bw, 2.4, "F")
            v = float(c["contribution"])
            L = (bw / 2) * abs(v) / max_abs if max_abs else 0
            pdf.color("fill", C["sage_dark"] if v >= 0 else C["copper"])
            pdf.rect(cx if v >= 0 else cx - L, y + 2.4, max(L, 0.4), 3.6, "F")
            pdf.color("draw", C["ink"])
            pdf.set_line_width(0.35)
            pdf.line(cx, y + 1.4, cx, y + 7)
            pdf.font(10, "b", "sage_dark" if v >= 0 else "copper_dark")
            pdf.set_xy(cx + bw / 2 + 3, y + 1.6)
            pdf.cell(20, 5, ("+" if v > 0 else "") + num(v, 1).replace("-", "–"))
            y += 11.5
        cov = h["coverage"]
        pdf.source(X, max(y + 2, 182), SW, f"Cobertura dos dados neste {unit1}: {COVERAGE.get(cov['level'], cov['level'])} "
                                         f"({num(cov['located_count'])} cadastros localizados). Contagens: Receita Federal (CNPJ) e CNES, "
                                         f"ref. {d['reference_dates']['establishments']}; localização pelo texto do bairro no cadastro.")

    # 5. método, fontes e aviso legal
    pdf.add_page()
    y = title("Método, fontes e aviso legal", "Como ler estes números")
    colw = (SW - 12) / 2
    yy = y
    for t in [f"Para cada tipo escolhido, contamos estabelecimentos por km² em cada {unit1}.",
              f"Comparamos com os outros {d['unit']} da cidade (percentil).",
              "Perto: mais densidade combina mais. Longe: menos densidade combina mais.",
              "A nota é a média ponderada pelos pesos de 1 a 5, de 0 a 100. Empate: ordem alfabética.",
              f"Mesmos critérios e mesma base = mesmo ranking (código {d['params_code']})."]:
        yy = pdf.text_at(X, yy, colw, "· " + t, 10, "", "ink", h=5) + 2
    yy = y
    for s in [s for s in d["sources"] if s["key"] != "ibge_malhas"]:
        yy = pdf.text_at(X + colw + 12, yy, colw, f"{s['name']} (ref. {s['reference_date']})", 7.8, "", "ink", h=3.7) + 1.4
    pdf.box(X, 156, SW, 34, "coal")
    yy = pdf.text_at(X + 6, 161, SW - 12, LEGAL, 11, "sb", "on_dark", h=5.4)
    pdf.text_at(X + 6, yy + 1, SW - 12, LEGAL_APP, 8.5, "", "on_dark_muted", h=4.2)
    return bytes(pdf.output())
