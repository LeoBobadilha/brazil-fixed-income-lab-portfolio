"""Vectorised official-convention pricing across a full price history.

For one security and N pricing dates, the du matrix (N x flows) is built with
``numpy.busday_count`` and the Tesouro truncation/rounding rules are applied
element-wise, so ~180k historical observations price in seconds.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from src import calendar_br
from src.pricing.engine import _PV_ROUND
from src.pricing.instruments import Product, cashflow_schedule
from src.pricing.rounding import round_half_up, trunc


def settlement_dates(base_dates: np.ndarray, lag: int) -> np.ndarray:
    """Settlement = base date + ``lag`` business days (as-of each base date)."""
    return calendar_br.settlement_date(np.asarray(base_dates, dtype="datetime64[D]"), lag)


def du_matrix(settle: np.ndarray, asof: np.ndarray, flow_dates: np.ndarray) -> np.ndarray:
    settle = np.asarray(settle, dtype="datetime64[D]")
    asof = np.asarray(asof, dtype="datetime64[D]")
    out = np.zeros((len(settle), len(flow_dates)), dtype=np.int64)
    cut = np.datetime64(calendar_br.CONSCIENCIA_NEGRA_LAW_DATE, "D")
    for with_new, mask in ((False, asof < cut), (True, asof >= cut)):
        if mask.any():
            cal = calendar_br._busdaycal(with_new)
            out[mask] = np.busday_count(settle[mask][:, None], flow_dates[None, :], busdaycal=cal)
    return out


def official_quotes(
    product: Product,
    maturity: date,
    base_dates: np.ndarray,
    rates_pct: np.ndarray,
    settlement_lag: int = 0,
) -> dict[str, np.ndarray]:
    """Return per-date official cotação (% of VNA) or PU (LTN/NTN-F).

    Keys: ``value`` (cotação or PU), ``kind`` ("cotacao" | "pu"),
    ``settlement`` dates, and ``n_flows`` remaining.
    """
    sched = cashflow_schedule(product, maturity)
    fd = np.array([d for d, _, _ in sched], dtype="datetime64[D]")
    amt = np.array([a for _, a, _ in sched], dtype=float)
    base = np.asarray(base_dates, dtype="datetime64[D]")
    settle = settlement_dates(base, settlement_lag)
    du = du_matrix(settle, base, fd)
    alive = (fd[None, :] > settle[:, None]) & (du > 0)
    r = trunc(np.asarray(rates_pct, float), 6)[:, None] / 100.0
    expo = trunc(du / 252.0, 14)
    with np.errstate(over="ignore", invalid="ignore"):
        disc = (1.0 + r) ** expo
        pv = np.where(alive, amt[None, :] / disc, 0.0)
    code = product.code
    if code == "LTN":
        value = trunc(pv.sum(axis=1), 6)
        kind = "pu"
    else:
        if code in _PV_ROUND:
            pv = np.where(alive, round_half_up(pv, _PV_ROUND[code]), 0.0)
        total = pv.sum(axis=1)
        if code == "NTNF":
            value, kind = trunc(total, 6), "pu"
        else:
            value, kind = trunc(total, 4), "cotacao"
    value = np.where(alive.any(axis=1), value, np.nan)
    return {"value": value, "kind": kind, "settlement": settle, "n_flows": alive.sum(axis=1)}


def model_risk(
    product: Product, maturity: date, base_dates: np.ndarray, rates_pct: np.ndarray, settlement_lag: int = 0
) -> dict[str, np.ndarray]:
    """Unrounded value, Macaulay/modified duration, convexity, DV01 per date."""
    sched = cashflow_schedule(product, maturity)
    fd = np.array([d for d, _, _ in sched], dtype="datetime64[D]")
    amt = np.array([a for _, a, _ in sched], dtype=float)
    base = np.asarray(base_dates, dtype="datetime64[D]")
    settle = settlement_dates(base, settlement_lag)
    du = du_matrix(settle, base, fd)
    alive = (fd[None, :] > settle[:, None]) & (du > 0)
    y = np.asarray(rates_pct, float)[:, None] / 100.0
    t = du / 252.0
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        pv = np.where(alive, amt[None, :] * (1.0 + y) ** (-t), 0.0)
        p = pv.sum(axis=1)
        mac = (t * pv).sum(axis=1) / p
        mod = mac / (1.0 + y[:, 0])
        conv = (t * (t + 1.0) * pv).sum(axis=1) / ((1.0 + y[:, 0]) ** 2 * p)
        last_t = np.where(alive, t, 0).max(axis=1)
    bad = ~alive.any(axis=1)
    for a in (p, mac, mod, conv, last_t):
        a[bad] = np.nan
    return {"value": p, "macaulay": mac, "modified": mod, "convexity": conv, "dv01": mod * p * 1e-4, "years_to_last": last_t}
