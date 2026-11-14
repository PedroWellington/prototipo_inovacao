from sqlalchemy import text

from app.db import engine
from app.etl.seed_catalog import seed_catalog_tables


def seed_minimal_catalog() -> None:
    """Catálogo dos CSVs + Pernambuco/Recife, sem rede (os testes não acessam o IBGE)."""
    with engine.begin() as c:
        c.execute(text("TRUNCATE users CASCADE"))
        c.execute(text("INSERT INTO regions VALUES (2, 'NE', 'Nordeste') ON CONFLICT DO NOTHING"))
        c.execute(text("INSERT INTO states VALUES (26, 'PE', 'Pernambuco', 2) ON CONFLICT DO NOTHING"))
        c.execute(
            text(
                "INSERT INTO municipalities (ibge, name, name_normalized, uf) "
                "VALUES (2611606, 'Recife', 'recife', 'PE') ON CONFLICT DO NOTHING"
            )
        )
        seed_catalog_tables(c)


def login_new_user(client, email="ana@example.com") -> str:
    client.post(
        "/api/auth/register",
        json={"name": "Ana", "email": email, "password": "senha-forte-1", "accept_terms": True},
    )
    return client.get("/api/auth/me").json()["csrf_token"]
