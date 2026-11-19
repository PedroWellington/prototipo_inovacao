"""pedidos de compra de créditos (pagamento simulado nesta etapa; provedor real depois, por webhook)

Revision ID: 0015
"""
from alembic import op

revision = "0015"
down_revision = "0014"


def upgrade():
    op.execute(
        """
        -- Preço e limites são dado, não código (mudam com UPDATE, sem deploy).
        INSERT INTO credit_settings VALUES
          ('credit_unit_price_cents', 1780, 'Preço de 1 crédito em centavos. Valor de demonstração, a definir (base: plano Essencial, R$ 89 por 5 créditos)'),
          ('purchase_max_credits', 50, 'Máximo de créditos por pedido'),
          ('purchase_daily_credits', 200, 'Máximo de créditos comprados por conta por dia'),
          ('order_expiry_minutes', 30, 'Minutos até um pedido pendente expirar');

        -- O valor é calculado no servidor (quantidade x preço); o cliente só envia a quantidade.
        CREATE TABLE orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          quantity integer NOT NULL CHECK (quantity > 0),
          amount_cents integer NOT NULL CHECK (amount_cents >= 0),
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled')),
          provider text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          paid_at timestamptz
        );
        CREATE INDEX orders_user_idx ON orders (user_id, created_at);

        -- Compra no extrato, com referência ao pedido; o índice único impede creditar o mesmo pedido duas vezes.
        ALTER TABLE credit_ledger ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE CASCADE;
        CREATE UNIQUE INDEX credit_ledger_order_once ON credit_ledger (order_id) WHERE order_id IS NOT NULL;
        ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
        ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
          CHECK (reason IN ('signup', 'grant', 'city_unlock', 'city_search', 'report', 'purchase'));
        """
    )


def downgrade():
    op.execute(
        """
        DELETE FROM credit_ledger WHERE reason = 'purchase';
        ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
        ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
          CHECK (reason IN ('signup', 'grant', 'city_unlock', 'city_search', 'report'));
        DROP INDEX credit_ledger_order_once;
        ALTER TABLE credit_ledger DROP COLUMN order_id;
        DROP TABLE orders;
        DELETE FROM credit_settings
         WHERE key IN ('credit_unit_price_cents', 'purchase_max_credits', 'purchase_daily_credits', 'order_expiry_minutes');
        """
    )
