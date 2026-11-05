"""Load normalised and modelled tables into the local DuckDB analytical database.

Replaces the legacy dimensional model (dim_title / fact_prices /
fact_cashflows / bond_rate_curve) with date-aware security identifiers and a
cash-flow model that follows the official methodology. The legacy
``create_bond_rate_curve`` regression is intentionally not reproduced as a
pricing model; see docs/audit.md.

The database is built in a temporary file and swapped in atomically.
"""

from __future__ import annotations

import os
from pathlib import Path

import duckdb
import pandas as pd

from src.config import DATABASE_DIR, DUCKDB_PATH
from src.pricing.instruments import PRODUCTS, cashflow_schedule
from src.utils.logger import get_logger

log = get_logger(__name__)


def create_fact_cashflows(dim: pd.DataFrame) -> pd.DataFrame:
    """Contractual schedule per security (amount per 100 of VNA, or per 1000 face)."""
    rows = []
    for r in dim[dim["modelled"]].itertuples(index=False):
        p = PRODUCTS[r.product_code]
        for i, (d, amt, kind) in enumerate(cashflow_schedule(p, r.maturity_date), start=1):
            rows.append({"security_id": r.security_id, "flow_no": i, "flow_date": d, "amount": amt, "flow_type": kind,
                         "basis": "per_1000_face" if p.code in ("LTN", "NTNF") else "per_100_vna"})
    return pd.DataFrame(rows)


def load_database(tables: dict[str, pd.DataFrame], path: Path = DUCKDB_PATH) -> Path:
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".building.duckdb")
    tmp.unlink(missing_ok=True)
    with duckdb.connect(str(tmp)) as con:
        for name, df in tables.items():
            con.register(f"{name}_df", df)
            con.execute(f"CREATE TABLE {name} AS SELECT * FROM {name}_df")
            con.unregister(f"{name}_df")
        sql = (Path(__file__).resolve().parents[2] / "sql" / "create_views.sql").read_text(encoding="utf-8")
        con.execute(sql)
    os.replace(tmp, path)
    log.info("duckdb_loaded", extra={"path": str(path), **{k: len(v) for k, v in tables.items()}})
    return path
