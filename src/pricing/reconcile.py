"""Reconcile modelled prices with every official Tesouro Direto price.

Settlement conventions (inferred from the data and consistent with Tesouro
Direto rules):
    buy  side: D+1 settlement for the whole history;
    sell side: D+1 until 2021-09-10, D+0 from 2021-09-13 (same-day redemption);
    base price ("PU Base"): D+0 at the sell rate.

Nominal products (LTN, NTN-F) are priced directly. Index-linked products need a
VNA. Two VNA estimates are used:

* consensus VNA - for each (date, side, indexer) the interval of VNA values
  consistent with every official price is intersected; a non-empty
  intersection proves a single VNA reproduces all prices of that day to the
  cent. Its midpoint is the consensus VNA.
* independent VNA - built only from IBGE IPCA index numbers (IPCA family) or
  BCB Selic rates (LFT). Differences vs consensus measure the projection error
  of an outside observer (ANBIMA IPCA projections are not open data).
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from src import calendar_br
from src.pricing.batch import model_risk, official_quotes
from src.pricing.instruments import PRODUCTS
from src.pricing.rounding import round_half_up, trunc
from src.pricing.vna import IPCA_INDEX_JUN_2000

SELL_D0_FROM = np.datetime64("2021-09-13")
SIDES = (("buy", "buy_rate", "buy_price"), ("sell", "sell_rate", "sell_price"), ("base", "sell_rate", "base_price"))


def settlement_lag(side: str, base_dates: np.ndarray) -> np.ndarray:
    base = np.asarray(base_dates, dtype="datetime64[D]")
    if side == "buy":
        return np.ones(len(base), dtype=int)
    if side == "sell":
        return np.where(base < SELL_D0_FROM, 1, 0)
    return np.zeros(len(base), dtype=int)


def price_history(quotes: pd.DataFrame, dim: pd.DataFrame) -> pd.DataFrame:
    """Official-convention cotação/PU for every modelled security, date and side."""
    modelled = set(dim.loc[dim["modelled"], "security_id"])
    out = []
    for sid, g in quotes[quotes["security_id"].isin(modelled)].groupby("security_id"):
        p = PRODUCTS[g["product_code"].iat[0]]
        mat = g["maturity_date"].iat[0].date()
        for side, rcol, pcol in SIDES:
            gg = g.dropna(subset=[rcol, pcol])
            if gg.empty:
                continue
            base = gg["base_date"].values.astype("datetime64[D]")
            lags = settlement_lag(side, base)
            for lag in np.unique(lags):
                m = lags == lag
                q = official_quotes(p, mat, base[m], gg[rcol].values[m], int(lag))
                out.append(pd.DataFrame({
                    "security_id": sid, "product_code": p.code, "base_date": base[m], "side": side,
                    "settlement_date": q["settlement"], "rate": gg[rcol].values[m],
                    "official_price": gg[pcol].values[m], "model_value": q["value"], "value_kind": q["kind"],
                }))
    df = pd.concat(out, ignore_index=True)
    return df[np.isfinite(df["model_value"]) & (df["model_value"] > 0)]


# --- Independent VNA ---------------------------------------------------------


def ipca_vna_independent(settle: np.ndarray, ipca_index: pd.DataFrame) -> np.ndarray:
    """VNA from IBGE index numbers; projection proxy = realised IPCA of the month.

    Tesouro uses the ANBIMA projection for the current month (not open data);
    using the realised figure is a look-ahead proxy for validation only.
    """
    idx = ipca_index.set_index(ipca_index["month"].dt.to_period("M"))["index"]
    out = np.full(len(settle), np.nan)
    for i, s in enumerate(pd.DatetimeIndex(settle)):
        last15 = pd.Timestamp(s.year, s.month, 15) if s.day >= 15 else pd.Timestamp(s.year, s.month, 15) - pd.DateOffset(months=1)
        m_prev = (last15 - pd.DateOffset(months=1)).to_period("M")
        m_cur = last15.to_period("M")
        if m_prev not in idx.index:
            continue
        vna15 = trunc(1000.0 * trunc(idx[m_prev] / IPCA_INDEX_JUN_2000, 16), 6)
        if m_cur in idx.index:
            proj = idx[m_cur] / idx[m_prev] - 1.0
        else:
            # Month not yet published: last published monthly variation as proxy.
            proj = idx.iloc[-1] / idx.iloc[-2] - 1.0
        nxt = last15 + pd.DateOffset(months=1)
        x = trunc((s - last15).days / (nxt - last15).days, 14)
        out[i] = trunc(vna15 * trunc((1 + proj) ** x, 16), 6)
    return out


def selic_vna_independent(settle: np.ndarray, base: np.ndarray, macro: pd.DataFrame) -> np.ndarray:
    """LFT VNA = 1000 x accumulated daily Selic since 01/07/2000 (SGS 1178),
    projected from base to settlement with the Copom target (SGS 432)."""
    eff = macro[macro["series"] == "selic_effective"].set_index("date")["value"].sort_index()
    eff = eff[eff.index >= "2000-07-01"]
    daily = round_half_up((1 + eff.values / 100.0) ** (1 / 252), 8)
    acc = np.cumprod(daily)  # factor including each listed day
    acc_dates = eff.index.values.astype("datetime64[D]")
    tgt = macro[macro["series"] == "selic_target"].set_index("date")["value"].sort_index()
    base = np.asarray(base, dtype="datetime64[D]")
    settle = np.asarray(settle, dtype="datetime64[D]")
    # factor accumulated over business days strictly before ``base``
    pos = np.searchsorted(acc_dates, base, side="left") - 1
    acc_before = np.where(pos >= 0, acc[np.clip(pos, 0, None)], 1.0)
    vna = trunc(1000.0 * round_half_up(acc_before, 16), 6)
    lag = calendar_br.business_days(base, settle)
    meta = tgt.reindex(pd.DatetimeIndex(base), method="ffill").values
    proj = np.where(lag > 0, trunc((1 + meta / 100) ** (1 / 252), 14) ** lag, 1.0)
    return trunc(vna * proj, 6)


# --- Reconciliation ---------------------------------------------------------


def reconcile(history: pd.DataFrame, macro: pd.DataFrame, ipca_index: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    h = history.reset_index(drop=True)
    h["indexer"] = h["product_code"].map(lambda c: PRODUCTS[c].indexer)
    nominal = h["value_kind"] == "pu"
    cot = h["model_value"] / 100.0
    h["vna_lo"] = np.where(nominal, np.nan, h["official_price"] / cot)
    h["vna_hi"] = np.where(nominal, np.nan, (h["official_price"] + 0.01) / cot)
    idx = h[~nominal].groupby(["indexer", "base_date", "side"]).agg(
        vna_lo=("vna_lo", "max"), vna_hi=("vna_hi", "min"), n_sec=("vna_lo", "size"), vna_median=("vna_lo", "median"))
    idx["single_vna_consistent"] = idx["vna_lo"] < idx["vna_hi"]
    idx["vna_consensus"] = np.where(idx["single_vna_consistent"], (idx["vna_lo"] + idx["vna_hi"]) / 2, idx["vna_median"])
    idx = idx.reset_index()
    h = h.drop(columns=["vna_lo", "vna_hi"]).merge(
        idx[["indexer", "base_date", "side", "vna_consensus", "single_vna_consistent"]], on=["indexer", "base_date", "side"], how="left")
    h = h.reset_index(drop=True)
    nominal = h["value_kind"] == "pu"
    h["model_price"] = np.where(nominal, trunc(h["model_value"], 2),
                                trunc(trunc(h["vna_consensus"] * h["model_value"] / 100.0, 6), 2))
    h["price_error"] = h["model_price"] - h["official_price"]
    h["exact"] = h["price_error"].abs() < 0.005

    # Independent VNA (one value per indexer/date/side)
    keys = h[~nominal][["indexer", "base_date", "side", "settlement_date"]].drop_duplicates(["indexer", "base_date", "side"])
    vind = np.full(len(keys), np.nan)
    m_ipca = (keys["indexer"] == "ipca").values
    vind[m_ipca] = ipca_vna_independent(keys.loc[m_ipca, "settlement_date"].values, ipca_index)
    m_sel = (keys["indexer"] == "selic").values
    vind[m_sel] = selic_vna_independent(keys.loc[m_sel, "settlement_date"].values, keys.loc[m_sel, "base_date"].values, macro)
    keys = keys.assign(vna_independent=vind).drop(columns="settlement_date")
    vna_daily = idx.merge(keys, on=["indexer", "base_date", "side"], how="left")
    vna_daily["independent_diff_bp"] = (vna_daily["vna_independent"] / vna_daily["vna_consensus"] - 1) * 1e4
    h = h.merge(keys, on=["indexer", "base_date", "side"], how="left")
    return h, vna_daily


def lft_spread_precision(h: pd.DataFrame) -> pd.DataFrame:
    """Implied LFT spread from official PU and independent VNA vs published rate.

    If the published 2-decimal spread is a rounding of a more precise rate, the
    implied spread should differ from it by at most ~0.5 bp.
    """
    l = h[(h["product_code"] == "LFT") & h["vna_independent"].notna()].copy()
    l["cot_implied"] = l["official_price"] / l["vna_independent"] * 100
    du = calendar_br.business_days(l["settlement_date"].values, pd.to_datetime(l["security_id"].str[-8:]).values.astype("datetime64[D]"))
    with np.errstate(invalid="ignore", divide="ignore"):
        l["rate_implied"] = ((100.0 / l["cot_implied"]) ** (252.0 / du) - 1) * 100
    l["implied_minus_published_bp"] = (l["rate_implied"] - l["rate"]) * 100
    return l


def summarise(h: pd.DataFrame, vna_daily: pd.DataFrame) -> dict:
    h = h.assign(year=pd.DatetimeIndex(h["base_date"]).year)
    by_product = (
        h.groupby("product_code")
        .agg(rows=("exact", "size"), exact_pct=("exact", "mean"),
             within_1c_pct=("price_error", lambda e: (e.abs() <= 0.0100001).mean()),
             within_2c_pct=("price_error", lambda e: (e.abs() <= 0.0200001).mean()),
             max_abs_error=("price_error", lambda e: e.abs().max()),
             first=("base_date", "min"), last=("base_date", "max"))
        .reset_index()
    )
    by_year = h.groupby(["product_code", "year"])["exact"].mean().unstack("year")
    vd = vna_daily.assign(year=pd.DatetimeIndex(vna_daily["base_date"]).year)
    vna_cons = vd.groupby(["indexer", "year"])["single_vna_consistent"].mean().unstack("year")
    indep = vd.groupby("indexer")["independent_diff_bp"].describe(percentiles=[0.05, 0.5, 0.95])
    return {"by_product": by_product, "by_year": by_year, "single_vna": vna_cons, "independent_vna_bp": indep}


def risk_history(quotes: pd.DataFrame, dim: pd.DataFrame) -> pd.DataFrame:
    """Model duration/convexity/DV01 at the purchase rate, valued on the base date."""
    modelled = set(dim.loc[dim["modelled"], "security_id"])
    out = []
    for sid, g in quotes[quotes["security_id"].isin(modelled)].dropna(subset=["buy_rate"]).groupby("security_id"):
        p = PRODUCTS[g["product_code"].iat[0]]
        mat = g["maturity_date"].iat[0].date()
        base = g["base_date"].values.astype("datetime64[D]")
        r = model_risk(p, mat, base, g["buy_rate"].values, 0)
        out.append(pd.DataFrame({
            "security_id": sid, "base_date": base, "rate": g["buy_rate"].values, "macaulay": r["macaulay"],
            "modified": r["modified"], "convexity": r["convexity"], "dv01_per_100": r["dv01"],
            "dv01_brl": r["modified"] * g["buy_price"].values * 1e-4, "years_to_last_flow": r["years_to_last"],
        }))
    return pd.concat(out, ignore_index=True).dropna(subset=["modified"])
