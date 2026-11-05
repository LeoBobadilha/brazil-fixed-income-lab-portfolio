"""Project paths and configuration (legacy constant names preserved)."""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

CONFIG_DIR = BASE_DIR / "config"
SOURCES_FILE = CONFIG_DIR / "sources.toml"
ASSUMPTIONS_DIR = CONFIG_DIR / "assumptions"

DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
DATABASE_DIR = DATA_DIR / "database"
SNAPSHOT_DIR = DATA_DIR / "snapshots"

# Older names kept for compatibility with the earlier research modules.
RAW_FILE_PATH = RAW_DIR / "tesouro_direto_prices.csv"
PROCESSED_FILE_PATH = PROCESSED_DIR / "tesouro_direto_processed.csv"
DUCKDB_PATH = DATABASE_DIR / "fixed_income_lab.duckdb"
DIM_TITLE_TABLE = "dim_security"
FACT_PRICES_TABLE = "fact_quotes"
FACT_CASHFLOWS_TABLE = "fact_cashflows"
EXPORTS_DIR = BASE_DIR / "exports"

LOG_DIR = BASE_DIR / "logs"
LOG_FILE_PATH = LOG_DIR / "pipeline.jsonl"

WEB_DIR = BASE_DIR / "web"
WEB_DATA_DIR = WEB_DIR / "public" / "data"
REPORTS_DIR = BASE_DIR / "reports"


@lru_cache(maxsize=1)
def sources() -> dict:
    with open(SOURCES_FILE, "rb") as fh:
        return tomllib.load(fh)
