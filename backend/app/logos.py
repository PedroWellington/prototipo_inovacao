"""Logo/foto da empresa: valida o conteúdo real, redimensiona e recodifica (remove metadados). Nunca SVG.

O arquivo enviado nunca é guardado como veio: só a versão recodificada em WebP, com nome aleatório, em
DATA_DIR/uploads/logos (fora do Git). Servida com cabeçalhos que impedem execução (ver app/api/profile.py).
"""
import secrets
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import DATA_DIR

MAX_BYTES = 2 * 1024 * 1024
ALLOWED = {"PNG", "JPEG", "WEBP"}  # formato detectado pelo conteúdo, não pela extensão nem pelo Content-Type
SIZE = 512
MAX_PIXELS = 25_000_000  # ~5000×5000: acima disso recusamos antes de decodificar (bomba de descompressão)
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # o Pillow só ERRA acima do dobro disso (entre 1× e 2× só avisa): ver a checagem abaixo
DIR = DATA_DIR / "uploads" / "logos"

UNSUPPORTED = "Envie uma imagem PNG, JPG ou WebP (SVG não é aceito)."


def too_large():
    raise HTTPException(413, {"code": "too_large", "message": "A imagem pode ter no máximo 2 MB."})


def process(data: bytes) -> bytes:
    """Bytes enviados -> WebP até 512×512, sem EXIF/ICC/XMP. Recusa o que não for PNG, JPEG ou WebP de verdade."""
    if len(data) > MAX_BYTES:
        too_large()
    try:
        with Image.open(BytesIO(data)) as probe:
            fmt, (w, h) = probe.format, probe.size
            probe.verify()  # estrutura íntegra
        if fmt not in ALLOWED or w * h > MAX_PIXELS:
            raise ValueError(fmt)
        img = Image.open(BytesIO(data))  # verify() invalida o objeto: reabre para decodificar
        img.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, ValueError, OSError, SyntaxError) as e:
        raise HTTPException(415, {"code": "unsupported_image", "message": UNSUPPORTED}) from e
    img = ImageOps.exif_transpose(img)  # aplica a rotação da câmera antes de descartar o EXIF
    img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    img.thumbnail((SIZE, SIZE), Image.LANCZOS)
    out = BytesIO()
    img.save(out, "WEBP", quality=85, method=4)  # salvar sem exif=/icc_profile= descarta os metadados
    return out.getvalue()


def save(data: bytes) -> str:
    DIR.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + ".webp"
    (DIR / name).write_bytes(data)
    return name


def path(name: str) -> Path:
    p = (DIR / name).resolve()
    if p.parent != DIR.resolve():  # o nome vem do banco, mas não confiamos nem nele
        raise HTTPException(404, {"code": "not_found", "message": "Imagem não encontrada."})
    return p


def remove(name: str | None) -> None:
    if name:
        path(name).unlink(missing_ok=True)
