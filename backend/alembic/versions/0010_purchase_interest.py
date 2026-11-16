"""interesse em comprar créditos (antes do gateway de pagamento)

Revision ID: 0010
"""
from alembic import op

revision = "0010"
down_revision = "0009"


def upgrade():
    op.execute(
        """
        -- Quem pediu aviso de "Comprar mais créditos" e para qual plano. O e-mail fica na conta (users), não aqui.
        CREATE TABLE credit_purchase_interest (
          id bigserial PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          package text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX credit_purchase_interest_user_idx ON credit_purchase_interest (user_id, created_at);
        """
    )


def downgrade():
    op.execute("DROP TABLE credit_purchase_interest")
