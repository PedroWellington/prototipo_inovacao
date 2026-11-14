import os

# Os testes usam o banco <POSTGRES_DB>_test; precisa vir antes de qualquer import de app.*
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    cfg = Config("alembic.ini")
    cfg.cmd_opts = type("o", (), {"x": [f"db_url={os.environ['DATABASE_URL']}"]})()
    command.upgrade(cfg, "head")
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
