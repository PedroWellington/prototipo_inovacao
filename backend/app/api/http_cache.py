import hashlib
import json

from fastapi import Request, Response


def etag_of(body: bytes) -> str:
    return '"' + hashlib.sha1(body).hexdigest()[:20] + '"'


def cached(request: Request, body: bytes | str | dict | list, media_type="application/json", max_age=300) -> Response:
    """Resposta com ETag + Cache-Control; devolve 304 quando o navegador já tem a versão atual."""
    if isinstance(body, (dict, list)):
        body = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if isinstance(body, str):
        body = body.encode()
    etag = etag_of(body)
    headers = {"ETag": etag, "Cache-Control": f"private, max-age={max_age}"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type=media_type, headers=headers)
