"""Security master: product definitions, identifiers and cash-flow schedules.

Every Tesouro Direto security is identified by (product, maturity date). The
same commercial name (e.g. "Tesouro IPCA+") covers many different instruments,
so the canonical identifier is ``<code>-<YYYYMMDD>`` using the official final
maturity date from the Tesouro Transparente dataset.

NTN-B1 naming: the dataset maturity is the FINAL amortisation date. The
commercial year is the conversion (first payment) year:
    Renda+  year = maturity year - 19  (240 monthly payments)
    Educa+  year = maturity year - 4   (60 monthly payments)
Source: Tesouro Direto, "Tesouro RendA+" methodology (Renda+ 2030: conversion
15/01/2030, vencimento 15/12/2049) and "Tesouro Educa+" (Educa+ 2030:
conversion 15/01/2030, vencimento 15/12/2034).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from dateutil.relativedelta import relativedelta

from src.pricing.rounding import round_half_up, trunc

# Semiannual coupon factors (per 100 for NTN-B, per 1000 for NTN-F), as
# published in the Tesouro Nacional methodology.
NTNB_COUPON = round_half_up(((1.06) ** 0.5 - 1) * 100, 6)  # 2.956301
NTNF_COUPON = round_half_up(((1.10) ** 0.5 - 1) * 1000, 5)  # 48.80885


@dataclass(frozen=True)
class Product:
    code: str
    official: str  # Tesouro Transparente "Tipo Titulo"
    short_en: str
    short_pt: str
    instrument: str  # Treasury instrument (LTN, NTN-F, ...)
    family: str  # "nominal" | "real" | "floating"
    indexer: str  # "pre" | "ipca" | "selic" | "igpm"
    coupon: str  # "none" | "semiannual" | "monthly_amortisation"
    modelled: bool  # cash-flow valuation validated and enabled
    n_amort: int = 0


PRODUCTS: dict[str, Product] = {
    p.code: p
    for p in [
        Product("LTN", "Tesouro Prefixado", "Fixed-rate (zero)", "Prefixado", "LTN", "nominal", "pre", "none", True),
        Product("NTNF", "Tesouro Prefixado com Juros Semestrais", "Fixed-rate, semiannual coupons",
                "Prefixado com Juros Semestrais", "NTN-F", "nominal", "pre", "semiannual", True),
        Product("LFT", "Tesouro Selic", "Selic floating-rate", "Selic", "LFT", "floating", "selic", "none", True),
        Product("NTNBP", "Tesouro IPCA+", "Inflation-linked (zero)", "IPCA+", "NTN-B Principal", "real", "ipca", "none", True),
        Product("NTNB", "Tesouro IPCA+ com Juros Semestrais", "Inflation-linked, semiannual coupons",
                "IPCA+ com Juros Semestrais", "NTN-B", "real", "ipca", "semiannual", True),
        Product("RENDA", "Tesouro Renda+ Aposentadoria Extra", "Renda+ retirement income", "Renda+ Aposentadoria Extra",
                "NTN-B1", "real", "ipca", "monthly_amortisation", True, 240),
        Product("EDUCA", "Tesouro Educa+", "Educa+ education income", "Educa+", "NTN-B1", "real", "ipca",
                "monthly_amortisation", True, 60),
        # NTN-C (IGP-M) has a single outstanding Tesouro Direto security and no
        # second bond for cross-sectional VNA validation: observed data only.
        Product("NTNC", "Tesouro IGPM+ com Juros Semestrais", "IGP-M linked, semiannual coupons",
                "IGPM+ com Juros Semestrais", "NTN-C", "real", "igpm", "semiannual", False),
    ]
}

PRODUCT_BY_OFFICIAL = {p.official.casefold(): p for p in PRODUCTS.values()}


def product_for(official_name: str) -> Product:
    key = str(official_name).strip().casefold()
    if key not in PRODUCT_BY_OFFICIAL:
        raise KeyError(f"Unknown Tesouro Direto product: {official_name!r}")
    return PRODUCT_BY_OFFICIAL[key]


def security_id(code: str, maturity: date) -> str:
    return f"{code}-{maturity:%Y%m%d}"


def commercial_year(product: Product, maturity: date) -> int:
    if product.code == "RENDA":
        return maturity.year - 19
    if product.code == "EDUCA":
        return maturity.year - 4
    return maturity.year


def conversion_date(product: Product, maturity: date) -> date | None:
    """First amortisation date for NTN-B1 (None for other products)."""
    if product.n_amort:
        return maturity - relativedelta(months=product.n_amort - 1)
    return None


def display_name(product: Product, maturity: date, lang: str = "pt") -> str:
    base = product.official if lang == "pt" else product.official.replace("com Juros Semestrais", "with semiannual coupons")
    return f"{base} {commercial_year(product, maturity)}"


def amortisation_rates(n: int) -> list[float]:
    """NTN-B1 amortisation rates per 100: Ta = trunc6(100/n); last adjusts."""
    ta = trunc(100.0 / n, 6)
    last = round_half_up(100.0 - (n - 1) * ta, 6)
    return [ta] * (n - 1) + [last]


def cashflow_schedule(product: Product, maturity: date) -> list[tuple[date, float, str]]:
    """Full contractual schedule as (payment date, amount, kind).

    Amounts are per 1000 face for LTN/NTN-F and per 100 of (projected) VNA for
    LFT/NTN-B/NTN-B Principal/NTN-B1, matching the official cotação basis.
    Payment dates are contractual dates; ``du`` counting handles non-business
    days exactly as the official examples do.
    """
    c = product.code
    if c == "LTN":
        return [(maturity, 1000.0, "principal")]
    if c in ("LFT", "NTNBP"):
        return [(maturity, 100.0, "principal")]
    if c in ("NTNF", "NTNB", "NTNC"):
        coupon = NTNF_COUPON if c == "NTNF" else NTNB_COUPON
        principal = 1000.0 if c == "NTNF" else 100.0
        flows: list[tuple[date, float, str]] = []
        d = maturity
        # NTN-F coupons since issue are at most ~15 years; NTN-B at most ~40.
        for _ in range(100):
            flows.append((d, coupon, "coupon"))
            d = d - relativedelta(months=6)
            if d.year < 2000:
                break
        flows.reverse()
        flows[-1] = (maturity, coupon + principal, "coupon+principal")
        return flows
    if c in ("RENDA", "EDUCA"):
        first = conversion_date(product, maturity)
        rates = amortisation_rates(product.n_amort)
        return [(first + relativedelta(months=i), rates[i], "amortisation") for i in range(product.n_amort)]
    raise ValueError(f"No schedule for {c}")
