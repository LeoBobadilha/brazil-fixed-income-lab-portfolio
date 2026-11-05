"""Data-quality rules. A failed ``error`` check blocks publication; ``warn`` is reported."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


@dataclass
class Check:
    name: str
    severity: str  # "error" | "warn"
    passed: bool
    detail: str


def check_quotes(q: pd.DataFrame, previous: dict | None = None) -> list[Check]:
    out: list[Check] = []
    dup = q.duplicated(subset=["security_id", "base_date"]).sum()
    out.append(Check("quotes.unique_security_date", "error", dup == 0, f"{dup} duplicate (security, date) rows"))
    nulls = q[["product_name", "maturity_date", "base_date"]].isna().sum().sum()
    out.append(Check("quotes.keys_not_null", "error", nulls == 0, f"{nulls} null key values"))
    # Rates in % p.a.: real yields and nominal yields within broad historical bounds
    real = q["product_code"].isin(["NTNBP", "NTNB", "RENDA", "EDUCA", "NTNC"])
    bad_real = ((q.loc[real, "buy_rate"] < -5) | (q.loc[real, "buy_rate"] > 20)).sum()
    out.append(Check("quotes.real_rate_bounds", "error", bad_real == 0, f"{bad_real} real rates outside [-5, 20]%"))
    nominal = q["product_code"].isin(["LTN", "NTNF"])
    bad_nom = ((q.loc[nominal, "buy_rate"] < 0) | (q.loc[nominal, "buy_rate"] > 40)).sum()
    out.append(Check("quotes.nominal_rate_bounds", "error", bad_nom == 0, f"{bad_nom} nominal rates outside [0, 40]%"))
    lft = q["product_code"] == "LFT"
    bad_lft = (q.loc[lft, "buy_rate"].abs() > 2).sum()
    out.append(Check("quotes.lft_spread_bounds", "error", bad_lft == 0, f"{bad_lft} LFT spreads beyond ±2%"))
    # Buy price must not be below sell price (investor buys at the higher price)
    both = q.dropna(subset=["buy_price", "sell_price"])
    inv = (both["buy_price"] < both["sell_price"] - 0.005).sum()
    out.append(Check("quotes.buy_ge_sell_price", "warn", inv == 0, f"{inv} rows with buy price < sell price"))
    after_mat = (q["base_date"] > q["maturity_date"]).sum()
    out.append(Check("quotes.no_quote_after_maturity", "error", after_mat == 0, f"{after_mat} quotes after maturity"))
    weekend = (q["base_date"].dt.day_of_week >= 5).sum()
    out.append(Check("quotes.no_weekend_dates", "warn", weekend == 0, f"{weekend} weekend base dates"))
    sp = isolated_spikes(q)
    sample = ", ".join(f"{r.security_id}@{r.base_date.date()}" for r in sp.head(6).itertuples(index=False))
    out.append(Check("quotes.isolated_reversals", "warn", sp.empty,
                     f"{len(sp)} official quotes reverse >50 bp for one day while their rate family does not "
                     f"(kept as published; excluded from research statistics){': ' + sample if sample else ''}"))
    if previous:
        prev_rows, prev_max = previous.get("rows"), previous.get("max_date")
        if prev_rows:
            ok = len(q) >= 0.995 * prev_rows
            out.append(Check("quotes.no_history_loss", "error", ok, f"rows {len(q)} vs previous {prev_rows}"))
        if prev_max:
            ok = q["base_date"].max() >= pd.Timestamp(prev_max)
            out.append(Check("quotes.date_not_regressing", "error", ok, f"max date {q['base_date'].max().date()} vs previous {prev_max}"))
    return out


FAMILY = {"LTN": "nominal", "NTNF": "nominal", "LFT": "floating", "NTNBP": "real", "NTNB": "real", "RENDA": "real", "EDUCA": "real", "NTNC": "real"}


def isolated_spikes(q: pd.DataFrame, jump_bp: float = 50, revert_bp: float = 15, max_peers: int = 2) -> pd.DataFrame:
    """One-day rate reversals that are not shared by the rest of the rate family.

    A quote is flagged when its purchase rate jumps more than ``jump_bp`` and
    reverts the next observation (net change below ``revert_bp``), while at most
    ``max_peers`` other securities of the same family show the same pattern that
    day. Market-wide reversal days (e.g. 2020-03-17) are therefore not flagged.
    """
    x = q.sort_values(["security_id", "base_date"])[["security_id", "product_code", "base_date", "buy_rate"]].copy()
    g = x.groupby("security_id")["buy_rate"]
    d1 = (x["buy_rate"] - g.shift(1)) * 100
    d2 = (g.shift(-1) - x["buy_rate"]) * 100
    span = (g.shift(-1) - g.shift(1)).abs() * 100
    cand = x[(d1.abs() > jump_bp) & (d2.abs() > jump_bp) & (d1 * d2 < 0) & (span < revert_bp)].copy()
    if cand.empty:
        return cand
    cand["family"] = cand["product_code"].map(FAMILY)
    n = cand.groupby(["family", "base_date"])["security_id"].transform("size")
    return cand[n <= max_peers + 1][["security_id", "base_date", "buy_rate"]]


def check_reconciliation(summary: pd.DataFrame) -> list[Check]:
    """Validated products must keep reproducing official prices."""
    thresholds = {"LTN": 0.99, "NTNF": 0.99, "NTNBP": 0.99, "NTNB": 0.98, "RENDA": 0.99, "EDUCA": 0.99}
    out = []
    for r in summary.itertuples(index=False):
        if r.product_code in thresholds:
            ok = r.within_1c_pct >= thresholds[r.product_code]
            out.append(Check(f"recon.{r.product_code}", "error", ok,
                             f"{r.within_1c_pct:.4%} of {r.rows} official prices within R$0.01 (threshold {thresholds[r.product_code]:.0%})"))
    lft = summary[summary["product_code"] == "LFT"]
    if len(lft):
        out.append(Check("recon.LFT", "warn", True,
                         f"{float(lft['within_1c_pct'].iat[0]):.2%} within R$0.01; post-2020 spreads published with 2 dp (see methodology)"))
    return out


def check_macro(macro: pd.DataFrame, asof: pd.Timestamp) -> list[Check]:
    out = []
    future = (macro["date"] > asof).sum()
    out.append(Check("macro.no_future_dates", "error", future == 0, f"{future} observations after run date"))
    for s, g in macro.groupby("series"):
        dup = g["date"].duplicated().sum()
        out.append(Check(f"macro.{s}.unique_dates", "error", dup == 0, f"{dup} duplicate dates"))
    sel = macro[macro["series"] == "selic_target"]["value"]
    out.append(Check("macro.selic_target_bounds", "error", bool(((sel > 0) & (sel < 50)).all()), "Selic target within (0, 50)%"))
    return out


def as_records(checks: list[Check]) -> list[dict]:
    return [asdict(c) for c in checks]


def blocking_failures(checks: list[Check]) -> list[Check]:
    return [c for c in checks if c.severity == "error" and not c.passed]
