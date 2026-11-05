"""Optional CSV export of DuckDB tables/views for BI tools (legacy Power BI path)."""

from __future__ import annotations

import duckdb

from src.config import DUCKDB_PATH, EXPORTS_DIR
from src.utils.logger import get_logger

log = get_logger(__name__)

POWERBI_DATASETS = ["dim_security", "fact_quotes", "fact_cashflows", "fact_risk", "vw_monthly_rates",
                    "vw_latest_prices", "vw_annual_rate_summary", "vw_reconciliation_by_year"]


def export_powerbi_datasets() -> None:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(DUCKDB_PATH), read_only=True) as con:
        for name in POWERBI_DATASETS:
            out = (EXPORTS_DIR / f"{name}.csv").as_posix()
            con.execute(f"COPY (SELECT * FROM {name}) TO '{out}' (HEADER, DELIMITER ',')")
            log.info("exported", extra={"dataset": name})


if __name__ == "__main__":
    export_powerbi_datasets()
