"""extensões e função de normalização de texto

Revision ID: 0001
"""
from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    # unaccent() não é IMMUTABLE; o wrapper com dicionário explícito pode ser usado em índices.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION norm_text(t text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
          SELECT nullif(trim(regexp_replace(
                   regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t, ''))),
                                  '[^a-z0-9 ]', ' ', 'g'),
                   '\\s+', ' ', 'g')), '')
        $$
        """
    )


def downgrade():
    op.execute("DROP FUNCTION IF EXISTS norm_text(text)")
