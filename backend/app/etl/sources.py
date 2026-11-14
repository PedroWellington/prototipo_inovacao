"""Endereços oficiais (conferidos em 2026-11-14, ver docs/DATA.md) e download com retomada."""
import re
from pathlib import Path

import httpx

# IBGE — Malha de Bairros do Censo 2022, por UF (GeoPackage).
IBGE_BAIRROS_URL = (
    "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/"
    "malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/gpkg/UF/{uf}/{uf}_bairros_CD2022.gpkg"
)
# IBGE — Malha de Setores Censitários do Censo 2022, por UF (base das "áreas" onde não há bairro formal).
IBGE_SETORES_URL = (
    "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/"
    "malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/gpkg/UF/{uf}/{uf}_setores_CD2022.gpkg"
)

# Receita Federal — dados abertos do CNPJ. Desde 2025 publicados num compartilhamento Nextcloud;
# o WebDAV público usa o token do compartilhamento como usuário (senha vazia).
RFB_SHARE_TOKEN = "YggdBLfdninEJX9"
RFB_SHARE_PAGE = f"https://arquivos.receitafederal.gov.br/index.php/s/{RFB_SHARE_TOKEN}"
RFB_WEBDAV = "https://arquivos.receitafederal.gov.br/public.php/webdav"
RFB_LAYOUT_PDF = "https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf"


def rfb_latest_month() -> str:
    r = httpx.request("PROPFIND", RFB_WEBDAV + "/", headers={"Depth": "1"}, auth=(RFB_SHARE_TOKEN, ""), timeout=60)
    r.raise_for_status()
    months = sorted(set(re.findall(r"/public\.php/webdav/(\d{4}-\d{2})/", r.text)))
    if not months:
        raise RuntimeError("Nenhuma pasta de mês encontrada no compartilhamento da Receita.")
    return months[-1]


def download(url: str, dest: Path, auth: tuple[str, str] | None = None) -> Path:
    """Baixa em streaming para dest (retoma um .part interrompido). Não baixa de novo se já existir."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    start = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={start}-"} if start else {}
    print(f"  baixando {url} -> {dest}" + (f" (retomando de {start:,} bytes)" if start else ""))
    with httpx.stream("GET", url, headers=headers, auth=auth, timeout=120, follow_redirects=True) as r:
        if r.status_code not in (200, 206):
            raise RuntimeError(f"Download falhou ({r.status_code}): {url}")
        with open(part, "ab" if r.status_code == 206 else "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    part.rename(dest)
    return dest
