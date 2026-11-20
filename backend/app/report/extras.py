"""Roteiro de visita (impressão, uma página por bairro) e slides em PDF (16:9, um slide por página).

Mesmos dados, avisos e paleta do relatório (app/report/pdf.py). Nenhum PDF usa o Google (decisão "só na tela").
Os slides são uma narrativa curta, não o relatório fatiado: capa, o que buscamos, visão geral, um slide por bairro
(a nota como número herói), comparação, como lemos, próximos passos e fontes com o aviso legal.
"""
from app.config import PRODUCT_NAME
from app.report.pdf import C, COVERAGE, LEGAL, LEGAL_APP, NOT_ADVICE, SCALE, M, W, Doc, direction, money, num, ordinal
from app.scoring.rank import NO_DATA, comparison_line, sources_line


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
            pdf.text_at(lx, yy + 1.5, W - 134, f"{num(leg['straight_km'], 1)} km em linha reta", 9.5, "sb", "ink", h=4.5)
        y += 38
    y = pdf.source(M, y, W, "Linha reta: calculada por nós (PostGIS), não considera ruas. Tempo de carro: no Roteiro de visita "
                            "dentro do app, quando disponível.") + 8
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
    """16:9 (297 x 167 mm). Cabeçalho = fundo; rodapé = marca, cidade, aviso curto, código e número do slide."""

    def header(self):
        self.color("fill", C["paper"])
        self.rect(0, 0, SW_, SH_, "F")

    def footer(self):
        if self.dark_page:
            return
        self.font(6.5, "", "muted")
        self.set_xy(14, SH_ - 9)
        self.cell(200, 4, f"{PRODUCT_NAME} · {self.d['city']['name']} – {self.d['city']['uf']} · {NOT_ADVICE} · código {self.d['params_code']}")
        self.set_xy(14, SH_ - 9)
        self.cell(SW_ - 28, 4, f"{self.page_no()} / {{nb}}", align="R")


SW_, SH_ = 297, 167.06  # 16:9
IMPORTANCE = {1: "pouco importante", 2: "importante", 3: "importante", 4: "muito importante", 5: "essencial"}


def wants(c: dict) -> str:
    """Critério em linguagem simples: 'Perto de hospitais'."""
    return f"{'Perto de' if c['direction'] == 'attract' else 'Longe de'} {c['name_plural'].lower()}"


def reading(h: dict, d: dict) -> str:
    """Uma frase de leitura, só com números do ranking (sem opinião nem promessa)."""
    unit1 = "bairro" if d["unit"] == "bairros" else "área"
    best = max(h["criteria"], key=lambda c: (c["contribution"], -c["position"]))
    if best["contribution"] <= 0:
        return f"Nenhum critério ficou acima da média dos {d['unit']} da cidade neste {unit1}."
    count = f"nenhum no {unit1}" if best["n"] == 0 else f"{num(best['n'])} no {unit1}"
    return (f"O critério que mais pesou a favor: {wants(best).lower()} ({count}; "
            f"{ordinal(best['position'])} de {d['count']} neste critério).")


def story(d: dict) -> dict:
    """Textos da narrativa dos slides (os mesmos na tela e no PDF)."""
    crit = sorted(d["criteria"], key=lambda c: (-c["weight"], c["name_plural"]))
    return {"wants": [{"text": wants(c), "importance": IMPORTANCE[c["weight"]], "weight": c["weight"], "direction": c["direction"]}
                      for c in crit[:4]],
            "more_criteria": max(0, len(crit) - 4),
            "readings": {h["id"]: reading(h, d) for h in d["neighborhoods"]}}


def render_slides(d: dict, shapes: dict) -> bytes:
    pdf = Slides(d, "Apresentação", "L", (SH_, SW_))
    X, CW = 14, SW_ - 28
    n = len(d["neighborhoods"])
    unit1 = "bairro" if d["unit"] == "bairros" else "área"
    ref = d["reference_dates"]["establishments"]
    ranks = {h["id"]: h["rank"] for h in d["neighborhoods"]}

    def kicker(t, title, y=14):
        pdf.label(X, y, t, "copper_dark", w=CW)
        return pdf.text_at(X, y + 5, CW, title, 22, "b", "ink", h=10) + 4

    def foot(txt):
        pdf.source(X, SH_ - 15.5, CW, txt)

    # (a) capa
    pdf.dark_page = True
    pdf.add_page()
    pdf.color("fill", C["coal"])
    pdf.rect(0, 0, SW_, SH_, "F")
    pdf.font(10, "b", "on_dark")
    pdf.set_char_spacing(3)
    pdf.set_xy(X, 14)
    pdf.cell(60, 6, PRODUCT_NAME.upper())
    pdf.set_char_spacing(0)
    pdf.color("fill", C["copper"])
    pdf.rect(X, 23, 14, 0.9, "F")
    pdf.city_map(shapes, 172, 14, 112, 140, ranks, alt="Mapa da cidade com as posições numeradas")
    pdf.label(X, 80, d["company"]["segment"] or "Análise de localização", "copper_soft", w=150)
    y = pdf.text_at(X, 86, 150, f"{d['city']['name']} – {d['city']['uf']}", 34, "b", "on_dark", h=14)
    pdf.text_at(X, y + 2, 150, f"Os {n} {d['unit']} que mais combinam com os critérios de {d['company']['name'] or 'sua empresa'}",
                13, "", "on_dark_muted", h=6.2)
    pdf.text_at(X, 146, 150, f"{d['generated_label']} · código dos parâmetros {d['params_code']}", 8, "", "on_dark_muted")
    pdf.text_at(X, 152, 150, NOT_ADVICE, 8, "sb", "copper_soft")
    pdf.dark_page = False

    # (b) o que buscamos
    pdf.add_page()
    y = kicker("O que buscamos", "O que a empresa quer por perto e longe")
    crit = sorted(d["criteria"], key=lambda c: (-c["weight"], c["name_plural"]))
    shown = crit[:4]
    cw = (CW - 6 * (len(shown) - 1)) / max(1, len(shown))
    for i, c in enumerate(shown):
        x = X + i * (cw + 6)
        pdf.box(x, y + 4, cw, 70, "stone")
        pdf.color("fill", C["sage_dark"] if c["direction"] == "attract" else C["copper"])
        pdf.rect(x, y + 4, cw, 2.2, "F")
        pdf.text_at(x + 6, y + 14, cw - 12, wants(c), 16, "b", "ink", h=7.5)
        pdf.text_at(x + 6, y + 52, cw - 12, IMPORTANCE[c["weight"]].capitalize(), 11, "sb", "copper_dark", h=5)
        pdf.text_at(x + 6, y + 58.5, cw - 12, f"peso {c['weight']} de 5", 8.5, "", "muted")
    extra = len(crit) - len(shown)
    foot((f"Mais {extra} critério(s) no relatório completo. " if extra else "")
         + "A faixa de faturamento e a sede não entram na nota.")

    # (c) visão geral
    pdf.add_page()
    y = kicker("Visão geral", f"Os {n} {d['unit']} que mais combinam, no mapa")
    pdf.box(X, y, 120, SH_ - y - 20, "stone")
    pdf.city_map(shapes, X + 4, y + 4, 112, SH_ - y - 28, ranks, alt="Mapa com as posições numeradas")
    lx = X + 132
    for h in d["neighborhoods"]:
        pdf.badge(lx + 6, y + 6, 5.5, h["rank"], "coal", "on_dark", 13)
        pdf.color("fill", SCALE[h["rank"] - 1])
        pdf.rect(lx + 14, y + 1, 1.6, 10, "F")
        pdf.text_at(lx + 19, y + 3.2, 100, h["name"], 14, "sb", "ink", h=6)
        pdf.text_at(lx + 112, y + 2.5, 25, num(h["score"], 1), 16, "b", "ink", "R", h=7)
        y += 19
    pdf.text_at(lx + 112, y - 4, 25, "nota 0–100", 7, "", "muted", "R")
    foot(f"Número no mapa = posição. Limites: IBGE, 2022. Nota pelos critérios e pesos definidos; estabelecimentos: CNPJ, ref. {ref}.")

    # (d) um slide por bairro: a nota como herói, 3 apoios, uma frase
    for h in d["neighborhoods"]:
        pdf.add_page()
        pdf.label(X, 14, f"{h['rank']}º de {d['count']} · {unit1}", "copper_dark", w=150)
        pdf.text_at(X, 19, 170, h["name"], 24 if len(h["name"]) < 24 else 19, "b", "ink", h=10)
        pdf.font(64, "b", "ink")
        sc = num(h["score"], 1)
        pdf.set_xy(X - 1, 34)
        pdf.cell(pdf.get_string_width(sc) + 2, 30, sc)
        pdf.text_at(X + pdf.get_string_width(sc) + 3, 52, 40, "de 100", 12, "", "muted")
        pdf.text_at(X, 66, 170, reading(h, d), 12, "m", "ink", h=6)
        comp = h["competition"]
        sup = [
            ("Moradores", num(h["population"]) if h["population"] is not None else None, "IBGE, Censo 2022", "população"),
            ("Mesmo ramo", num(comp["n"]) if comp else None, f"CNPJ, ref. {ref}", "concorrência"),
            ("Linha reta à sede", f"{num(h['straight_km'], 1)} km" if h["straight_km"] is not None else None, "nossa conta (PostGIS)", "distância")
            if d["hq"] else
            (h["income"].get("label", "Renda mediana"), money(h["income"]["median"]) if h["income"].get("available") else None,
             h["income"].get("comparison", {}).get("text", "IBGE, Censo 2022"), "renda"),
        ]
        tw = (170 - 12) / 3
        for i, (k, v, src, item) in enumerate(sup):
            x = X + i * (tw + 6)
            pdf.box(x, 86, tw, 36, "stone")
            pdf.label(x + 5, 90, k, w=tw - 10)
            if v is None:
                pdf.text_at(x + 5, 96, tw - 10, NO_DATA.format(item=item), 8, "m", "muted", h=3.8)
            else:
                pdf.text_at(x + 5, 96, tw - 10, v, 20, "b", "ink", h=9)
            pdf.source(x + 5, 114, tw - 10, src)
        pdf.box(X + 178, 14, CW - 178, 108, "stone")
        pdf.city_map(shapes, X + 182, 18, CW - 186, 98, {h["id"]: h["rank"]}, focus=h["id"], alt=f"{h['name']} destacado no mapa da cidade")
        cov = h["coverage"]
        foot(f"Nota de 0 a 100 entre os {d['count']} {d['unit']} da cidade. Cobertura dos dados neste {unit1}: "
             f"{COVERAGE.get(cov['level'], cov['level'])} ({num(cov['located_count'])} cadastros localizados)."
             + ("" if d["hq"] or not h["income"].get("comparison") else f" Renda: {comparison_line(h['income']['comparison'])}."))

    # (e) comparação lado a lado
    pdf.add_page()
    y = kicker("Comparação", f"Os {n} lado a lado")
    cw = (CW - 5 * (n - 1)) / max(1, n)
    rows = [("Moradores", lambda h: num(h["population"]) if h["population"] is not None else "sem dado¹"),
            ("Mesmo ramo", lambda h: num(h["competition"]["n"]) if h["competition"] else "sem dado¹"),
            (f"Renda mediana {'da área' if d['unit'] == 'áreas' else 'do bairro'}", lambda h: money(h["income"]["median"]) if h["income"].get("available") else "sem dado¹"),
            ("Renda x cidade", lambda h: h["income"].get("comparison", {}).get("text", "sem dado suficiente para comparar")),
            ("Linha reta à sede", lambda h: f"{num(h['straight_km'], 1)} km" if h["straight_km"] is not None else ("sem sede" if not d["hq"] else "sem dado¹"))]
    for i, h in enumerate(d["neighborhoods"]):
        x = X + i * (cw + 5)
        pdf.box(x, y, cw, SH_ - y - 20, "stone")
        pdf.badge(x + 8, y + 8, 4.5, h["rank"], "coal", "on_dark", 11)
        pdf.text_at(x + 15, y + 5, cw - 18, h["name"], 10.5, "sb", "ink", h=4.8)
        pdf.text_at(x + 5, y + 18, cw - 10, num(h["score"], 1), 22, "b", "ink", h=10)
        pdf.color("fill", C["sand"])
        pdf.rect(x + 5, y + 30, cw - 10, 2, "F")
        pdf.color("fill", SCALE[h["rank"] - 1])
        pdf.rect(x + 5, y + 30, (cw - 10) * h["score"] / 100, 2, "F")
        yy = y + 37
        for k, f in rows:
            pdf.label(x + 5, yy, k, w=cw - 10)
            end = pdf.text_at(x + 5, yy + 4, cw - 10, f(h), 11, "b", "ink", h=5)
            yy = max(yy + 15, end + 5)  # valor em duas linhas ("19% menor que a da cidade") empurra a linha seguinte
    cmp = next((h["income"]["comparison"] for h in d["neighborhoods"] if h["income"].get("comparison", {}).get("available")), None)
    foot(f"Nota 0–100 (barra). Moradores e renda: IBGE, Censo 2022. Mesmo ramo: CNPJ, ref. {ref}. Linha reta: nossa conta."
         + (f" Renda x cidade: {cmp['city_text']}; {cmp['basis']}: " + sources_line(cmp["sources"]) + "." if cmp else "")
         + (" ¹ " + NO_DATA.format(item="[item]") if any("sem dado¹" in f(h) for h in d["neighborhoods"] for _, f in rows) else ""))

    # (f) como lemos os dados
    pdf.add_page()
    y = kicker("Como lemos os dados", "Três ideias para ler as notas")
    ideas = [("Contamos", f"estabelecimentos de cada tipo escolhido em cada {unit1}, por km²."),
             ("Comparamos", f"cada {unit1} com os outros da mesma cidade: a nota é relativa, de 0 a 100."),
             ("Pesamos", "pelo que a empresa quer perto ou longe e pela importância de cada critério.")]
    cw = (CW - 12) / 3
    for i, (t, s) in enumerate(ideas):
        x = X + i * (cw + 6)
        pdf.badge(x + 8, y + 12, 7, i + 1, "copper_wash", "copper_dark", 16)
        pdf.text_at(x, y + 26, cw, t, 18, "b", "ink", h=8)
        pdf.text_at(x, y + 36, cw, s, 11, "", "muted", h=5.4)
    foot(f"Mesmos critérios e mesma base = mesmo ranking (código {d['params_code']}). Método completo no relatório em PDF.")

    # (g) próximos passos
    pdf.add_page()
    y = kicker("Próximos passos", f"Conhecer os {d['unit']} de perto")
    steps = [f"Monte o Roteiro de visita no {PRODUCT_NAME}: escolha 3 {d['unit']} e receba a ordem sugerida.",
             "Vá em dias e horários parecidos com os do seu negócio.",
             "Anote no checklist de campo: movimento de pessoas, estacionamento, concorrentes visíveis.",
             "Decida com o que você viu e com os números deste material."]
    for i, t in enumerate(steps):
        pdf.badge(X + 7, y + 7, 6, i + 1, "coal", "on_dark", 14)
        pdf.text_at(X + 18, y + 3.5, CW - 18, t, 14, "m", "ink", h=6.5)
        y += 21
    foot("Roteiro de visita: em Análises ou no explorador, botão \"Roteiro de visita\".")

    # (h) fontes, datas, cobertura e aviso legal
    pdf.add_page()
    y = kicker("Fontes, datas e cobertura", "De onde vêm os números")
    cc = d["city_coverage"]
    yy = y
    for s in [s for s in d["sources"] if s["key"] != "ibge_malhas"]:
        yy = pdf.text_at(X, yy, 160, f"{s['name']} (ref. {s['reference_date']})", 7.6, "", "ink", h=3.6) + 1.2
    pdf.box(X + 170, y, CW - 170, 40, "stone")
    pdf.label(X + 175, y + 4, "Cobertura na cidade", w=CW - 180)
    pdf.text_at(X + 175, y + 10, CW - 180, f"{num(cc['share'] * 100)}%", 26, "b", "ink", h=11)
    pdf.text_at(X + 175, y + 23, CW - 180, f"dos {num(cc['total_active'])} cadastros ativos do CNPJ (ref. {ref}) localizados em {d['unit']}",
                8.5, "", "muted", h=4)
    pdf.box(X, SH_ - 46, CW, 30, "coal")
    yy = pdf.text_at(X + 6, SH_ - 41, CW - 12, LEGAL, 11, "sb", "on_dark", h=5.4)
    pdf.text_at(X + 6, yy + 1, CW - 12, LEGAL_APP, 8.5, "", "on_dark_muted", h=4.2)
    return bytes(pdf.output())
