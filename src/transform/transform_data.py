"""Normalise raw official files into typed, validated tables.

Legacy entry point ``transform_data()`` is preserved: it now returns every
normalised table (and writes the processed Tesouro CSV for compatibility).
"""

from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from src.config import PROCESSED_DIR, PROCESSED_FILE_PATH, RAW_DIR, RAW_FILE_PATH, sources
from src.pricing.instruments import PRODUCTS, commercial_year, conversion_date, product_for, security_id
from src.utils.logger import get_logger

log = get_logger(__name__)

TESOURO_COLUMNS = [
    "Tipo Titulo", "Data Vencimento", "Data Base", "Taxa Compra Manha", "Taxa Venda Manha",
    "PU Compra Manha", "PU Venda Manha", "PU Base Manha",
]
RENAME = {
    "Tipo Titulo": "product_name", "Data Vencimento": "maturity_date", "Data Base": "base_date",
    "Taxa Compra Manha": "buy_rate", "Taxa Venda Manha": "sell_rate",
    "PU Compra Manha": "buy_price", "PU Venda Manha": "sell_price", "PU Base Manha": "base_price",
}

# Legacy helpers kept (now unit-tested) -------------------------------------


def clean_column_names(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")
    return df


def read_tesouro_raw(path=RAW_FILE_PATH) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="latin1", dtype=str)
    missing = [c for c in TESOURO_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Tesouro CSV schema changed; missing columns: {missing}")
    return df[TESOURO_COLUMNS]


def normalise_tesouro(raw: pd.DataFrame) -> pd.DataFrame:
    """Typed quotes with canonical security identifiers.

    Rates are % p.a. (real for IPCA-linked, spread for LFT); prices are BRL per
    security. Empty or zero prices (non-offered side) become NULL.
    """
    df = raw.rename(columns=RENAME).copy()
    df["product_name"] = df["product_name"].str.strip()
    for c in ("maturity_date", "base_date"):
        df[c] = pd.to_datetime(df[c], format="%d/%m/%Y", errors="coerce")
    for c in ("buy_rate", "sell_rate", "buy_price", "sell_price", "base_price"):
        df[c] = pd.to_numeric(df[c].str.replace(",", ".", regex=False), errors="coerce")
    for c in ("buy_price", "sell_price", "base_price"):
        df.loc[df[c] <= 0, c] = np.nan
    # A zero buy rate together with a missing buy price means "not offered".
    df.loc[df["buy_price"].isna(), "buy_rate"] = np.nan
    df.loc[df["sell_price"].isna() & df["base_price"].isna(), "sell_rate"] = np.nan
    codes = {name: product_for(name).code for name in df["product_name"].unique()}
    df["product_code"] = df["product_name"].map(codes)
    df["security_id"] = [security_id(c, m.date()) for c, m in zip(df["product_code"], df["maturity_date"])]
    return df


def build_dim_security(quotes: pd.DataFrame) -> pd.DataFrame:
    g = quotes.groupby("security_id").agg(
        product_code=("product_code", "first"), product_name=("product_name", "first"),
        maturity_date=("maturity_date", "first"), first_date=("base_date", "min"), last_date=("base_date", "max"),
        observations=("base_date", "size"),
    ).reset_index()
    rows = []
    for r in g.itertuples(index=False):
        p = PRODUCTS[r.product_code]
        mat = r.maturity_date.date()
        conv = conversion_date(p, mat)
        year = commercial_year(p, mat)
        rows.append({
            "security_id": r.security_id, "product_code": p.code, "product_name": r.product_name,
            "instrument": p.instrument, "family": p.family, "indexer": p.indexer, "coupon_type": p.coupon,
            "modelled": p.modelled, "maturity_date": mat, "conversion_date": conv, "commercial_year": year,
            "display_name": f"{r.product_name} {year}", "first_date": r.first_date.date(),
            "last_date": r.last_date.date(), "observations": int(r.observations),
        })
    dim = pd.DataFrame(rows).sort_values(["product_code", "maturity_date"]).reset_index(drop=True)
    latest = quotes["base_date"].max().date()
    dim["active"] = dim["last_date"] == latest
    return dim


def normalise_sgs() -> pd.DataFrame:
    frames = []
    for key, spec in sources()["sgs"]["series"].items():
        path = RAW_DIR / "sgs" / f"{key}.csv"
        if not path.exists():
            log.warning("sgs_missing", extra={"series": key})
            continue
        s = pd.read_csv(path, dtype=str)
        frames.append(pd.DataFrame({
            "series": key, "sgs_id": spec["id"], "date": pd.to_datetime(s["data"], format="%d/%m/%Y"),
            "value": pd.to_numeric(s["valor"], errors="coerce"), "unit": spec["unit"],
        }))
    out = pd.concat(frames, ignore_index=True).dropna(subset=["value"])
    # SGS 432 (Selic target) is carried forward to the next Copom meeting date,
    # so it contains future dates. Daily series are capped at the last business
    # day with an effective-Selic observation (never after the run date), which
    # also keeps the published snapshot unchanged on weekends and holidays.
    cap = pd.Timestamp(date.today())
    eff = out.loc[out["series"] == "selic_effective", "date"]
    if len(eff):
        cap = min(cap, eff.max())
    daily = out["series"].map(lambda k: sources()["sgs"]["series"][k]["frequency"] == "daily")
    return out[~daily | (out["date"] <= cap)]


def normalise_ipca_index() -> pd.DataFrame:
    rows = json.loads((RAW_DIR / "ipca_index.json").read_text(encoding="utf-8"))[1:]
    df = pd.DataFrame({"period": [r["D3C"] for r in rows], "index": [r["V"] for r in rows]})
    df["index"] = pd.to_numeric(df["index"], errors="coerce")
    df = df.dropna()
    df["month"] = pd.to_datetime(df["period"], format="%Y%m")
    return df[["month", "index"]].sort_values("month").reset_index(drop=True)


def normalise_focus() -> pd.DataFrame:
    f = pd.read_csv(RAW_DIR / "focus_annual.csv", dtype=str)
    out = pd.DataFrame({
        "indicator": f["Indicador"], "survey_date": pd.to_datetime(f["Data"]),
        "reference_year": pd.to_numeric(f["DataReferencia"], errors="coerce").astype("Int64"),
        "median": pd.to_numeric(f["Mediana"], errors="coerce"), "mean": pd.to_numeric(f["Media"], errors="coerce"),
        "min": pd.to_numeric(f["Minimo"], errors="coerce"), "max": pd.to_numeric(f["Maximo"], errors="coerce"),
        "respondents": pd.to_numeric(f["numeroRespondentes"], errors="coerce"),
    })
    return out.dropna(subset=["median", "reference_year"])


DPF_INDEXER = [
    # (prefix, indexer) - Tesouro security naming in the DPF stock dataset
    ("LTN", "Prefixado"), ("NTN-F", "Prefixado"), ("NTNF", "Prefixado"),
    ("LFT", "Selic"), ("NTN-B", "IPCA"), ("NTNB", "IPCA"), ("NTN-C", "IGP-M"), ("NTNC", "IGP-M"),
]


def classify_dpf(title: str, debt_type: str) -> str:
    t = str(title).upper().replace(" ", "")
    if str(debt_type).lower().startswith("d") and "extern" in str(debt_type).lower():
        return "Câmbio (dívida externa)"
    for prefix, ix in DPF_INDEXER:
        if t.startswith(prefix.replace(" ", "")):
            return ix
    return "Outros"


def normalise_dpf() -> pd.DataFrame:
    """Month-end DPF stock by security with an indexer classification."""
    d = pd.read_csv(RAW_DIR / "dpf_stock.csv", sep=";", encoding="latin1", dtype=str)
    d.columns = ["title", "maturity", "stock", "quantity", "month", "portfolio", "debt_type"]
    d["debt_type"] = d["debt_type"].fillna("").map(lambda s: s.encode("latin1").decode("utf-8", "ignore") if "Ã" in s else s)
    d["stock"] = pd.to_numeric(d["stock"].str.replace(",", ".", regex=False), errors="coerce")
    d["maturity"] = pd.to_datetime(d["maturity"], format="%d/%m/%Y", errors="coerce")
    d["month"] = pd.to_datetime(d["month"], format="%m/%Y", errors="coerce")
    d["indexer"] = [classify_dpf(t, k) for t, k in zip(d["title"], d["debt_type"])]
    return d.dropna(subset=["stock", "month"])


def transform_data() -> dict[str, pd.DataFrame]:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    quotes = normalise_tesouro(read_tesouro_raw())
    quotes.to_csv(PROCESSED_FILE_PATH, index=False, sep=";", encoding="utf-8")
    tables = {
        "quotes": quotes,
        "dim_security": build_dim_security(quotes),
        "macro": normalise_sgs(),
        "ipca_index": normalise_ipca_index(),
        "focus": normalise_focus(),
        "dpf": normalise_dpf(),
    }
    log.info("transform_ok", extra={k: len(v) for k, v in tables.items()})
    return tables


if __name__ == "__main__":
    transform_data()
