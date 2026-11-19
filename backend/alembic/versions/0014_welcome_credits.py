"""créditos de boas-vindas: 5 por conta nova, uma única vez

Revision ID: 0014
"""
from alembic import op

revision = "0014"
down_revision = "0013"


def upgrade():
    op.execute(
        """
        -- O valor fica em credit_settings (muda sem deploy). Contas existentes não mudam.
        UPDATE credit_settings
           SET key = 'signup_credits', value = 5,
               description = 'Créditos de boas-vindas, dados uma única vez a cada conta nova (e-mail ou Google)'
         WHERE key = 'signup_grant';
        -- Idempotência garantida pelo banco: no máximo um registro de boas-vindas por conta.
        CREATE UNIQUE INDEX credit_ledger_signup_once ON credit_ledger (user_id) WHERE reason = 'signup';
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX credit_ledger_signup_once;
        UPDATE credit_settings
           SET key = 'signup_grant', value = 1, description = 'Créditos dados a todo cadastro novo (1 cidade grátis, sem cartão)'
         WHERE key = 'signup_credits';
        """
    )
