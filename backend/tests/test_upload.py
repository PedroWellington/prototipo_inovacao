"""Logo da empresa: só PNG/JPG/WebP de verdade, até 2 MB, recodificada sem metadados e servida com cabeçalhos seguros."""
from io import BytesIO

from PIL import Image

import pytest

from app import logos
from tests.helpers import login_new_user, seed_minimal_catalog


@pytest.fixture(autouse=True)
def uploads_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(logos, "DIR", tmp_path / "logos")  # testes não sujam data/uploads


def image_bytes(fmt: str, size=(1200, 800), exif=False) -> bytes:
    img = Image.new("RGB", size, (15, 92, 90))
    out = BytesIO()
    if exif:
        e = Image.Exif()
        e[0x010F] = "CameraFabricante"  # Make
        e[0x8825] = {2: (8.0, 3.0, 0.0)}  # GPS: o tipo de dado que não pode vazar
        img.save(out, fmt, exif=e)
    else:
        img.save(out, fmt)
    return out.getvalue()


def upload(client, csrf, data: bytes, ctype="image/png"):
    return client.put("/api/profile/logo", content=data, headers={"X-CSRF-Token": csrf, "Content-Type": ctype})


def test_valid_jpeg_is_resized_reencoded_and_stripped(client):
    seed_minimal_catalog()
    csrf = login_new_user(client)
    r = upload(client, csrf, image_bytes("JPEG", exif=True), "image/jpeg")
    assert r.status_code == 200, r.text
    url = r.json()["profile"]["logo_url"]
    assert url.startswith("/api/profile/logo?v=")
    got = client.get(url)
    assert got.status_code == 200 and got.headers["content-type"] == "image/webp"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in got.headers["content-security-policy"]
    img = Image.open(BytesIO(got.content))
    assert img.format == "WEBP" and max(img.size) == 512
    assert not img.getexif() and "exif" not in img.info and "icc_profile" not in img.info


def test_png_and_webp_accepted_and_old_file_removed(client):
    seed_minimal_catalog()
    csrf = login_new_user(client)
    assert upload(client, csrf, image_bytes("PNG", (100, 100))).status_code == 200
    first = set(logos.DIR.iterdir())
    assert upload(client, csrf, image_bytes("WEBP", (100, 100)), "image/webp").status_code == 200
    assert len(set(logos.DIR.iterdir()) - first) == 1 and not (first - set(logos.DIR.iterdir())) == set()
    assert client.delete("/api/profile/logo", headers={"X-CSRF-Token": csrf}).json()["profile"]["logo_url"] is None
    assert client.get("/api/profile/logo").status_code == 404


def test_fake_type_and_svg_are_refused(client):
    seed_minimal_catalog()
    csrf = login_new_user(client)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for data, ctype in ((svg, "image/svg+xml"), (svg, "image/png"), (b"MZ\x90\x00 isto nao e imagem", "image/png"),
                        (image_bytes("GIF", (100, 100)), "image/gif"), (image_bytes("BMP", (100, 100)), "image/png")):
        r = upload(client, csrf, data, ctype)
        assert r.status_code == 415, (ctype, r.text)
        assert r.json()["error"]["message"] == "Envie uma imagem PNG, JPG ou WebP (SVG não é aceito)."
    assert client.get("/api/profile").json()["profile"] in (None, {}) or client.get("/api/profile").json()["profile"]["logo_url"] is None


def test_large_file_and_decompression_bomb_are_refused(client):
    seed_minimal_catalog()
    csrf = login_new_user(client)
    r = upload(client, csrf, b"\x89PNG" + b"0" * (2 * 1024 * 1024))
    assert r.status_code == 413 and "2 MB" in r.json()["error"]["message"]
    bomb = image_bytes("PNG", (8000, 8000))  # 64 Mpx comprime para poucos KB, mas passa do limite de pixels
    assert len(bomb) < logos.MAX_BYTES
    assert upload(client, csrf, bomb).status_code == 415


def test_requires_login_and_csrf(client):
    seed_minimal_catalog()
    assert client.put("/api/profile/logo", content=image_bytes("PNG")).status_code == 401
    login_new_user(client)
    assert client.put("/api/profile/logo", content=image_bytes("PNG")).status_code == 403
