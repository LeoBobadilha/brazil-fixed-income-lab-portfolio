"""Truncation and rounding exactly as specified by Tesouro Nacional.

Floating-point values such as 0.416666 * 1e6 may be represented as
416665.99999999994; a tiny relative guard prevents those from being truncated
one unit too low. The guard (1e-12 relative) is far below every published
precision (at most 16 decimal places on numbers of order 1).
"""

from __future__ import annotations

import numpy as np

_GUARD = 1e-12


def trunc(x, decimals: int):
    """Truncate toward zero at ``decimals`` places (Excel TRUNCAR)."""
    x = np.asarray(x, dtype=float)
    scale = 10.0**decimals
    scaled = x * scale
    guarded = scaled + np.sign(scaled) * np.abs(scaled) * _GUARD
    out = np.trunc(guarded) / scale
    return out.item() if out.ndim == 0 else out


def round_half_up(x, decimals: int):
    """Round half away from zero (financial rounding, not banker's)."""
    x = np.asarray(x, dtype=float)
    scale = 10.0**decimals
    scaled = np.abs(x) * scale
    out = np.sign(x) * np.floor(scaled + 0.5 + scaled * _GUARD) / scale
    return out.item() if out.ndim == 0 else out
