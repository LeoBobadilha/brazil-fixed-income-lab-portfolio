"""Infer Tesouro Direto non-settlement days from official purchase prices.

Output feeds config/calendars/td_settlement_closures.json (see docs/methodology.md).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import numpy as np, pandas as pd
from src import calendar_br
from src.pricing.instruments import product_for, cashflow_schedule
from src.pricing.batch import du_matrix
from src.pricing.rounding import trunc
df = pd.read_csv(ROOT / "data" / "raw" / "tesouro_direto_prices.csv", sep=";", encoding="latin1", decimal=",")
df.columns = ["tipo","venc","base","tc","tv","puc","puv","pub"]
df["venc"] = pd.to_datetime(df.venc, format="%d/%m/%Y"); df["base"] = pd.to_datetime(df.base, format="%d/%m/%Y")
sub = df[df.tipo.isin(["Tesouro Prefixado","Tesouro Prefixado com Juros Semestrais"])].dropna(subset=["tc","puc"])
def quote(p, venc, base, rate, settle):
    from src.pricing.engine import _PV_ROUND
    fd = np.array([d for d,_,_ in cashflow_schedule(p, venc)], dtype="datetime64[D]"); amt = np.array([a for _,a,_ in cashflow_schedule(p, venc)])
    du = du_matrix(settle, base, fd); alive = (fd[None,:] > settle[:,None]) & (du>0)
    disc = (1+trunc(rate,6)[:,None]/100) ** trunc(du/252,14); pv = np.where(alive, amt[None,:]/disc, 0)
    if p.code == "NTNF": pv = np.where(alive, np.round(pv, 9), 0)
    return trunc(trunc(pv.sum(1), 6), 2)
res = []
cal = calendar_br._busdaycal(True)
for (tipo, venc), g in sub.groupby(["tipo","venc"]):
    p = product_for(tipo); base = g.base.values.astype("datetime64[D]")
    s1 = np.busday_offset(base, 1, roll="backward", busdaycal=cal)
    s2 = np.busday_offset(base, 2, roll="backward", busdaycal=cal)
    q1 = quote(p, venc.date(), base, g.tc.values, s1); q2 = quote(p, venc.date(), base, g.tc.values, s2)
    res.append(pd.DataFrame({"base": base, "s1": s1, "ok1": np.abs(q1-g.puc.values)<0.005, "ok2": np.abs(q2-g.puc.values)<0.005}))
r = pd.concat(res)
by = r.groupby(["base","s1"]).agg(n=("ok1","size"), ok1=("ok1","mean"), ok2=("ok2","mean")).reset_index()
clos = by[(by.ok1 < 0.5) & (by.ok2 > 0.9)]
print("inferred non-settlement days:", len(clos))
print(", ".join(str(x)[:10] for x in clos.s1))
rest = by[(by.ok1 < 1) & ~by.base.isin(clos.base)]
print("other dates with mismatches:", len(rest), "rows", int(((1-rest.ok1)*rest.n).sum()))
print(rest.head(40).to_string())
