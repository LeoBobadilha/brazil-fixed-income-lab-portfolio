import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chart } from "../charts/Chart";
import { axisStyle, dataZoom, grid, legend, lineSeries, row, tooltip } from "../charts/base";
import { familyColor, secName, shortName, useCore } from "../data/core";
import { useHistory } from "../data/load";
import type { DecodedHistory, Security } from "../data/types";
import { parseISO, toISO } from "../engine/dates";
import { cashflowSchedule } from "../engine/instruments";
import { modelPriceAt } from "../engine/pricing";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { ChartCard, DataTable, Field, Loading, Notice, PageHeader, Segmented, Stat } from "../ui/kit";
import { RANGES, rangeStart } from "./common";

const DEFAULT_ID = "NTNBP-20350515";

function rollingVol(h: DecodedHistory, window = 63) {
  const out: (number | null)[] = Array(h.dates.length).fill(null);
  const ch: (number | null)[] = h.buyRate.map((v, i) => (i && v != null && h.buyRate[i - 1] != null ? (v - h.buyRate[i - 1]!) * 100 : null));
  for (let i = window; i < ch.length; i++) {
    const w = ch.slice(i - window + 1, i + 1).filter((x): x is number => x != null);
    if (w.length < window * 0.8) continue;
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    out[i] = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1)) * Math.sqrt(252);
  }
  return out;
}

export default function Explorer() {
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const { securities, byId, latestById, latest } = useCore();
  const f = useFmt();
  const { tokens } = useTheme();
  const [showMatured, setShowMatured] = useState(false);
  const [range, setRange] = useState("all");

  const id = routeId && byId.has(routeId) ? routeId : DEFAULT_ID;
  const sec = byId.get(id)!;
  const lr = latestById.get(id);
  const { data: h, loading } = useHistory(id);
  useEffect(() => { if (!sec.active) setShowMatured(true); }, [sec.active]);

  const products = useMemo(() => [...new Set(securities.map((s) => s.code))], [securities]);
  const maturities = securities.filter((s) => s.code === sec.code && (showMatured || s.active)).sort((a, b) => a.maturity.localeCompare(b.maturity));
  const color = familyColor(tokens, sec);
  const vnaNow = sec.indexer === "selic" ? latest.vna.selic.base.consensus : latest.vna.ipca.base.consensus;

  const i0 = h ? rangeStart(h.dates, RANGES.find((r) => r.key === range)!.years) : 0;
  const slice = <V,>(a: V[]) => a.slice(i0);

  const rateOpt = useMemo(() => h && ({
    grid: grid({ bottom: 36 }), legend: legend(tokens),
    tooltip: { ...tooltip(tokens), formatter: (ps: { seriesName: string; value: [string, number]; color: string }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + ps.map((p) => row(p.color, f.pct(p.value[1]), p.seriesName)).join("") },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${f.num(v, 1)}%` } },
    dataZoom: dataZoom(tokens),
    series: [
      lineSeries(("Purchase rate"), color, slice(h.dates).map((d, i) => [d, h.buyRate[i0 + i]])),
      lineSeries(("Sale rate"), tokens.muted, slice(h.dates).map((d, i) => [d, h.sellRate[i0 + i]]), { lineStyle: { width: 1.5, color: tokens.muted } }),
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [h, i0, tokens, f, color]);

  const priceOpt = useMemo(() => h && ({
    grid: grid({ bottom: 36 }),
    tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, f.brl(ps[0].value[1]), ("sale price (mark-to-market)")) },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
    dataZoom: dataZoom(tokens),
    series: [lineSeries(("Sale price"), color, slice(h.dates).map((d, i) => [d, h.sellPrice[i0 + i]]), { areaStyle: { color, opacity: 0.08 } })],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [h, i0, tokens, f, color]);

  const pyOpt = useMemo(() => {
    if (!h || !sec.modelled || !lr?.sell_rate) return null;
    const pts = h.dates.map((_d, i) => [h.sellRate[i], h.sellPrice[i], i]).filter((p) => p[0] != null && p[1] != null);
    const d0 = parseISO(latest.date);
    const lo = Math.min(...pts.map((p) => p[0] as number)) - 0.5, hi = Math.max(...pts.map((p) => p[0] as number)) + 0.5;
    const curve: number[][] = [];
    for (let r = lo; r <= hi; r += (hi - lo) / 60) curve.push([r, modelPriceAt(sec.code, parseISO(sec.maturity), d0, r, vnaNow ?? 1)]);
    return {
      grid: grid({ top: 36, right: 70 }), legend: legend(tokens),
      tooltip: { ...tooltip(tokens, "item"), formatter: (p: { seriesIndex: number; value: number[] }) => p.seriesIndex === 0
        ? `<div style="opacity:.7;margin-bottom:4px">${f.date(h.dates[p.value[2]])}</div>` + row(tokens.muted, f.brl(p.value[1]), `${("at")} ${f.pct(p.value[0])}`)
        : row(color, f.brl(p.value[1]), `${("model today at")} ${f.pct(p.value[0])}`) },
      xAxis: { type: "value", scale: true, name: ("Sale rate % p.a."), nameLocation: "middle", nameGap: 26, ...axisStyle(tokens) },
      yAxis: { type: "value", scale: true, name: "R$", ...axisStyle(tokens) },
      visualMap: { show: true, dimension: 2, min: 0, max: h.dates.length - 1, seriesIndex: 0, right: 0, top: "middle", itemWidth: 10, itemHeight: 120,
        text: [h.dates[h.dates.length - 1].slice(0, 4), h.dates[0].slice(0, 4)], textStyle: { color: tokens.muted, fontSize: 10 },
        inRange: { color: tokens.mode === "dark" ? ["#104281", "#3987e5", "#cde2fb"] : ["#cde2fb", "#3987e5", "#104281"] } },
      series: [
        { name: ("Observed (history)"), type: "scatter", symbolSize: 4, data: pts, itemStyle: { opacity: 0.6 }, large: true },
        { ...lineSeries(("Cash-flow model today"), color, curve), z: 5 },
      ],
    };
  }, [h, sec, lr, latest.date, vnaNow, tokens, f, color]);

  const durOpt = useMemo(() => h && sec.modelled && ({
    grid: grid({ bottom: 36 }),
    tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, f.num(ps[0].value[1], 2), ("modified duration")) },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens) },
    dataZoom: dataZoom(tokens),
    series: [lineSeries(("Modified duration"), color, slice(h.dates).map((d, i) => [d, h.modified[i0 + i]]))],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [h, i0, sec, tokens, f, color]);

  const vol = useMemo(() => (h ? rollingVol(h) : []), [h]);
  const volOpt = useMemo(() => h && ({
    grid: grid({ bottom: 36 }),
    tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, `${f.num(ps[0].value[1], 0)} bp`, ("annualised vol (63 obs.)")) },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v} bp` } },
    dataZoom: dataZoom(tokens),
    series: [lineSeries(("Volatility"), color, slice(h.dates).map((d, i) => [d, vol[i0 + i]]))],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [h, vol, i0, tokens, f, color]);

  const dist = useMemo(() => {
    if (!h) return null;
    const v = h.buyRate.filter((x): x is number => x != null);
    if (v.length < 30) return null;
    const lo = Math.floor(Math.min(...v) * 4) / 4, hi = Math.ceil(Math.max(...v) * 4) / 4;
    const bins: { x: number; n: number }[] = [];
    for (let b = lo; b < hi; b += 0.25) bins.push({ x: b, n: 0 });
    for (const x of v) bins[Math.min(bins.length - 1, Math.floor((x - lo) / 0.25))].n++;
    return { bins, n: v.length, cur: lr?.buy_rate ?? null };
  }, [h, lr]);

  const distOpt = useMemo(() => dist && ({
    grid: grid(),
    tooltip: { ...tooltip(tokens, "item"), formatter: (p: { value: number[] }) => row(color, `${p.value[1]} ${("days")}`, `${f.num(p.value[0], 2)}–${f.num(p.value[0] + 0.25, 2)}%`) },
    xAxis: { type: "value", min: dist.bins[0].x, max: dist.bins[dist.bins.length - 1].x + 0.25, ...axisStyle(tokens), splitLine: { show: false }, axisLabel: { color: tokens.muted, formatter: (v: number) => `${f.num(v, 1)}%` } },
    yAxis: { type: "value", ...axisStyle(tokens) },
    series: [{
      type: "bar", barWidth: "70%", data: dist.bins.map((b) => [b.x + 0.125, b.n]), itemStyle: { color, borderRadius: [4, 4, 0, 0] },
      markLine: dist.cur != null ? { symbol: "none", silent: true, lineStyle: { color: tokens.ink, width: 1.5 }, label: { formatter: ("today"), color: tokens.ink2 }, data: [{ xAxis: dist.cur }] } : undefined,
    }],
  }), [dist, tokens, f, color]);

  const flows = useMemo(() => {
    if (!sec.modelled) return null;
    const d0 = parseISO(latest.date);
    const v = sec.family === "nominal" ? 1 : (vnaNow ?? 0);
    const per: Record<string, number> = {};
    for (const fl of cashflowSchedule(sec.code, parseISO(sec.maturity))) {
      if (fl.day <= d0) continue;
      const y = toISO(fl.day).slice(0, 4);
      per[y] = (per[y] ?? 0) + (sec.family === "nominal" ? fl.amount : (v * fl.amount) / 100);
    }
    return Object.entries(per).map(([y, a]) => ({ y, a }));
  }, [sec, latest.date, vnaNow]);

  const flowOpt = useMemo(() => flows && ({
    grid: grid(),
    tooltip: { ...tooltip(tokens, "item"), formatter: (p: { name: string; value: number }) => row(color, f.brl(p.value), p.name) },
    xAxis: { type: "category", data: flows.map((x) => x.y), ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
    series: [{ type: "bar", barMaxWidth: 24, data: flows.map((x) => x.a), itemStyle: { color, borderRadius: [4, 4, 0, 0] } }],
  }), [flows, tokens, f, color]);

  const peers = useMemo(() => {
    if (lr?.macaulay == null) return [];
    return [...latestById.values()].filter((r) => r.id !== id && r.macaulay != null && byId.get(r.id)!.family === sec.family && Math.abs(r.macaulay - lr.macaulay!) <= 3)
      .sort((a, b) => Math.abs(a.macaulay! - lr.macaulay!) - Math.abs(b.macaulay! - lr.macaulay!)).slice(0, 6).map((r) => ({ r, s: byId.get(r.id)! }));
  }, [lr, latestById, byId, sec, id]);

  // Facts for explanations and the Q&A panel: computed from the plotted range only.
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
  const facts = useMemo(() => {
    const out: Record<string, string> = { bond: shortName(sec), dataAsOf: f.date(latest.date) };
    if (lr) {
      out.date = f.date(latest.date);
      if (lr.modified != null) out.modified = f.num(lr.modified, 2);
      if (lr.convexity != null) out.convexity = f.num(lr.convexity, 1);
      if (lr.dv01_brl != null) out.dv01 = f.brl(lr.dv01_brl, 3);
      if (lr.percentile.valid && lr.percentile.percentile != null) out.percentile = `${f.num(lr.percentile.percentile, 0)}th`;
    }
    if (h) {
      const idx = h.dates.map((_, i) => i).slice(i0).filter((i) => h.buyRate[i] != null || h.sellRate[i] != null);
      const rate = (i: number) => (h.buyRate[i] ?? h.sellRate[i])!;
      if (idx.length > 1) {
        const a = idx[0], b = idx[idx.length - 1];
        const lo = idx.reduce((m, i) => (rate(i) < rate(m) ? i : m)), hi = idx.reduce((m, i) => (rate(i) > rate(m) ? i : m));
        Object.assign(out, {
          from: f.date(h.dates[a]), to: f.date(h.dates[b]), rateFrom: f.rateLabel(sec.family, rate(a)), rateTo: f.rateLabel(sec.family, rate(b)),
          rateChange: f.bp((rate(b) - rate(a)) * 100), rateLow: `${f.rateLabel(sec.family, rate(lo))} (${f.date(h.dates[lo])})`, rateHigh: `${f.rateLabel(sec.family, rate(hi))} (${f.date(h.dates[hi])})`,
        });
      }
      const pidx = h.dates.map((_, i) => i).slice(i0).filter((i) => h.sellPrice[i] != null);
      if (pidx.length > 1) {
        const a = pidx[0], b = pidx[pidx.length - 1];
        out.priceFrom = f.brl(h.sellPrice[a]); out.priceTo = f.brl(h.sellPrice[b]);
        out.priceChange = f.signedPct((h.sellPrice[b]! / h.sellPrice[a]! - 1) * 100, 1);
      }
      const v = vol.slice(i0).filter((x): x is number => x != null);
      if (v.length) out.volNow = `${f.num(v[v.length - 1], 0)} bp`;
    }
    if (flows?.length) { out.flowYears = String(flows.length); out.flowFirst = flows[0].y; out.flowLast = flows[flows.length - 1].y; }
    return out;
  }, [sec, lr, h, i0, vol, flows, f, latest.date]);
  const askFor = (chart: string) => ({ page: "explorer", chart: `explorer.${chart}`, scope: `${shortName(sec)} · ${rangeLabel}`, facts, product: sec.code });
  const real = sec.family === "real";

  const coverage = h ? { first: h.dates[0], last: h.dates[h.dates.length - 1], n: h.dates.length, buyN: h.buyRate.filter((x) => x != null).length } : null;
  const go = (s: Security) => nav(`/bond/${s.id}`);

  return (
    <div className="space-y-5">
      <PageHeader kicker="Bond explorer" title={secName(sec)}>
        {`${sec.instrument} · identifier ${sec.id} · final maturity ${f.date(sec.maturity)}${sec.conversion ? ` · first instalment ${f.date(sec.conversion)}` : ""}`}
      </PageHeader>

      <div className="card flex flex-wrap items-end gap-4 p-3">
        <Field label="Product" htmlFor="x-prod">
          <select id="x-prod" value={sec.code} onChange={(e) => { const c = securities.filter((s) => s.code === e.target.value && (s.active || showMatured)).sort((a, b) => a.maturity.localeCompare(b.maturity)); if (c.length) go(c[0]); }}>
            {products.map((c) => { const s = securities.find((x) => x.code === c)!; return <option key={c} value={c}>{s.product_en}</option>; })}
          </select>
        </Field>
        <Field label="Security (maturity)" htmlFor="x-mat">
          <select id="x-mat" value={id} onChange={(e) => go(byId.get(e.target.value)!)}>
            {maturities.map((s) => <option key={s.id} value={s.id}>{shortName(s)} · {f.date(s.maturity)}{s.active ? "" : ` (${("matured/not offered")})`}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink2"><input type="checkbox" checked={showMatured} onChange={(e) => setShowMatured(e.target.checked)} /> {"Include matured securities"}</label>
        <div className="ml-auto"><Segmented label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} /></div>
      </div>

      {!sec.modelled && <Notice kind="warn">{"This product is shown with observed data only: there is no second security to validate its updated nominal value."}</Notice>}

      {lr ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Purchase rate" value={lr.buy_offered ? f.rateLabel(sec.family, lr.buy_rate) : "–"} sub={`sale ${f.pct(lr.sell_rate)}`} />
          <Stat label="Purchase price" value={f.brl(lr.buy_price)} sub={`sale ${f.brl(lr.sell_price)}`} />
          <Stat label="Buy/sell spread" value={f.bp(lr.spread_bp)} sub={lr.buy_price && lr.sell_price ? f.signedPct((lr.sell_price / lr.buy_price - 1) * 100) : undefined} />
          <Stat label="Modified duration" value={f.num(lr.modified, 2)} sub={`convexity ${f.num(lr.convexity, 1)}`} />
          <Stat label="DV01 per unit" value={f.brl(lr.dv01_brl, 3)} sub={"per 1 bp"} />
          <Stat label="Rate percentile" value={lr.percentile.valid ? f.num(lr.percentile.percentile, 0) : "n/a"}
            sub={`${lr.percentile.observations} obs. since ${f.date(lr.percentile.start)}`} />
        </div>
      ) : <Notice>{"Security no longer offered: showing history only."}</Notice>}

      {loading && !h ? <Loading /> : h && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard basis="observed" title="Rate history" subtitle="Official Tesouro Direto purchase and sale rates (morning)"
              ask={askFor("rates")}
              explain={{
                shows: `The ${real ? "real yield (paid on top of IPCA)" : sec.indexer === "selic" ? "spread over the Selic rate" : "annual yield"} at which Tesouro Direto offered to sell (purchase rate) and to buy back (sale rate) ${shortName(sec)} each morning. Source: Tesouro Transparente.`,
                read: "Higher points mean a higher yield for a new buyer and, for existing holders, a lower price. The gap between the two lines is the buy/sell spread, a cost of trading.",
                now: facts.rateFrom ? `From ${facts.from} to ${facts.to}, the rate moved from ${facts.rateFrom} to ${facts.rateTo} (${facts.rateChange}). Range low ${facts.rateLow}; high ${facts.rateHigh}.` : undefined,
                why: "The rate locked in at purchase is what a holder earns if the bond is held to maturity; later changes in the rate drive the mark-to-market value before then.",
                limits: "Rates are a morning quote and do not show intraday moves. Days when the bond was not offered for purchase have only a sale rate. Past rate levels do not predict future ones.",
              }}>
              <Chart option={rateOpt!} height={300} label={("Rate history")} testId="rate-history" />
            </ChartCard>
            <ChartCard basis="observed" title="Price history" subtitle="Unit sale price: the mark-to-market value of one security"
              ask={askFor("price")}
              explain={{
                shows: `What Tesouro Direto paid to buy back one unit of ${shortName(sec)} on each date, the value a holder would have received by selling.`,
                read: real || sec.indexer === "selic" ? "The price combines two effects: the updated nominal value (VNA) grows with IPCA or Selic, and the price moves opposite to the rate. A rising line can still hide a mark-to-market loss in real terms." : "For a fixed-rate bond the price rises towards R$ 1,000 at maturity (pull to par) and falls whenever yields rise.",
                now: facts.priceFrom ? `From ${facts.from} to ${facts.to} the sale price went from ${facts.priceFrom} to ${facts.priceTo} (${facts.priceChange}), before custody and income tax.` : undefined,
                why: "This is the realised mark-to-market path: the value an investor could actually have obtained on each date.",
                limits: "Prices are per unit and gross of custody and taxes. Coupons paid along the way are not included, so for coupon bonds the price path understates the total return.",
              }}>
              <Chart option={priceOpt!} height={300} label={("Price history")} />
            </ChartCard>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {pyOpt && (
              <ChartCard basis="theoretical" title="Price–yield relationship"
                subtitle="Dots: historical observations (colour = date). Line: today's theoretical price from cash flows."
                note="Older dots do not sit on today's curve because time to maturity and the updated nominal value have changed. That is why a historical rate–price regression is not a pricing model."
                ask={askFor("price-yield")}
                explain={{
                  shows: "Each dot is an observed (sale rate, sale price) pair from the bond's history; the line is the price today's cash-flow model gives for each possible yield.",
                  read: "The line slopes down: higher yield, lower price. Its curvature is convexity. Where today's observed point sits on the line shows the current price for the current rate.",
                  now: facts.modified ? `Today ${shortName(sec)} has modified duration ${facts.modified} and convexity ${facts.convexity ?? "n/a"}: +100 bp would lower the price by roughly ${facts.modified}% before convexity.` : undefined,
                  why: "It shows why the same rate change moves long bonds much more than short ones, and why the relation is not a straight line.",
                  limits: "The theoretical line holds time and VNA fixed at today's values; it does not describe historical prices or future paths.",
                }}>
                <Chart option={pyOpt} height={300} label={("Price–yield relationship")} />
              </ChartCard>
            )}
            {durOpt && (
              <ChartCard basis="theoretical" title="Duration over time" subtitle="Modified duration at the purchase rate (years, du/252 basis)"
                ask={askFor("duration")}
                explain={{
                  shows: "Modified duration computed each day from the bond's remaining cash flows and that day's purchase rate.",
                  read: "Duration approximates the percentage price change for a 1-percentage-point yield move. It falls as the bond approaches maturity and jumps after coupons are paid.",
                  now: facts.modified ? `Current modified duration: ${facts.modified}.` : undefined,
                  why: "It summarises interest-rate risk in one number and lets bonds of different maturities be compared.",
                  limits: "A first-order approximation; it understates gains and overstates losses for large moves (convexity), and assumes a parallel yield shift.",
                }}>
                <Chart option={durOpt} height={300} label={("Duration over time")} />
              </ChartCard>
            )}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <ChartCard basis="statistical" title="Historical rate distribution"
              subtitle={dist ? `${dist.n} purchase-rate observations` : undefined}
              ask={askFor("distribution")}
              explain={{
                shows: "How often each purchase-rate level (in 0.25-point bins) occurred over the bond's full history. The vertical line marks today's rate.",
                read: "A line far to the right means today's yield is high relative to this bond's own past.",
                now: facts.percentile ? `Today's rate is at the ${facts.percentile} percentile of the history.` : undefined,
                why: "It puts today's rate in historical context.",
                limits: "The distribution covers only this bond's own life, which may be short and may not include today's economic conditions. A high percentile is not a buy signal and does not mean yields will fall.",
              }}>
              {distOpt ? <Chart option={distOpt} height={260} label={("Rate distribution")} /> : <p className="text-muted">n/a</p>}
            </ChartCard>
            <ChartCard basis="statistical" title="Rate volatility" subtitle="Annualised std. dev. of daily changes, 63-observation window"
              ask={askFor("volatility")}
              explain={{
                shows: "The annualised standard deviation of daily rate changes over a rolling window of about three months, in basis points.",
                read: "Higher values mean the rate, and therefore the price, has been moving more from day to day.",
                now: facts.volNow ? `Latest value: ${facts.volNow} a year.` : undefined,
                why: "Combined with duration, rate volatility indicates how large mark-to-market swings can be.",
                limits: "Backward-looking; volatility clusters and can change abruptly.",
              }}>
              {volOpt && <Chart option={volOpt} height={260} label={("Volatility")} />}
            </ChartCard>
            {flowOpt && (
              <ChartCard basis="theoretical" title="Cash flows per year"
                subtitle={sec.family === "real" ? "Per unit, in today's reais (current VNA, no future inflation)" : "Per unit, nominal amounts"}
                ask={askFor("cashflows")}
                explain={{
                  shows: `The contractual payments one unit of ${shortName(sec)} makes in each remaining year: coupons, instalments and principal.`,
                  read: real ? "IPCA-linked amounts are shown at today's VNA, i.e. in today's purchasing power; actual reais paid will be higher by the inflation that occurs." : "Fixed-rate amounts are the exact nominal reais paid.",
                  now: facts.flowYears ? `Payments fall in ${facts.flowYears} calendar years, from ${facts.flowFirst} to ${facts.flowLast}.` : undefined,
                  why: "The timing of cash flows determines duration and how sensitive the price is to rates.",
                  limits: "Gross of income tax and custody. Assumes the issuer pays as scheduled.",
                }}>
                <Chart option={flowOpt} height={260} label={("Cash flows")} />
              </ChartCard>
            )}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard basis="observed" title="Similar-duration securities" subtitle="Same rate family, duration ± 3 years"
              explain={{
                shows: `Other ${sec.family === "real" ? "IPCA-linked" : sec.family === "nominal" ? "fixed-rate" : "Selic-linked"} securities on offer whose Macaulay duration is within 3 years of ${shortName(sec)}, with their latest purchase rate and the difference from this bond.`,
                read: "A positive difference means the other bond offers a higher yield for a similar interest-rate exposure.",
                now: peers.length ? `${peers.length} comparable securities; the closest in duration is ${shortName(peers[0].s)}.` : "No other security has a similar duration today.",
                why: "Comparing bonds with similar duration separates differences in yield from differences in rate risk.",
                limits: "Similar duration does not mean identical cash flows: coupons, instalments and liquidity differ, and small yield differences are normal.",
              }}>
              <DataTable caption="Peers" rowKey={(x) => x.r.id} rows={peers} onRowClick={(x) => go(x.s)}
                columns={[{ key: "n", label: "Bond", render: ({ s }) => shortName(s) },
                  { key: "d", label: "Duration", num: true, render: ({ r }) => f.num(r.macaulay, 2) },
                  { key: "r", label: "Rate", num: true, render: ({ r }) => f.pct(r.buy_rate ?? r.sell_rate) },
                  { key: "x", label: "Difference", num: true, render: ({ r }) => f.bp(((r.buy_rate ?? r.sell_rate ?? 0) - (lr?.buy_rate ?? lr?.sell_rate ?? 0)) * 100) }]} />
            </ChartCard>
            {coverage && (
              <ChartCard title="Data coverage"
                note="Days quoted counts every date with an official sale price; days offered for purchase are those on which Tesouro Direto also sold the bond. Gaps are dates on which the bond was not quoted.">
                <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                  <dt className="text-muted">{"First observation"}</dt><dd className="tnum">{f.date(coverage.first)}</dd>
                  <dt className="text-muted">{"Last observation"}</dt><dd className="tnum">{f.date(coverage.last)}</dd>
                  <dt className="text-muted">{"Days quoted"}</dt><dd className="tnum">{coverage.n}</dd>
                  <dt className="text-muted">{"Days offered for purchase"}</dt><dd className="tnum">{coverage.buyN}</dd>
                  <dt className="text-muted">{"Days to maturity"}</dt><dd className="tnum">{lr ? lr.days_to_maturity : "–"}</dd>
                  {sec.conversion && <><dt className="text-muted">{"Days to conversion"}</dt><dd className="tnum">{lr?.days_to_conversion ?? "–"}</dd></>}
                </dl>
              </ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
