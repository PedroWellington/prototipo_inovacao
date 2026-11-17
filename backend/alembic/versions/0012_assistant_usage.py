"""assistente de IA: quantas mensagens cada conta mandou por dia (só a contagem, nunca o conteúdo)

Revision ID: 0012
"""
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade():
    op.execute(
        """
        CREATE TABLE assistant_usage (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day date NOT NULL,
          messages integer NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
        """
    )


def downgrade():
    op.execute("DROP TABLE assistant_usage")
