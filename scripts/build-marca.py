"""Gera os ativos de marca de produção a partir de design/brand/ (os PNGs originais, versionados). Ver docs/MARCA.md.

    python -I scripts/build-marca.py

Saída em frontend/public/brand/ (versionado):
- vicus-icone-{32,64,96,128,512}.png  ícone com fundo transparente, margens cortadas e quadrado
- favicon.ico (16/32/48), favicon-32.png, icon-192.png, icon-512.png, apple-touch-icon.png (180, fundo escuro)
- vicus-logo-claro.svg   ícone + "VICUS" em grafite #20272d (para fundo claro)
- vicus-logo-escuro.svg  ícone + "VICUS" em off-white #F3EDE7 (para fundo escuro)
O og:image (1200x630) é gerado por scripts/build-og.mjs (usa o navegador para a fonte Inter).

O ícone de origem (vicus-icone-fundo-branco.png) tem quase todos os pixels levemente transparentes e ruído
em volta: aqui o miolo vira opaco, o ruído some e a borda antisserrilhada é preservada.
As letras da logo horizontal original vieram com um halo sujo: por isso o "VICUS" é texto em Inter.
"""
import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design/brand/vicus-icone-fundo-branco.png"
OUT = ROOT / "frontend/public/brand"
FONT = ROOT / "landing/assets/fonts/inter-latin-wght.woff2"
DARK_BG = (24, 21, 18, 255)  # --bg do modo escuro (#181512)
GRAFITE = "#20272d"
OFFWHITE = "#F3EDE7"


def clean_icon() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    r, g, b, a = im.split()
    # Ruído (alfa < 24) some; miolo (alfa >= 200) fica opaco; a borda entre os dois é preservada.
    a = a.point(lambda v: 0 if v < 24 else 255 if v >= 200 else v)
    im = Image.merge("RGBA", (r, g, b, a))
    box = a.getbbox()
    im = im.crop(box)
    side = max(im.size)
    pad = round(side * 0.04)  # respiro mínimo dentro do quadrado
    sq = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    sq.paste(im, ((sq.width - im.width) // 2, (sq.height - im.height) // 2), im)
    return sq


def logo_svg(icon_png: bytes, ink: str) -> str:
    """Ícone (PNG embutido) + "VICUS" em Inter embutida. Proporção 4,3:1, sem margens sobrando."""
    icon64 = base64.b64encode(icon_png).decode()
    font64 = base64.b64encode(FONT.read_bytes()).decode()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 100" width="430" height="100" role="img" aria-label="VICUS">
  <style>@font-face{{font-family:"Inter VICUS";font-weight:100 900;src:url(data:font/woff2;base64,{font64}) format("woff2")}}</style>
  <image href="data:image/png;base64,{icon64}" x="0" y="0" width="100" height="100"/>
  <text x="118" y="70" fill="{ink}" font-family="'Inter VICUS', Inter, 'Segoe UI', Arial, sans-serif" font-size="58" font-weight="600" letter-spacing="10">VICUS</text>
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = clean_icon()
    for size in (32, 64, 96, 128, 512):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"vicus-icone-{size}.png", optimize=True)
    icon.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)
    icon.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    icon.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png", optimize=True)
    icon.resize((48, 48), Image.LANCZOS).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    # iOS não aceita transparência: ícone sobre o fundo escuro, com respiro.
    touch = Image.new("RGBA", (180, 180), DARK_BG)
    small = icon.resize((140, 140), Image.LANCZOS)
    touch.paste(small, (20, 20), small)
    touch.convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)

    from io import BytesIO

    buf = BytesIO()
    icon.resize((256, 256), Image.LANCZOS).save(buf, "PNG", optimize=True)
    (OUT / "vicus-logo-claro.svg").write_text(logo_svg(buf.getvalue(), GRAFITE), encoding="utf-8")
    (OUT / "vicus-logo-escuro.svg").write_text(logo_svg(buf.getvalue(), OFFWHITE), encoding="utf-8")
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:28} {f.stat().st_size / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
