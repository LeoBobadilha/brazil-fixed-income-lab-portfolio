"""Valor Nominal Atualizado (VNA/VNI) for IPCA-linked bonds and LFT.

IPCA (NTN-B, NTN-B Principal, NTN-B1):
    VNI on the 15th of month M = 1000 x I(M-1) / I(Jun/2000), where I is the
    IBGE IPCA number index (base date 15/07/2000, index 1614.62).
    Between 15ths: VNA_proj = VNA_15 x (1 + IPCA_proj)^x, with
    x = calendar days(settlement - last 15th) / calendar days(next 15th - last 15th).

LFT:
    VNA = 1000 x product of daily Selic factors since 01/07/2000, projected to
    the settlement date with the Copom target: VNA x (1 + meta)^(1/252) per day.

Truncation/rounding follow Tesouro Nacional's methodology tables.
"""

from __future__ import annotations

from datetime import date

import numpy as np
from dateutil.relativedelta import relativedelta

from src.pricing.rounding import round_half_up, trunc

IPCA_INDEX_JUN_2000 = 1614.62


def vni_from_index(index_prev_month: float, index_base: float = IPCA_INDEX_JUN_2000) -> float:
    factor = trunc(index_prev_month / index_base, 16)
    return trunc(1000.0 * factor, 6)


def last_15th(d: date) -> date:
    return date(d.year, d.month, 15) if d.day >= 15 else date(d.year, d.month, 15) - relativedelta(months=1)


def pro_rata_exponent(settlement: date) -> float:
    lo = last_15th(settlement)
    hi = lo + relativedelta(months=1)
    return trunc((settlement - lo).days / (hi - lo).days, 14)


def project_ipca_vna(vna_last_15th: float, ipca_month_pct: float, settlement: date) -> float:
    x = pro_rata_exponent(settlement)
    factor = trunc((1.0 + ipca_month_pct / 100.0) ** x, 16)
    return trunc(vna_last_15th * factor, 6)


def project_selic_vna(vna: float, selic_meta_pct: float, business_days: int = 1) -> float:
    daily = trunc((1.0 + selic_meta_pct / 100.0) ** (1.0 / 252.0), 14)
    return trunc(vna * daily**business_days, 6)


def selic_accumulated_factor(annual_rates_pct: np.ndarray) -> np.ndarray:
    """Running product of daily Selic factors (each rounded to 8 dp)."""
    daily = round_half_up((1.0 + np.asarray(annual_rates_pct, float) / 100.0) ** (1.0 / 252.0), 8)
    return np.cumprod(daily)
