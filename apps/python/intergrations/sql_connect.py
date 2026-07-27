"""
SQL Data Source connector.

Connects to a real SQL database with per-request credentials and exposes the
minimal read surface the Data Source flow needs: test connection, list tables,
list columns, and a bounded, filtered SELECT.

Security:
  - Credentials go through SQLAlchemy's URL.create (proper escaping) — never
    string-concatenated into a DSN.
  - Table/column identifiers from the client are validated against the live
    schema (reflection) and the query is built with the SQLAlchemy expression
    language, so identifiers are quoted by the dialect and values are bound
    parameters. No raw SQL is assembled from client input.
  - Every query is capped by an enforced LIMIT.
  - Read-only intent: only SELECT is issued. Use a least-privilege DB account.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    MetaData,
    Table,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import Engine, URL

# Client-facing driver name -> SQLAlchemy dialect+driver.
_DRIVERS: dict[str, str] = {
    "postgres": "postgresql+psycopg",
    "postgresql": "postgresql+psycopg",
    "mysql": "mysql+pymysql",
    "mariadb": "mysql+pymysql",
}

# Drivers we intentionally do not support yet (need a system ODBC driver).
_BLOCKED_DRIVERS = {"mssql", "sqlserver"}

MAX_ROW_LIMIT = 50_000
DEFAULT_ROW_LIMIT = 1_000
_CONNECT_TIMEOUT_S = 10


class SQLConnectionError(Exception):
    """Raised for connection/config problems. Message is safe to surface (no
    password — SQLAlchemy redacts it from URL reprs, and we never echo the DSN)."""


def _resolve_driver(driver: str) -> str:
    key = (driver or "").strip().lower()
    if key in _BLOCKED_DRIVERS:
        raise SQLConnectionError(
            f"Driver '{driver}' is not supported yet (requires a system ODBC driver)."
        )
    if key not in _DRIVERS:
        raise SQLConnectionError(
            f"Unsupported driver '{driver}'. Supported: postgres, mysql/mariadb."
        )
    return _DRIVERS[key]


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None  # do not surface raw binary blobs
    return value


class SQLDataSource:
    def __init__(
        self,
        driver: str,
        host: str,
        port: int,
        database: str,
        user: str,
        password: str,
        schema: Optional[str] = None,
    ):
        self.dialect = _resolve_driver(driver)
        self.schema = schema or None
        # URL.create escapes credentials safely — never build the DSN by hand.
        self._url = URL.create(
            drivername=self.dialect,
            username=user,
            password=password,
            host=host,
            port=port or None,
            database=database or None,
        )

    def _engine(self) -> Engine:
        # Short-lived engine per operation; disposed by the caller.
        return create_engine(
            self._url,
            pool_pre_ping=True,
            connect_args={"connect_timeout": _CONNECT_TIMEOUT_S},
        )

    def test_connection(self) -> tuple[bool, str]:
        engine = self._engine()
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True, "Connection successful."
        except Exception as exc:  # noqa: BLE001
            return False, _safe_db_error(exc)
        finally:
            engine.dispose()

    def list_tables(self) -> list[str]:
        engine = self._engine()
        try:
            inspector = inspect(engine)
            return sorted(inspector.get_table_names(schema=self.schema))
        finally:
            engine.dispose()

    def get_columns(self, table: str) -> list[dict[str, str]]:
        engine = self._engine()
        try:
            inspector = inspect(engine)
            self._assert_table(inspector, table)
            return [
                {"name": col["name"], "type": str(col["type"])}
                for col in inspector.get_columns(table, schema=self.schema)
            ]
        finally:
            engine.dispose()

    def query(
        self,
        table: str,
        columns: Optional[list[str]] = None,
        time_column: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = DEFAULT_ROW_LIMIT,
    ) -> dict[str, Any]:
        capped_limit = max(1, min(int(limit or DEFAULT_ROW_LIMIT), MAX_ROW_LIMIT))
        engine = self._engine()
        try:
            inspector = inspect(engine)
            self._assert_table(inspector, table)

            # Reflect the real table — identifiers are now dialect-quoted and
            # any unknown column raises before a query is issued.
            reflected = Table(
                table,
                MetaData(),
                autoload_with=engine,
                schema=self.schema,
            )

            selected_cols = self._resolve_columns(reflected, columns)
            stmt = select(*selected_cols)

            if time_column:
                if time_column not in reflected.c:
                    raise SQLConnectionError(
                        f"Unknown time column '{time_column}'."
                    )
                time_col = reflected.c[time_column]
                if start_time:
                    stmt = stmt.where(time_col >= start_time)
                if end_time:
                    stmt = stmt.where(time_col <= end_time)
                stmt = stmt.order_by(time_col)

            stmt = stmt.limit(capped_limit)

            with engine.connect() as conn:
                result = conn.execute(stmt)
                keys = list(result.keys())
                rows = [
                    {k: _jsonable(v) for k, v in zip(keys, row)}
                    for row in result.fetchall()
                ]

            return {"columns": keys, "rows": rows, "row_count": len(rows)}
        finally:
            engine.dispose()

    # ── helpers ──────────────────────────────────────────────────────────────

    def _assert_table(self, inspector: Any, table: str) -> None:
        if table not in inspector.get_table_names(schema=self.schema):
            raise SQLConnectionError(f"Table '{table}' not found.")

    @staticmethod
    def _resolve_columns(reflected: Table, columns: Optional[list[str]]):
        if not columns:
            return list(reflected.c)
        resolved = []
        for name in columns:
            if name not in reflected.c:
                raise SQLConnectionError(f"Unknown column '{name}'.")
            resolved.append(reflected.c[name])
        return resolved


def _safe_db_error(exc: Exception) -> str:
    # SQLAlchemy URL reprs mask the password; still, keep the message short and
    # avoid echoing the whole DSN/statement back to the client.
    text_ = str(exc)
    first_line = text_.splitlines()[0] if text_ else exc.__class__.__name__
    return first_line[:300]
