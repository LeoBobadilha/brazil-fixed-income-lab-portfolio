"""Calendar-window study of IPCA+ purchase rates (legacy script, rebuilt).

An earlier version of this study compared each day's rate with the
same month's average and highlighted days 11-14. That metric uses future
information within the month and counted correlated bonds as independent
observations. This version reports the legacy metric for transparency and the
corrected tests (see src/research/calendar_effects.py and docs/audit.md).

    python -m src.analysisbyday
"""

from __future__ import annotations

import duckdb

from src.config import DUCKDB_PATH
from src.research import calendar_effects


def load_quotes():
    with duckdb.connect(str(DUCKDB_PATH), read_only=True) as con:
        return con.execute("SELECT * FROM fact_quotes").df()


def main() -> None:
    res = calendar_effects.run(load_quotes())
    w = res["windows"]
    print(f"Universe: {res['universe']}\nPeriod: {w['start']} to {w['end']} ({w['n_days']} trading days)\n")
    print(f"{'window':<8}{'days':>6}{'mean bp':>10}{'vs rest bp':>12}{'p (Holm)':>10}{'p perm':>9}")
    for r in w["rows"]:
        print(f"{r['window']:<8}{r['days']:>6}{r['mean_change_bp']:>10.3f}{r['diff_vs_rest_bp']:>12.3f}{r['p_holm']:>10.3f}{r['p_perm']:>9.3f}")
    print("\nLegacy metric (deviation from same-month mean, look-ahead, descriptive only):")
    for r in res["legacy_metric"]["rows"]:
        print(f"  {r['window']}: {r['mean_deviation_bp']:+.2f} bp over {r['days']} days")


if __name__ == "__main__":
    main()
