"""Constant-duration yield series, curve slopes, volatility and drawdowns.

Constant-duration rates are linear interpolations of purchase rates against
Macaulay duration across same-family securities on each date. There is no
extrapolation: a tenor outside the observed duration range is left missing.
Real curve: Tesouro IPCA+ and IPCA+ with semiannual coupons (NTN-B family).
Nominal curve: Tesouro Prefixado and Prefixado with semiannual coupons.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

REAL_CODES = ("NTNBP", "NTNB")
NOMINAL_CODES = ("LTN", "NTNF")
REAL_TENORS = (2.0, 5.0, 10.0, 15.0, 20.0)
NOMINAL_TENORS = (1.0, 2.0, 3.0, 5.0)


def constant_duration(panel: pd.DataFrame, codes: tuple[str, ...], tenors: tuple[float, ...]) -> pd.DataFrame:
    """panel columns: base_date, product_code, macaulay, buy_rate."""
    p = panel[panel["product_code"].isin(codes)].dropna(subset=["macaulay", "buy_rate"])
    p = p[p["macaulay"] >= 0.25]  # very short bonds are noisy near maturity
    rows = []
    for d, g in p.groupby("base_date", sort=True):
        g = g.sort_values("macaulay")
        x, y = g["macaulay"].values, g["buy_rate"].values
        rec = {"date": d, "n_securities": len(g), "min_duration": x.min(), "max_duration": x.max()}
        for t in tenors:
            rec[f"d{t:g}y"] = float(np.interp(t, x, y)) if (len(g) >= 2 and x[0] <= t <= x[-1]) else np.nan
        rows.append(rec)
    return pd.DataFrame(rows)


def rolling_vol_bp(series: pd.Series, window: int = 63) -> pd.Series:
    """Annualised std. dev. of daily rate changes (bp), rolling window in obs."""
    return series.diff().mul(100).rolling(window, min_periods=int(window * 0.8)).std() * np.sqrt(252)


def percentile_of_last(series: pd.Series) -> dict:
    s = series.dropna()
    if len(s) < 250:
        return {"percentile": None, "observations": int(len(s)), "valid": False}
    last = s.iloc[-1]
    return {"percentile": float((s <= last).mean() * 100), "observations": int(len(s)),
            "start": str(s.index[0].date()), "valid": True}


def max_drawdown(prices: pd.Series) -> dict:
    s = prices.dropna()
    if len(s) < 20:
        return {}
    peak = s.cummax()
    dd = s / peak - 1
    trough = dd.idxmin()
    peak_date = s.loc[:trough].idxmax()
    rec = s.loc[trough:]
    recovered = rec[rec >= s.loc[peak_date]]
    return {"max_drawdown_pct": float(dd.min() * 100), "peak_date": str(peak_date.date()), "trough_date": str(trough.date()),
            "recovery_date": str(recovered.index[0].date()) if len(recovered) else None,
            "days_peak_to_trough": int((trough - peak_date).days)}


def regime_table(rate: pd.Series, bounds: tuple[float, float], horizon_bd: int = 252) -> dict:
    """Subsequent change in the rate by starting regime (descriptive only).

    Overlapping windows inflate apparent sample size; the effective number of
    independent observations is roughly n / horizon.
    """
    s = rate.dropna()
    fwd = s.shift(-horizon_bd) - s
    lo, hi = bounds
    lab = pd.cut(s, [-np.inf, lo, hi, np.inf], labels=[f"< {lo:g}%", f"{lo:g}–{hi:g}%", f"> {hi:g}%"])
    out = []
    for k, g in fwd.groupby(lab, observed=False):
        g = g.dropna()
        out.append({"regime": str(k), "days": int((lab == k).sum()), "obs_with_forward": int(len(g)),
                    "effective_independent_obs": round(len(g) / horizon_bd, 1),
                    "mean_change_bp": float(g.mean() * 100) if len(g) else None,
                    "median_change_bp": float(g.median() * 100) if len(g) else None,
                    "share_rate_fell": float((g < 0).mean()) if len(g) else None})
    return {"bounds": list(bounds), "horizon_business_days": horizon_bd, "rows": out}
