from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.core.config import get_settings


@contextmanager
def get_conn():
    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        yield conn


def run_migrations() -> None:
    migrations_dir = Path(__file__).resolve().parents[2] / "migrations"
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version text PRIMARY KEY,
              applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()
        for migration in sorted(migrations_dir.glob("*.sql")):
            version = migration.stem
            exists = conn.execute(
                "SELECT 1 FROM schema_migrations WHERE version = %s",
                (version,),
            ).fetchone()
            if exists:
                continue
            conn.execute(migration.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
        conn.commit()
