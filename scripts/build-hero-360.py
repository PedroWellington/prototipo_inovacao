"""Gera os arquivos do hero da landing a partir dos quadros de origem (docs/HERO-360.md).

uso:  python -I scripts/build-hero-360.py <pasta com os quadros .webp/.png> <versão, ex.: v2> [ffmpeg]

Saída em frontend/public/hero-360/<versão>/:
  f/000.webp ... f/NNN.webp  quadros 1280×720, WebP qualidade 70 (reserva: navegador sem VP8 ou vídeo lento)
  sequencia.webm             VP8, 60 fps, quadro-chave a cada 6 quadros (buscas rápidas ao rolar), ~3 Mbit/s

O ffmpeg padrão é o que o Playwright instala (`npx playwright-core install ffmpeg`): ele só lê MJPEG e só grava
VP8/WebM, por isso os quadros passam por JPEG de qualidade 95 num arquivo intermediário. Depois de gerar:
trocar HERO_SEQ.base (e count, se mudou) em landing/js/hero-seq.js e os caminhos /v1/ em landing/index.html.
"""

import glob
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
KEYFRAME_EVERY = 6  # medido: 6 dá buscas de ~11 ms (p95 15 ms) com CPU 4×; o MP4 original (2 quadros-chave) dava ~100 ms
SIZE = (1280, 720)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, version = Path(sys.argv[1]), sys.argv[2]
    ffmpeg = sys.argv[3] if len(sys.argv) > 3 else (glob.glob(os.path.expanduser("~/AppData/Local/ms-playwright/ffmpeg-*/ffmpeg-win64.exe")) or ["ffmpeg"])[0]
    frames = sorted([*src.glob("*.webp"), *src.glob("*.png")])
    if not frames:
        sys.exit(f"nenhum quadro em {src}")
    out = ROOT / "frontend" / "public" / "hero-360" / version
    (out / "f").mkdir(parents=True, exist_ok=True)
    mjpeg = out / "tmp.mjpeg"
    with open(mjpeg, "wb") as stream:
        for i, f in enumerate(frames):
            with Image.open(f) as im:
                im = im.convert("RGB")
                if im.size != SIZE:
                    im = im.resize(SIZE, Image.LANCZOS)
                im.save(out / "f" / f"{i:03d}.webp", "WEBP", quality=70, method=6)
                im.save(stream, "JPEG", quality=95)
    g = str(KEYFRAME_EVERY)
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "60",
                    "-i", str(mjpeg), "-c:v", "libvpx", "-g", g, "-keyint_min", g, "-auto-alt-ref", "0", "-b:v", "3M", "-crf", "8",
                    "-qmin", "4", "-qmax", "40", "-deadline", "good", "-cpu-used", "1", "-an", str(out / "sequencia.webm")], check=True)
    mjpeg.unlink()
    mb = lambda p: p.stat().st_size / 1048576  # noqa: E731
    total = sum(mb(p) for p in (out / "f").glob("*.webp"))
    print(f"{len(frames)} quadros: {total:.1f} MB · vídeo: {mb(out / 'sequencia.webm'):.1f} MB · {out}")


if __name__ == "__main__":
    main()
