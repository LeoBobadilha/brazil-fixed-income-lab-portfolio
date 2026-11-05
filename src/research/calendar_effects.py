"""Calendar / business-day timing study (successor of analysisbyday.py and bestmonthlywindow.py).

Question inherited from the legacy research: are IPCA+ purchase rates
systematically higher in some part of the month (e.g. days 11-14), which
would make that window a better time to buy?

Design choices that differ from the legacy scripts:
* Daily rate changes are averaged across securities on each date first, so
  highly correlated bonds are not counted as independent evidence.
* The outcome is the change from the previous observation (known at the time),
  not the deviation from the same month's average (which uses future days).
* Windows are compared with Welch t-tests and a permutation test, and p-values
  are Holm-adjusted for the number of windows tested.
* The "best window" is chosen on the first half of the sample and re-tested on
  the second half (out-of-sample), to guard against data snooping.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from math import erf, sqrt

WINDOWS = [(1, 5, "01-05"), (6, 10, "06-10"), (11, 14, "11-14"), (15, 20, "15-20"), (21, 27, "21-27"), (28, 31, "28-31")]


def _window(day: int) -> str:
    for lo, hi, lab in WINDOWS:
        if lo <= day <= hi:
            return lab
    return "?"


def _p_two_sided_normal(t: float) -> float:
    return 2 * (1 - 0.5 * (1 + erf(abs(t) / sqrt(2))))


def welch(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b)
    t = (a.mean() - b.mean()) / np.sqrt(va + vb)
    return float(t), _p_two_sided_normal(t)  # large samples: normal approximation


def permutation_p(a: np.ndarray, b: np.ndarray, n: int = 2000, seed: int = 7) -> float:
    rng = np.random.default_rng(seed)
    obs = abs(a.mean() - b.mean())
    pooled = np.concatenate([a, b])
    hits = 0
    for _ in range(n):
        rng.shuffle(pooled)
        hits += abs(pooled[: len(a)].mean() - pooled[len(a):].mean()) >= obs
    return (hits + 1) / (n + 1)


def holm(pvals: list[float]) -> list[float]:
    order = np.argsort(pvals)
    m = len(pvals)
    adj = np.empty(m)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, (m - rank) * pvals[i])
        adj[i] = min(1.0, running)
    return list(adj)


def daily_index(quotes: pd.DataFrame, codes=("NTNBP", "NTNB"), min_years: float = 0.0) -> pd.DataFrame:
    """Cross-sectional mean daily change (bp) of purchase rates for a product set."""
    q = quotes[quotes["product_code"].isin(codes)].dropna(subset=["buy_rate"]).sort_values(["security_id", "base_date"])
    if min_years:
        q = q[(q["maturity_date"] - q["base_date"]).dt.days / 365.25 >= min_years]
    q = q.assign(chg_bp=q.groupby("security_id")["buy_rate"].diff() * 100)
    # Ignore changes across gaps longer than 5 calendar days (missing data)
    gap = q.groupby("security_id")["base_date"].diff().dt.days
    q = q[(gap <= 5)]
    d = q.groupby("base_date").agg(chg_bp=("chg_bp", "mean"), n_securities=("chg_bp", "size")).reset_index()
    d["day"] = d["base_date"].dt.day
    d["window"] = d["day"].map(_window)
    ym = d["base_date"].dt.to_period("M")
    d["bd_from_start"] = d.groupby(ym).cumcount() + 1
    d["bd_from_end"] = d.groupby(ym)["base_date"].transform("size") - d["bd_from_start"] + 1
    return d


def window_study(d: pd.DataFrame) -> dict:
    res = []
    for _, _, lab in WINDOWS:
        a = d.loc[d["window"] == lab, "chg_bp"].values
        b = d.loc[d["window"] != lab, "chg_bp"].values
        t, p = welch(a, b)
        res.append({"window": lab, "days": int(len(a)), "mean_change_bp": float(a.mean()), "std_bp": float(a.std(ddof=1)),
                    "diff_vs_rest_bp": float(a.mean() - b.mean()), "t_stat": t, "p_value": p,
                    "p_perm": permutation_p(a, b)})
    adj = holm([r["p_value"] for r in res])
    for r, pa in zip(res, adj):
        r["p_holm"] = pa
        r["significant_5pct"] = pa < 0.05
    return {"rows": res, "start": str(d["base_date"].min().date()), "end": str(d["base_date"].max().date()),
            "n_days": int(len(d))}


def out_of_sample(d: pd.DataFrame) -> dict:
    """Pick the window with the highest mean rate change in-sample; test it OOS.

    A higher rate change before buying is irrelevant per se; the legacy idea was
    "rates are higher in window X". Here we test the analogous level effect:
    within-month rate level relative to the previous month-end (no look-ahead).
    """
    mid = d["base_date"].iloc[len(d) // 2]
    first, second = d[d["base_date"] < mid], d[d["base_date"] >= mid]
    means = first.groupby("window")["level_vs_prev_month_end_bp"].mean()
    best = means.idxmax()
    a = second.loc[second["window"] == best, "level_vs_prev_month_end_bp"].values
    b = second.loc[second["window"] != best, "level_vs_prev_month_end_bp"].values
    t, p = welch(a, b)
    return {"split_date": str(mid.date()), "in_sample_best_window": best,
            "in_sample_means_bp": {k: float(v) for k, v in means.items()},
            "oos_diff_vs_rest_bp": float(a.mean() - b.mean()), "oos_t": t, "oos_p": p,
            "oos_supported": bool(p < 0.05 and a.mean() > b.mean())}


def add_level_vs_prev_month_end(d: pd.DataFrame, quotes: pd.DataFrame, codes=("NTNBP", "NTNB")) -> pd.DataFrame:
    """Rate level on each day minus the same securities' rate at the previous month-end (bp)."""
    q = quotes[quotes["product_code"].isin(codes)].dropna(subset=["buy_rate"])
    q = q.assign(ym=q["base_date"].dt.to_period("M"))
    me = q.sort_values("base_date").groupby(["security_id", "ym"])["buy_rate"].last().rename("me_rate").reset_index()
    me["ym"] = me["ym"] + 1  # previous month-end becomes the reference for next month
    q = q.merge(me, on=["security_id", "ym"], how="inner")
    lv = q.assign(dev=(q["buy_rate"] - q["me_rate"]) * 100).groupby("base_date")["dev"].mean()
    return d.merge(lv.rename("level_vs_prev_month_end_bp"), left_on="base_date", right_index=True, how="left")


def legacy_within_month_deviation(quotes: pd.DataFrame, codes=("NTNBP", "NTNB")) -> dict:
    """Legacy metric reproduced for transparency: deviation from same-month mean.

    Uses the whole month's average, i.e. information not available on the day.
    Reported as descriptive only.
    """
    q = quotes[quotes["product_code"].isin(codes)].dropna(subset=["buy_rate"])
    q = q.assign(ym=q["base_date"].dt.to_period("M"))
    q = q.assign(dev=(q["buy_rate"] - q.groupby(["security_id", "ym"])["buy_rate"].transform("mean")) * 100)
    per_day = q.groupby("base_date")["dev"].mean().reset_index()
    per_day["window"] = per_day["base_date"].dt.day.map(_window)
    g = per_day.groupby("window")["dev"].agg(["mean", "count"]).reindex([w[2] for w in WINDOWS])
    return {"rows": [{"window": k, "mean_deviation_bp": float(r["mean"]), "days": int(r["count"])} for k, r in g.iterrows()],
            "caveat": "Look-ahead: compares each day with the full month's average."}


def run(quotes: pd.DataFrame) -> dict:
    d = daily_index(quotes)
    d = add_level_vs_prev_month_end(d, quotes).dropna(subset=["chg_bp"])
    edge = []
    for col in ("bd_from_start", "bd_from_end"):
        for k in range(1, 6):
            a = d.loc[d[col] == k, "chg_bp"].values
            edge.append({"position": f"{'first' if col == 'bd_from_start' else 'last'}_{k}", "days": int(len(a)),
                         "mean_change_bp": float(a.mean())})
    return {
        "universe": "Tesouro IPCA+ and IPCA+ with semiannual coupons (cross-sectional mean of daily purchase-rate changes)",
        "windows": window_study(d),
        "out_of_sample": out_of_sample(d.dropna(subset=["level_vs_prev_month_end_bp"])),
        "business_day_edges": edge,
        "legacy_metric": legacy_within_month_deviation(quotes),
    }
