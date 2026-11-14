import os

from alembic import context
from sqlalchemy import create_engine

# Os testes passam outra URL via -x db_url=...
url = context.get_x_argument(as_dictionary=True).get("db_url") or os.environ["DATABASE_URL"]

with create_engine(url).connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
