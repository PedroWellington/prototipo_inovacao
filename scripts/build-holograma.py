"""Gera os quadros do holograma da unidade (ilustração conceitual) e o manifesto. Ver docs/HOLOGRAMA.md.

    python -I scripts/build-holograma.py <pasta-de-png | imagem.png> [--tema claro|escuro] [--quality 82]
                                          [--volta 12] [--rotulo "..."] [--base 0.0] [--escala 1.0] [--saida DIR]
    python -I scripts/build-holograma.py --autoteste      # conjuntos falsos com 36 e 120 quadros

Entrada: PNGs RGBA (fundo transparente) em sequência pelo nome, quantos forem; ou UMA imagem (sem giro).
Saída:   <saida>/<tema>/quadro-NNN.webp + <saida>/manifest.json (mescla com os outros temas já gerados).
- Recorta pela UNIÃO das caixas de conteúdo (canal alfa): todos os quadros ficam alinhados.
- Converte para WebP com transparência e avisa se o peso passar de 6 MB ou a memória estimada de 80 MB.
"""
import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend/public/holograma"
MAX_MB = 6.0
MAX_MEM_MB = 80.0
WINDOW = 22  # quadros decodificados ao mesmo tempo (frontend/src/map/hologram.js)
DISPLAY_MAX = 520  # maior largura exibida em px do dispositivo (260 px CSS x 2)


def frames_of(src: Path) -> list[Path]:
    if src.is_file():
        return [src]
    files = sorted(src.glob("*.png"))
    if not files:
        raise SystemExit(f"nenhum PNG em {src}")
    return files


def build(src: Path, out: Path, theme: str, quality: int, turn: float, label: str | None, base: float, scale: float) -> dict:
    files = frames_of(src)
    box = None
    for f in files:
        with Image.open(f) as im:
            if im.mode != "RGBA":
                raise SystemExit(f"{f.name}: precisa de fundo transparente (modo {im.mode}, esperado RGBA)")
            b = im.getchannel("A").getbbox()
            size = im.size
        if not b:
            raise SystemExit(f"{f.name}: quadro vazio (tudo transparente)")
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    box = (max(0, box[0] - 2), max(0, box[1] - 2), min(size[0], box[2] + 2), min(size[1], box[3] + 2))

    dest = out / theme
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    raw, packed, digest = 0, 0, hashlib.sha256()
    digits = max(3, len(str(len(files) - 1)))
    for i, f in enumerate(files):
        raw += f.stat().st_size
        target = dest / f"quadro-{i:0{digits}d}.webp"
        with Image.open(f) as im:
            im.crop(box).save(target, "WEBP", quality=quality, method=4)
        data = target.read_bytes()
        packed += len(data)
        digest.update(data)

    w, h = box[2] - box[0], box[3] - box[1]
    n = len(files)
    # Memória: a janela de quadros decodificados, no maior tamanho exibido (px do dispositivo).
    dw = min(w, DISPLAY_MAX)
    dh = round(h * dw / w)
    mem = min(n, WINDOW) * dw * dh * 4 / 1048576
    mb = packed / 1048576

    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest.setdefault("label", "Visualização conceitual da unidade")
    if label:
        manifest["label"] = label
    manifest["turnSeconds"] = turn
    manifest.setdefault("stillAngle", 30)
    manifest["baseline"] = base
    manifest["scale"] = scale
    manifest.setdefault("sets", {})[theme] = {
        "dir": f"{theme}/", "pattern": "quadro-{i}.webp", "digits": digits, "count": n, "width": w, "height": h,
    }
    manifest["version"] = digest.hexdigest()[:12]
    manifest["note"] = ("Gerado por scripts/build-holograma.py. Visualização conceitual: loja genérica, sem endereço "
                        "nem estabelecimento real. Ver docs/HOLOGRAMA.md.")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{theme}] {n} quadro(s): {raw / 1048576:.1f} MB (PNG) -> {mb:.1f} MB (WebP {w}x{h}, q{quality})")
    print(f"[{theme}] memória estimada (janela de {min(n, WINDOW)} quadros em {dw}x{dh}): {mem:.1f} MB; "
          f"uma volta a cada {turn:g} s ({n / turn:.1f} quadros/s)")
    if mb > MAX_MB:
        print(f"AVISO: {mb:.1f} MB passa de {MAX_MB:g} MB. Use menos quadros, --quality menor ou imagens menores.")
    if mem > MAX_MEM_MB:
        print(f"AVISO: memória estimada {mem:.1f} MB passa de {MAX_MEM_MB:g} MB.")
    return {"count": n, "mb": mb, "mem": mem, "manifest": manifest}


def selftest() -> None:
    """Dois conjuntos falsos (N=36 e N=120) e uma imagem única: o mesmo código, sem ajuste nenhum."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for n in (36, 120):
            src = tmp / f"src{n}"
            src.mkdir()
            for i in range(n):
                im = Image.new("RGBA", (640, 640), (0, 0, 0, 0))
                x = 200 + (i * 7) % 40  # o objeto "gira": muda de lugar, a união das caixas cobre todos
                for yy in range(260, 420):
                    for xx in range(x, x + 200, 4):
                        im.putpixel((xx, yy), (200, 120, 70, 255))
                im.save(src / f"f-{i:03d}.png")
            r = build(src, tmp / f"out{n}", "claro", 80, 12.0, None, 0.0, 1.0)
            s = r["manifest"]["sets"]["claro"]
            assert s["count"] == n and len(list((tmp / f"out{n}/claro").glob("*.webp"))) == n, "quadros"
            assert r["manifest"]["turnSeconds"] == 12.0, "a volta não depende de N"
            assert r["mb"] <= MAX_MB and r["mem"] <= MAX_MEM_MB, "limites"
        one = tmp / "uma.png"
        img = Image.new("RGBA", (640, 640), (0, 0, 0, 0))
        img.paste((180, 110, 60, 255), (200, 200, 440, 440))
        img.save(one)
        r = build(one, tmp / "out1", "claro", 80, 12.0, None, 0.0, 1.0)
        assert r["count"] == 1, "imagem única"
        r = build(one, tmp / "out1", "escuro", 80, 12.0, None, 0.0, 1.0)
        assert set(r["manifest"]["sets"]) == {"claro", "escuro"}, "um conjunto por tema, mesclado"
    print("autoteste: OK (36 e 120 quadros, imagem única, dois temas)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("--tema", default="claro", choices=["claro", "escuro"])
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--volta", type=float, default=12.0, help="segundos por volta completa")
    ap.add_argument("--rotulo", default=None)
    ap.add_argument("--base", type=float, default=0.0, help="fração da altura abaixo da base do objeto (pousa no cone)")
    ap.add_argument("--escala", type=float, default=1.0)
    ap.add_argument("--saida", default=str(OUT))
    ap.add_argument("--autoteste", action="store_true")
    a = ap.parse_args()
    if a.autoteste:
        return selftest()
    if not a.src:
        ap.error("informe a pasta de PNGs ou a imagem")
    build(Path(a.src), Path(a.saida), a.tema, a.quality, a.volta, a.rotulo, a.base, a.escala)


if __name__ == "__main__":
    sys.exit(main())
