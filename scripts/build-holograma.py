"""Gera os quadros otimizados do holograma da unidade (ilustração conceitual) a partir dos PNGs brutos.

    python -I scripts/build-holograma.py [pasta-dos-png] [--quality 82]

Entrada: 360 PNGs RGBA de 640x640 (design/holograma-360/.../frames-png, fora do Git).
Saída:   frontend/public/holograma/loja-000.webp ... loja-359.webp + manifest.json (versionados).

- Recorta pela UNIÃO das caixas de conteúdo (canal alfa) de todos os quadros: todos ficam alinhados.
- Converte para WebP com transparência. Imprime o peso antes e depois.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "design/holograma-360/VICUS-Holograma-360-Frames-PNG/frames-png"
OUT = ROOT / "frontend/public/holograma"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default=str(RAW))
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()
    files = sorted(Path(args.src).glob("*.png"))
    if len(files) != 360:
        raise SystemExit(f"esperava 360 PNGs em {args.src}, achei {len(files)}")

    box = None
    for f in files:
        with Image.open(f) as im:
            if im.mode != "RGBA":
                raise SystemExit(f"{f.name}: sem transparência ({im.mode})")
            b = im.getchannel("A").getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    # 2 px de folga para a borda antisserrilhada não encostar no recorte.
    box = (max(0, box[0] - 2), max(0, box[1] - 2), min(640, box[2] + 2), min(640, box[3] + 2))

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("loja-*.webp"):
        old.unlink()
    raw_bytes, out_bytes, digest = 0, 0, hashlib.sha256()
    for i, f in enumerate(files):
        raw_bytes += f.stat().st_size
        dst = OUT / f"loja-{i:03d}.webp"
        with Image.open(f) as im:
            im.crop(box).save(dst, "WEBP", quality=args.quality, method=6, exact=False)
        data = dst.read_bytes()
        out_bytes += len(data)
        digest.update(data)

    w, h = box[2] - box[0], box[3] - box[1]
    manifest = {
        "count": len(files),
        "width": w,
        "height": h,
        "pattern": "loja-{i}.webp",  # {i} com 3 dígitos
        "version": digest.hexdigest()[:12],  # muda quando os quadros mudam (cache)
        "note": "Visualização conceitual da unidade: loja genérica, sem endereço nem estabelecimento real.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    mb = lambda n: f"{n / 1024 / 1024:.1f} MB"  # noqa: E731
    print(f"{len(files)} quadros: {mb(raw_bytes)} (PNG 640x640) -> {mb(out_bytes)} (WebP {w}x{h}, q{args.quality})")
    print(f"memória por quadro decodificado: {w * h * 4 / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
