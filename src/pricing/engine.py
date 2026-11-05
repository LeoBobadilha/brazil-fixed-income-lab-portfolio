"""Cash-flow pricing and rate-sensitivity engine for Tesouro Direto securities.

Two modes:

* ``official`` reproduces Tesouro Nacional's published truncation/rounding
  rules (Metodologia de Cálculo dos Títulos Públicos Federais; Tesouro RendA+ /
  Educa+ methodology notes). Used for reconciliation with official prices.
* ``model`` uses unrounded arithmetic. Used for analytics (duration,
  convexity, DV01) and scenario repricing where smooth derivatives matter.

Rates are annual percentages on a business-day/252 basis, exactly as quoted by
Tesouro Direto (e.g. 7.24 means 7.24% p.a.). For IPCA-linked bonds the rate is
real; for LFT it is the spread (ágio/deságio) over Selic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

from src import calendar_br
from src.pricing.instruments import PRODUCTS, Product, cashflow_schedule
from src.pricing.rounding import round_half_up, trunc

# Per-flow present-value rounding (decimal places) from the official tables.
_PV_ROUND = {"NTNF": 9, "NTNB": 10, "NTNC": 10, "RENDA": 10, "EDUCA": 10}
FACE = {"LTN": 1000.0, "NTNF": 1000.0}  # nominal-face products; others are % of VNA


@dataclass(frozen=True)
class Flows:
    dates: np.ndarray  # datetime64[D]
    amounts: np.ndarray
    du: np.ndarray
    kinds: list[str]

    @property
    def t(self) -> np.ndarray:
        return self.du / 252.0


def _as_product(p: Product | str) -> Product:
    return PRODUCTS[p] if isinstance(p, str) else p


def future_flows(product: Product | str, maturity: date, settlement: date, asof: date | None = None) -> Flows:
    """Flows paid strictly after settlement (du > 0).

    ``asof`` is the pricing date that determines the holiday calendar in force
    (defaults to ``settlement``), see ``calendar_br.calendar_for``.
    """
    product = _as_product(product)
    sched = cashflow_schedule(product, maturity)
    dates = np.array([d for d, _, _ in sched], dtype="datetime64[D]")
    amounts = np.array([a for _, a, _ in sched], dtype=float)
    du = calendar_br.business_days(np.datetime64(settlement, "D"), dates, asof=asof or settlement)
    keep = (dates > np.datetime64(settlement, "D")) & (du > 0)
    return Flows(dates[keep], amounts[keep], du[keep].astype(float), [k for k, m in zip((s[2] for s in sched), keep) if m])


@dataclass(frozen=True)
class PriceResult:
    cotacao: float | None  # % of VNA (None for nominal-face products)
    pu: float | None  # price per security, 6 dp (None when VNA unknown)
    pu_td: float | None  # Tesouro Direto display price, truncated to 2 dp


def price(
    product: Product | str,
    maturity: date,
    settlement: date,
    rate_pct: float,
    vna: float | None = None,
    mode: str = "official",
) -> PriceResult:
    product = _as_product(product)
    f = future_flows(product, maturity, settlement)
    if len(f.du) == 0:
        return PriceResult(None, None, None)
    official = mode == "official"
    r = (trunc(rate_pct, 6) if official else rate_pct) / 100.0
    expo = trunc(f.du / 252.0, 14) if official else f.du / 252.0
    disc = (1.0 + r) ** expo
    code = product.code

    if code == "LTN":
        pu = 1000.0 / disc[0]
        pu = trunc(pu, 6) if official else float(pu)
        return PriceResult(None, pu, trunc(pu, 2))

    pv = f.amounts / disc
    if official and code in _PV_ROUND:
        pv = round_half_up(pv, _PV_ROUND[code])
    total = float(np.sum(pv))

    if code == "NTNF":
        pu = trunc(total, 6) if official else total
        return PriceResult(None, pu, trunc(pu, 2))

    cot = trunc(total, 4) if official else total
    if vna is None:
        return PriceResult(cot, None, None)
    pu = vna * cot / 100.0
    pu = trunc(pu, 6) if official else pu
    return PriceResult(cot, pu, trunc(pu, 2))


@dataclass(frozen=True)
class Risk:
    pv: float  # model price per 100 (VNA basis) or per 1000 face
    macaulay: float  # years (du/252 basis)
    modified: float  # years
    convexity: float  # years^2
    dv01: float  # price change per 1 bp, same unit as ``pv``
    years_to_last_flow: float


def risk(product: Product | str, maturity: date, settlement: date, rate_pct: float) -> Risk | None:
    """Analytical yield sensitivities under annual compounding on du/252.

    With P(y) = sum CF_i (1+y)^-t_i:
      Macaulay  D   = sum t_i PV_i / P
      Modified  D*  = D / (1+y) = -(dP/dy)/P
      Convexity C   = sum t_i (t_i+1) PV_i / ((1+y)^2 P) = (d2P/dy2)/P
      DV01          = D* * P * 0.0001
    For LFT the rate is the spread over Selic, so these are spread
    sensitivities, not exposure to the Selic level.
    """
    product = _as_product(product)
    f = future_flows(product, maturity, settlement)
    if len(f.du) == 0:
        return None
    y = rate_pct / 100.0
    t = f.t
    pv_i = f.amounts * (1.0 + y) ** (-t)
    p = float(pv_i.sum())
    mac = float((t * pv_i).sum() / p)
    mod = mac / (1.0 + y)
    conv = float((t * (t + 1.0) * pv_i).sum() / ((1.0 + y) ** 2 * p))
    return Risk(p, mac, mod, conv, mod * p * 1e-4, float(t[-1]))


def model_value(product: Product | str, maturity: date, settlement: date, rate_pct: float) -> float:
    """Unrounded PV per 100 of VNA (or per 1000 face for LTN/NTN-F)."""
    f = future_flows(_as_product(product), maturity, settlement)
    return float((f.amounts * (1.0 + rate_pct / 100.0) ** (-f.t)).sum())


def solve_rate(
    product: Product | str, maturity: date, settlement: date, target_value: float, guess: float = 10.0
) -> float:
    """Yield (% p.a.) whose model value equals ``target_value`` (Newton + bisection)."""
    product = _as_product(product)
    f = future_flows(product, maturity, settlement)
    t, a = f.t, f.amounts

    def val(y):
        return float((a * (1 + y) ** (-t)).sum())

    lo, hi = -0.5, 2.0
    y = guess / 100.0
    for _ in range(100):
        v = val(y)
        dv = float((-t * a * (1 + y) ** (-t - 1)).sum())
        step = (v - target_value) / dv if dv else 0.0
        y_new = y - step
        if not (lo < y_new < hi):
            # fall back to bisection on a monotone function
            for _ in range(200):
                mid = (lo + hi) / 2
                if val(mid) > target_value:
                    lo = mid
                else:
                    hi = mid
            return (lo + hi) / 2 * 100
        if abs(y_new - y) < 1e-14:
            return y_new * 100
        y = y_new
    return y * 100
