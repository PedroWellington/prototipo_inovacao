from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATA_DATABASE_URL, DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
# Banco de dados de leitura (produção: vicus-dados). Consultas pesadas (tiles, ranking) param em 20 s.
data_engine = engine if DATA_DATABASE_URL == DATABASE_URL else create_engine(
    DATA_DATABASE_URL, pool_pre_ping=True, pool_size=5, connect_args={"options": "-c statement_timeout=20000"})
DataSessionLocal = sessionmaker(data_engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def get_data_db() -> Iterator[Session]:
    with DataSessionLocal() as db:
        yield db
