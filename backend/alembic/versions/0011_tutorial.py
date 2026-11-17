"""tutorial de primeira vez: concluído (ou pulado) uma única vez por conta

Revision ID: 0011
"""
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade():
    # Nulo = ainda não viu. Fica na conta (não no navegador) para não voltar em outro aparelho.
    op.execute("ALTER TABLE users ADD COLUMN tutorial_concluido_em timestamptz")


def downgrade():
    op.execute("ALTER TABLE users DROP COLUMN tutorial_concluido_em")
