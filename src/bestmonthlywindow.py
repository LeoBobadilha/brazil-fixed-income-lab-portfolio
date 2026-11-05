"""Best purchase window within the month (legacy script, rebuilt with an out-of-sample test).

The legacy script ranked business days by historical purchase rate and
reported the "best" day. Choosing the best of many windows on the full sample
is data snooping, so the window is selected on the first half of the history
and tested on the second half.

    python -m src.bestmonthlywindow
"""

from __future__ import annotations

from src.analysisbyday import load_quotes
from src.research import calendar_effects


def main() -> None:
    res = calendar_effects.run(load_quotes())
    oos = res["out_of_sample"]
    print(f"Split date: {oos['split_date']}")
    print(f"In-sample best window (highest rate vs previous month-end): {oos['in_sample_best_window']}")
    print(f"Out-of-sample difference vs other windows: {oos['oos_diff_vs_rest_bp']:+.2f} bp (t={oos['oos_t']:.2f}, p={oos['oos_p']:.3f})")
    print("Supported out of sample." if oos["oos_supported"] else "Not supported out of sample: treat as noise.")
    print("\nFirst/last business days (mean daily change, bp):")
    for r in res["business_day_edges"]:
        print(f"  {r['position']:<8} {r['mean_change_bp']:+.3f} ({r['days']} days)")


if __name__ == "__main__":
    main()
