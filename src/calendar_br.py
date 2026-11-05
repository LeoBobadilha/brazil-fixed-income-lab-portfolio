"""Brazilian national business-day calendar (ANBIMA convention).

Tesouro Nacional prices every federal bond with ``du`` = business days between
settlement (inclusive) and payment date (exclusive), excluding weekends and the
national holidays used by ANBIMA. The holiday set is generated algorithmically
so the calendar extends to the last Renda+ payment (2084).

Validated against the official Tesouro Direto Renda+ 2030 and Educa+ 2030
worked examples (300 published DU values) in ``tests/test_calendar.py``.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

FIRST_YEAR = 2000
LAST_YEAR = 2100


def easter_sunday(year: int) -> date:
    """Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month, day = divmod(h + l_ - 7 * m + 114, 31)
    return date(year, month, day + 1)


def national_holidays(year: int) -> list[date]:
    """National holidays observed by the ANBIMA calendar for ``year``."""
    easter = easter_sunday(year)
    days = [
        date(year, 1, 1),  # Confraternização Universal
        easter - timedelta(days=48),  # Carnaval (segunda)
        easter - timedelta(days=47),  # Carnaval (terça)
        easter - timedelta(days=2),  # Paixão de Cristo
        date(year, 4, 21),  # Tiradentes
        date(year, 5, 1),  # Dia do Trabalho
        easter + timedelta(days=60),  # Corpus Christi
        date(year, 9, 7),  # Independência
        date(year, 10, 12),  # Nossa Senhora Aparecida
        date(year, 11, 2),  # Finados
        date(year, 11, 15),  # Proclamação da República
        date(year, 12, 25),  # Natal
    ]
    if year >= 2024:
        # Lei 14.759/2023 made Dia Nacional de Zumbi e da Consciência Negra a
        # national holiday from 2024 onwards.
        days.append(date(year, 11, 20))
    return sorted(days)


# Lei 14.759 (published 22/12/2023) created the 20-November holiday. Prices
# computed before that date used a calendar without it, including for future
# payment dates; the official NTN-B1 worked examples (2022/2023) confirm this.
CONSCIENCIA_NEGRA_LAW_DATE = date(2023, 12, 22)


@lru_cache(maxsize=2)
def _holiday_array(with_nov20: bool = True) -> np.ndarray:
    hols = [
        d
        for y in range(FIRST_YEAR, LAST_YEAR + 1)
        for d in national_holidays(y)
        if with_nov20 or not (d.month == 11 and d.day == 20)
    ]
    return np.array(sorted(set(hols)), dtype="datetime64[D]")


@lru_cache(maxsize=2)
def _busdaycal(with_nov20: bool = True) -> np.busdaycalendar:
    return np.busdaycalendar(weekmask="1111100", holidays=_holiday_array(with_nov20))


def _d64(x) -> np.ndarray:
    return np.asarray(x, dtype="datetime64[D]")


def calendar_for(asof) -> np.busdaycalendar:
    """Holiday calendar in force on ``asof`` (the pricing date)."""
    if asof is None:
        return _busdaycal(True)
    return _busdaycal(bool(_d64(asof) >= np.datetime64(CONSCIENCIA_NEGRA_LAW_DATE, "D")))


def business_days(start, end, asof=None):
    """Business days in ``[start, end)``; vectorised over array-likes.

    ``asof`` selects the holiday calendar known on that date (defaults to the
    current calendar). Pass the pricing date to reproduce historical prices.
    """
    return np.busday_count(_d64(start), _d64(end), busdaycal=calendar_for(asof))


def is_business_day(d, asof=None) -> np.ndarray | bool:
    return np.is_busday(_d64(d), busdaycal=calendar_for(asof))


def add_business_days(d, n: int, asof=None):
    """Roll ``d`` forward to a business day, then move ``n`` business days."""
    return np.busday_offset(_d64(d), n, roll="forward", busdaycal=calendar_for(asof))


# ---------------------------------------------------------------------------
# Settlement calendar (B3 / Tesouro Direto)
# ---------------------------------------------------------------------------
# Tesouro Direto D+1 settlement skips some days that are not national holidays
# (24/31 December, some Sao Paulo local holidays, 2014 World Cup days), while
# ``du`` is still counted on the national calendar. Those days were inferred
# from the official price history and are stored with provenance in
# config/calendars/td_settlement_closures.json (see docs/methodology.md).
_CLOSURES_FILE = Path(__file__).resolve().parent.parent / "config" / "calendars" / "td_settlement_closures.json"
FUTURE_RULE_FROM_YEAR = 2026


@lru_cache(maxsize=1)
def settlement_closures() -> list[date]:
    data = json.loads(_CLOSURES_FILE.read_text(encoding="utf-8"))
    days = [date.fromisoformat(s) for s in data["inferred"]]
    for y in range(FUTURE_RULE_FROM_YEAR, LAST_YEAR + 1):
        days += [date(y, 12, 24), date(y, 12, 31)]
    return sorted(set(days))


@lru_cache(maxsize=1)
def _settlement_cal() -> np.busdaycalendar:
    # National holidays as in force at each date (20-Nov only from 2024) plus closures.
    national = [d for y in range(FIRST_YEAR, LAST_YEAR + 1) for d in national_holidays(y)
                if not (d.month == 11 and d.day == 20 and y < 2024)]
    hols = np.union1d(np.array(national, dtype="datetime64[D]"), np.array(settlement_closures(), dtype="datetime64[D]"))
    return np.busdaycalendar(weekmask="1111100", holidays=hols)


def settlement_date(base, lag: int):
    """Tesouro Direto settlement: ``lag`` settlement days after ``base``.

    A base date that is itself a non-settlement day (prices are still
    published) rolls back first, so D+1 is the next settlement day.
    """
    if lag == 0:
        return _d64(base)
    return np.busday_offset(_d64(base), lag, roll="backward", busdaycal=_settlement_cal())


def to_date(x) -> date:
    return np.datetime64(x, "D").astype(object)
