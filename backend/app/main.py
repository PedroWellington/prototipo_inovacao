from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import account, catalog, geo, profile
from app.auth import routes as auth_routes
from app.db import get_db

app = FastAPI(title="LOCUS API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1000)
for module in (auth_routes, account, catalog, geo, profile):
    app.include_router(module.router)


# Erros sempre no mesmo formato: {"error": {"code", "message", "details"?}}
@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
    return JSONResponse({"error": detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    details = [
        {"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"].removeprefix("Value error, ")}
        for e in exc.errors()
    ]
    # Regras de negócio (model_validator) já trazem mensagem própria em português.
    business = [d["message"] for d in details if not d["field"]]
    message = business[0] if business else "Confira os campos destacados."
    return JSONResponse(
        {"error": {"code": "validation_error", "message": message, "details": details}},
        status_code=422,
    )


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
