from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import account, assistant as assistant_api, catalog, cities, credits, geo, profile, report
from app.billing import routes as billing_routes
from app.auth import google
from app.auth import routes as auth_routes
from app import assistant, config
from app.report import google_routes
from app.config import PRODUCT_NAME
from app.db import get_db

app = FastAPI(title=f"{PRODUCT_NAME} API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1000)
for module in (auth_routes, google, account, catalog, cities, report, credits, geo, profile, billing_routes, assistant_api):
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


@app.get("/api/config")
def public_config():
    """Só flags públicas: nada de segredo nem de regra de negócio aqui."""
    return {"prototype": config.PROTOTYPE, "demo_mode": config.DEMO_MODE, "uploads": config.UPLOADS_ENABLED,
            "google_login": google.enabled(), "pdf": config.PDF_ENABLED, "payments": config.PAYMENTS_MODE != "off", "payments_mode": config.PAYMENTS_MODE,
            "assistant": assistant.enabled(), "google_maps": google_routes.enabled()}


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
