"""(Re)create analytical views on an existing DuckDB database (legacy entry point)."""

from __future__ import annotations

from pathlib import Path

import duckdb

from src.config import DUCKDB_PATH
from src.utils.logger import get_logger

log = get_logger(__name__)
SQL_FILE_PATH = Path(__file__).resolve().parents[2] / "sql" / "create_views.sql"


def create_views(path: Path = DUCKDB_PATH) -> None:
    with duckdb.connect(str(path)) as con:
        con.execute(SQL_FILE_PATH.read_text(encoding="utf-8"))
    log.info("views_created", extra={"path": str(path)})


if __name__ == "__main__":
    create_views()
