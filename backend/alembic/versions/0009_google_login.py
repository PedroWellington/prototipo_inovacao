"""login com Google: senha opcional e identificador da conta Google (sub)

Revision ID: 0009
"""
from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade():
    op.execute(
        """
        ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
        ALTER TABLE users ADD COLUMN google_sub text UNIQUE;
        """
    )


def downgrade():
    op.execute("ALTER TABLE users DROP COLUMN google_sub; ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL")
