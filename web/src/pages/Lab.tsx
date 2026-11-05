import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Chart } from "../charts/Chart";
import { axisStyle, grid, legend, lineSeries, row, tooltip } from "../charts/base";
import { familyColor, shortName, useCore } from "../data/core";
import { useData, useHistory, vnaOn } from "../data/load";
import type { Macro, VnaHistory } from "../data/types";
import { parseISO, toISO } from "../engine/dates";
import { GridMetric, horizonsFor, scenarioGrid } from "../engine/grid";
import { NTNB_COUPON, NTNF_COUPON, cashflowSchedule } from "../engine/instruments";
import { modelPriceAt, officialPrice, risk } from "../engine/pricing";
import { ScenarioInput, runScenario } from "../engine/scenario";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { Term } from "../ui/explain";
import { ChartCard, DataTable, Field, Notice, PageHeader, Segmented, Slider, Stat } from "../ui/kit";
import { Assume, defaultAssume, downloadText, publicDefaultsAt, scenarioCsv } from "./scenarioBase";

const Surface3D = lazy(() => import("../three/Surface3D"));
const TABLE_SHOCKS = [-200, -100, -50, 0, 50, 100, 200];

function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export default function Lab() {
  const { securities, byId, latest, assumptions, manifest } = useCore();
  const macro = useData<Macro>("macro.json");
  const vnaHist = useData<VnaHistory>("vna_history.json");
  const f = useFmt();
  const { tokens, reducedMotion } = useTheme();

  // Instruments: every modelled security; active ones first.
  const candidates = useMemo(() => securities.filter((s) => s.modelled).sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code) || a.maturity.localeCompare(b.maturity)), [securities]);
  const [id, setId] = useState(() => candidates.find((s) => s.id === "NTNBP-20350515")?.id ?? candidates[0].id);
  const sec = byId.get(id)!;
  const color = familyColor(tokens, sec);
  const { data: h } = useHistory(id);

  // ---- Reference date: only dates with an observed purchase quote and, for indexed bonds, a price-implied VNA.
  const validIdx = useMemo(() => {
    if (!h) return [] as number[];
    return h.dates.map((_, i) => i).filter((i) => h.buyPrice[i] != null && h.buyRate[i] != null && h.sellRate[i] != null
      && (sec.indexer === "pre" || (vnaHist.data != null && vnaOn(vnaHist.data, sec.indexer as "ipca" | "selic", h.dates[i]) != null)));
  }, [h, sec, vnaHist.data]);
  const [refIdx, setRefIdx] = useState<number | null>(null);
  useEffect(() => setRefIdx(null), [id]);
  const ri = refIdx != null && validIdx.includes(refIdx) ? refIdx : validIdx[validIdx.length - 1];
  const ready = h != null && h.id === id && ri != null; // never mix one bond's history with another
  const refDate = ready ? h!.dates[ri] : latest.date;
  const isLatest = refDate === latest.date;
  const d0 = parseISO(refDate);
  const ref = ready ? {
    buyPrice: h!.buyPrice[ri]!, buyRate: h!.buyRate[ri]!, sellRate: h!.sellRate[ri]!,
    vna: sec.indexer === "pre" ? null : vnaOn(vnaHist.data!, sec.indexer as "ipca" | "selic", refDate),
  } : null;

  // Default assumptions come from public data available on the reference date.
  const defaults = useMemo(() => publicDefaultsAt(macro.data ?? null, refDate), [macro.data, refDate]);
  const [a, setA] = useState<Assume | null>(null);
  const A: Assume = a ?? defaultAssume(defaults.ipca, defaults.selic);
  const set = (p: Partial<Assume>) => setA({ ...A, ...p });
  const [metric, setMetric] = useState<GridMetric>("netReturnPaPct");
  const [show3d, setShow3d] = useState(false);

  const yearsLeft = (parseISO(sec.maturity) - d0) / 365.25;
  const input: ScenarioInput | null = ref ? {
    code: sec.code, maturity: parseISO(sec.maturity), valuationDate: d0, buyPrice: ref.buyPrice, buyRate: ref.buyRate, sellRate: ref.sellRate, vna0: ref.vna, ...A,
  } : null;
  const result = useMemo(() => (input ? runScenario(input, assumptions) : null), [JSON.stringify(input), assumptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const altTax = useMemo(() => (input && A.applyTaxes ? runScenario({ ...input, custodyDeductible: !A.custodyDeductible }, assumptions) : null), [JSON.stringify(input), assumptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const rk = useMemo(() => (ref ? risk(sec.code, parseISO(sec.maturity), d0, ref.buyRate) : null), [sec, refDate, ref?.buyRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 1. Observed mark-to-market from the reference date to the latest observation.
  const observed = useMemo(() => {
    if (!h || !ready) return null;
    const i0 = ri;
    const units = A.amount / h.buyPrice[i0]!;
    const maturity = parseISO(sec.maturity);
    // Coupons/instalments received after purchase. NTN-F coupons are fixed; for IPCA-linked bonds
    // the coupon uses the VNA implied by that day's official price.
    const flows = cashflowSchedule(sec.code, maturity).filter((x) => x.day > parseISO(h.dates[i0]) && x.day <= parseISO(h.dates[h.dates.length - 1]));
    const paid: { date: string; cash: number; estimated: boolean }[] = [];
    for (const fl of flows) {
      const j = h.dates.findIndex((d) => parseISO(d) >= fl.day);
      if (j < 0) continue;
      if (sec.code === "NTNF") paid.push({ date: h.dates[j], cash: units * NTNF_COUPON, estimated: false });
      else if (sec.family === "real" && h.sellRate[j] != null && h.sellPrice[j] != null) {
        const cot = officialPrice(sec.code, maturity, parseISO(h.dates[j]), h.sellRate[j]!).cotacao;
        if (cot) paid.push({ date: h.dates[j], cash: (units * (h.sellPrice[j]! / (cot / 100)) * (sec.code === "NTNB" ? NTNB_COUPON : fl.amount)) / 100, estimated: true });
      }
    }
    let cum = 0, k = 0;
    const path = h.dates.slice(i0).map((d, n) => {
      while (k < paid.length && paid[k].date <= d) cum += paid[k++].cash;
      const sp = h.sellPrice[i0 + n];
      return [d, sp == null ? null : units * sp + cum] as [string, number | null];
    });
    const lastPoint = [...path].reverse().find((p) => p[1] != null);
    let peak = -Infinity, mdd = 0;
    for (const [, v] of path) if (v != null) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
    return { path, last: lastPoint ? (lastPoint[1] as number) : null, lastDate: lastPoint?.[0] ?? null, mdd, couponsEstimated: paid.some((p) => p.estimated), days: parseISO(h.dates[h.dates.length - 1]) - d0 };
  }, [h, ready, ri, A.amount, sec, d0]);

  const observedAtHorizon = useMemo(() => {
    if (!observed || !result) return null;
    const target = toISO(result.horizonDate);
    if (target > latest.date) return null;
    const p = observed.path.find((x) => x[0] >= target && x[1] != null);
    return p ? { date: p[0], value: p[1] as number } : null;
  }, [observed, result, latest.date]);

  const obsOpt = useMemo(() => observed && ({
    grid: grid({ top: 24 }), legend: legend(tokens, false),
    tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, f.brl(ps[0].value[1]), "sale value + flows received") },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
    series: [lineSeries("Observed value", color, observed.path, {
      markLine: { symbol: "none", silent: true, lineStyle: { color: tokens.muted, width: 1 }, label: { color: tokens.muted, position: "insideStartTop", formatter: "amount invested" }, data: [{ yAxis: A.amount }] },
    })],
  }), [observed, tokens, f, color, A.amount]);

  // ---- 2. Theoretical instant repricing on the reference date.
  const theo = useMemo(() => {
    if (!ref || !rk) return null;
    const m = parseISO(sec.maturity);
    const p0 = modelPriceAt(sec.code, m, d0, ref.buyRate, 1);
    const pts = [] as { s: number; exact: number; dur: number; dc: number }[];
    for (let s = -300; s <= 300; s += 10) {
      const dy = s / 1e4;
      pts.push({ s, exact: (modelPriceAt(sec.code, m, d0, ref.buyRate + s / 100, 1) / p0 - 1) * 100, dur: -rk.modified * dy * 100, dc: (-rk.modified * dy + 0.5 * rk.convexity * dy * dy) * 100 });
    }
    return { pts };
  }, [sec, refDate, ref?.buyRate, rk]); // eslint-disable-line react-hooks/exhaustive-deps

  const theoOpt = useMemo(() => theo && ({
    grid: grid({ top: 36 }), legend: legend(tokens),
    tooltip: { ...tooltip(tokens), formatter: (ps: { seriesName: string; value: number[]; color: string }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.bp(ps[0].value[0])}</div>` + ps.map((p) => row(p.color, f.signedPct(p.value[1]), p.seriesName)).join("") },
    xAxis: { type: "value", min: -300, max: 300, name: "Yield shock (bp)", nameLocation: "middle", nameGap: 26, ...axisStyle(tokens) },
    yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v}%` } },
    series: [
      lineSeries("Exact repricing", color, theo.pts.map((p) => [p.s, p.exact])),
      lineSeries("Duration approximation", tokens.muted, theo.pts.map((p) => [p.s, p.dur]), { lineStyle: { width: 1.5, color: tokens.muted } }),
      lineSeries("Duration + convexity", tokens.ink2, theo.pts.map((p) => [p.s, p.dc]), { lineStyle: { width: 1, color: tokens.ink2, type: [4, 3] } }),
    ],
  }), [theo, tokens, f, color]);

  // ---- 3. Hypothetical scenarios.
  const horizons = useMemo(() => horizonsFor(Math.max(yearsLeft, 0.3)), [yearsLeft]);
  const g = useMemo(() => (input ? scenarioGrid({ ...input }, assumptions, metric, horizons) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sec.id, refDate, ref?.buyPrice, A.amount, A.inflationPa, A.selicPa, A.reinvestPa, A.applyCosts, A.applyTaxes, A.custodyDeductible, metric, horizons, assumptions]);
  // Clip the diverging scale at the 90th percentile of |value| so a few extreme short-horizon annualised
  // cells do not wash out the rest (values stay exact in tooltip/table). The 3D surface uses the same limit.
  const lim = useMemo(() => {
    if (!g) return 1;
    const absSorted = g.values.flat().filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
    return Math.max(1, absSorted[Math.floor(absSorted.length * 0.9)] ?? 1);
  }, [g]);
  const heatOpt = useMemo(() => {
    if (!g) return null;
    const data: number[][] = [];
    g.values.forEach((r, i) => r.forEach((v, j) => data.push([j, i, Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN])));
    const unit = metric === "netValue" ? "" : "%";
    return {
      grid: grid({ top: 16, bottom: 56, right: 16 }),
      tooltip: { ...tooltip(tokens, "item"), formatter: (p: { value: number[] }) => `<div style="opacity:.7;margin-bottom:4px">${f.bp(g.shocks[p.value[0]])} · ${f.num(g.horizons[p.value[1]], 2)} years${g.held[p.value[1]] ? " (to maturity)" : ""}</div>` + row(tokens.ink, metric === "netValue" ? f.brl(p.value[2]) : f.pct(p.value[2]), "result") },
      xAxis: { type: "category", data: g.shocks.map((s) => (s > 0 ? `+${s}` : `${s}`)), name: "Exit-yield shock (bp)", nameLocation: "middle", nameGap: 30, ...axisStyle(tokens), splitLine: { show: false }, axisLabel: { color: tokens.muted, interval: 3 } },
      yAxis: { type: "category", data: g.horizons.map((x) => f.num(x, 2)), name: "Horizon (years)", ...axisStyle(tokens), splitLine: { show: false } },
      visualMap: { type: "continuous", min: -lim, max: lim, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10,
        text: [`≥ ${f.num(lim, 0)}${unit}`, `≤ −${f.num(lim, 0)}${unit}`], textStyle: { color: tokens.muted, fontSize: 11 }, inRange: { color: [tokens.divNeg, tokens.divMid, tokens.divPos] } },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: tokens.surface, borderWidth: 2, borderRadius: 2 }, emphasis: { itemStyle: { borderColor: tokens.ink, borderWidth: 1 } } }],
    };
  }, [g, lim, tokens, f, metric]);
  const shockRows = useMemo(() => (input ? TABLE_SHOCKS.map((s) => ({ s, r: runScenario({ ...input, shockBp: s }, assumptions) })) : []), [JSON.stringify(input), assumptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = shortName(sec);
  const exportCsv = () => {
    if (!input || !result) return;
    downloadText(`scenario-${sec.id}-${refDate}.csv`, scenarioCsv({ sec, name, reference: refDate, input, result, assumptionsVersion: assumptions.version, snapshotId: manifest.snapshot_id, dataAsOf: manifest.data_as_of }));
  };

  const facts: Record<string, string> = {
    bond: name, date: f.date(refDate), modified: f.num(rk?.modified, 2), convexity: f.num(rk?.convexity, 1),
    dv01: ref && rk ? f.brl(rk.modified * ref.buyPrice * 1e-4, 3) : "", reference: f.date(refDate), horizon: `${f.num(A.horizonYears, 2)} years`,
    shock: f.bp(A.shockBp), ipca: f.pct(A.inflationPa, 1), selic: f.pct(A.selicPa), reinvest: f.pct(A.reinvestPa), assumptionsVersion: assumptions.version, dataAsOf: f.date(latest.date),
  };
  const scope = `${name} · reference date ${f.date(refDate)}`;
  const shock100 = theo?.pts.find((p) => p.s === 100);
  const shockM100 = theo?.pts.find((p) => p.s === -100);

  return (
    <div className="space-y-5">
      <PageHeader kicker="Mark-to-market lab" title="What is the bond worth if yields move?">
        Three separate layers: (1) values actually observed after a reference date; (2) immediate theoretical repricing of the bond on that date under a yield shock; (3) hypothetical holding-period scenarios starting on that date, with explicit inflation, costs and taxes. Nothing here is a forecast.
      </PageHeader>

      <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Bond" htmlFor="lab-bond">
          <select id="lab-bond" value={id} onChange={(e) => { setId(e.target.value); setA(null); }}>
            {candidates.map((s) => <option key={s.id} value={s.id}>{shortName(s)} · {f.date(s.maturity)}{s.active ? "" : " (matured or not offered)"}</option>)}
          </select>
        </Field>
        <Field label="Reference date" htmlFor="lab-ref" hint={validIdx.length ? `${validIdx.length} supported dates from ${f.date(h?.dates[validIdx[0]])}` : "Loading dates…"}>
          <input id="lab-ref" type="date" value={refDate} min={h ? h.dates[validIdx[0]] : undefined} max={h ? h.dates[validIdx[validIdx.length - 1]] : undefined}
            onChange={(e) => {
              if (!h) return;
              const v = e.target.value;
              // Snap to the latest supported date on or before the chosen day (no future data).
              let best: number | null = null;
              for (const i of validIdx) if (h.dates[i] <= v) best = i;
              setRefIdx(best ?? validIdx[0]);
              setA(null);
            }} data-testid="ref-date" />
        </Field>
        <Field label="Hypothetical amount (R$)" htmlFor="lab-amt">
          <input id="lab-amt" type="number" min={100} step={100} value={A.amount} onChange={(e) => set({ amount: Math.max(100, Number(e.target.value) || 0) })} />
        </Field>
        <div className="text-[13px] text-ink2" data-testid="ref-summary">
          <div className="kicker">Observed on the reference date</div>
          {ref ? <div className="mt-1">Buy at {f.rateLabel(sec.family, ref.buyRate)} · {f.brl(ref.buyPrice)}; sale rate {f.pct(ref.sellRate)}{ref.vna ? ` · VNA ${f.num(ref.vna, 2)}` : ""}. {isLatest ? "Latest observation." : "Historical date: later data is used only in the observed layer."}</div>
            : <div className="mt-1">No supported reference date for this bond.</div>}
        </div>
      </div>

      {!isLatest && ready && (
        <Notice>Scenario inputs use only information available on {f.date(refDate)}: that day's official prices and rates, the VNA implied by that day's prices, and default assumptions from the Focus survey of {f.date(defaults.focusDate)} and the Selic target then in force. The observed layer below shows what actually happened afterwards.</Notice>
      )}

      <ChartCard basis="observed" title="1. Observed mark-to-market after the reference date"
        subtitle={ref ? `Hypothetical ${f.brl(A.amount)} purchase on ${f.date(refDate)} at ${f.pct(ref.buyRate)}, valued at each later day's official sale price.` : undefined}
        note={observed?.couponsEstimated ? "Coupons and instalments received are estimated with the VNA implied by the official price on the payment date; no reinvestment, costs or taxes." : "Gross values, before costs and taxes."}
        ask={{ page: "lab", chart: "lab.observed", scope, facts, product: sec.code }}
        explain={{
          shows: `The value of a hypothetical purchase of ${name} on ${f.date(refDate)}: units bought at that day's official purchase price, valued every later business day at the official sale price, plus any coupons or instalments received. Source: Tesouro Transparente.`,
          read: "Above the dashed line the position was worth more than was invested; below it, less. Day-to-day moves are mark-to-market changes driven by yields, inflation accrual and time.",
          now: observed && observed.last != null ? `By ${f.date(observed.lastDate)} the position was worth ${f.brl(observed.last, 0)} (${f.signedPct((observed.last / A.amount - 1) * 100)}), with a worst peak-to-trough fall of ${f.pct(observed.mdd * 100, 1)} along the way.${isLatest ? " The reference date is the latest observation, so there is no later history yet." : ""}` : undefined,
          why: "It shows the experience an investor would actually have had, including interim losses that a hold-to-maturity yield hides.",
          limits: "One purchase date only, gross of custody and taxes; a different start date can give a very different result. Past paths do not predict future ones.",
        }}>
        {observed && <Chart option={obsOpt!} height={260} label="Observed mark-to-market" />}
      </ChartCard>

      {theo && rk && ref && (
        <ChartCard basis="theoretical" title="2. Price sensitivity on the reference date"
          subtitle={`Immediate price change for parallel shocks to the ${f.date(refDate)} purchase yield.`}
          ask={{ page: "lab", chart: "lab.sensitivity", scope, facts, product: sec.code }}
          table={<DataTable caption="Sensitivity" rowKey={(p) => String(p.s)} rows={theo.pts.filter((p) => p.s % 50 === 0)} columns={[
            { key: "s", label: "Shock", num: true, render: (p) => f.bp(p.s) },
            { key: "e", label: "Exact", num: true, render: (p) => f.signedPct(p.exact) },
            { key: "d", label: "Duration", num: true, render: (p) => f.signedPct(p.dur) },
            { key: "c", label: "Duration + convexity", num: true, render: (p) => f.signedPct(p.dc) }]} />}
          explain={{
            shows: `The percentage change in the price of ${name} if its yield jumped instantly by −300 to +300 bp on ${f.date(refDate)}: exact repricing of all remaining cash flows, the duration approximation and the duration-plus-convexity approximation.`,
            read: "Prices move opposite to yields, so the line slopes down. Where the exact line and the straight duration line diverge, convexity matters; the dashed line adds the convexity correction.",
            now: shock100 && shockM100 ? `A +100 bp shock lowers the price by ${f.pct(-shock100.exact, 2)}; −100 bp raises it by ${f.pct(shockM100.exact, 2)}. Modified duration ${f.num(rk.modified, 2)} alone would predict ±${f.num(rk.modified, 2)}%; the asymmetry is convexity (${f.num(rk.convexity, 1)}).` : undefined,
            why: "It quantifies interest-rate risk: how much of the investment's value is at stake for a given change in market yields.",
            limits: "An instant, parallel shock with nothing else changing; real moves happen over time, alongside inflation accrual and changing curve shapes.",
          }}>
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2"><Chart option={theoOpt!} height={300} label="Price sensitivity" /></div>
            <div className="prose-lab text-[14px]">
              <p><Term k="modified">Modified duration</Term> {f.num(rk.modified, 2)}: each 1 bp rise cuts the price by about {f.num(rk.modified / 100, 3)}% (<Term k="dv01">DV01</Term> {f.brl(rk.modified * ref.buyPrice * 1e-4, 3)} per unit).</p>
              <p><Term k="convexity">Convexity</Term> {f.num(rk.convexity, 1)}: falls in yields add more value than equal rises take away.</p>
              {sec.family === "floating" && <p>For Tesouro Selic the rate is the spread over Selic; the sensitivity shown is to the spread, not to the Selic level.</p>}
            </div>
          </div>
        </ChartCard>
      )}

      <section className="card p-4 sm:p-5" aria-labelledby="scen-h">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div><h2 id="scen-h" className="text-[15px] font-semibold text-ink">3. Hypothetical holding-period scenario</h2>
            <p className="text-[13px] text-muted">Entry at the observed purchase price on {f.date(refDate)}; exit at that day's sale rate plus the shock. Defaults: Focus IPCA {defaults.ipca != null ? f.pct(defaults.ipca, 1) : "n/a"} and Selic target {defaults.selic != null ? f.pct(defaults.selic) : "n/a"} known on that date.</p></div>
          <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink2">▲ Hypothetical scenario</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Slider id="lab-hz" label="Horizon" value={Math.min(A.horizonYears, Math.ceil(yearsLeft * 4) / 4)} min={0.25} max={Math.max(0.5, Math.ceil(yearsLeft * 4) / 4)} step={0.25} onChange={(v) => set({ horizonYears: v })}
            display={A.horizonYears >= yearsLeft ? "to maturity" : `${f.num(A.horizonYears, 2)} years`} />
          <Slider id="lab-shock" label="Exit-yield shock" value={A.shockBp} min={-300} max={300} step={5} onChange={(v) => set({ shockBp: v })} display={f.bp(A.shockBp)} />
          {sec.indexer === "ipca" && <Slider id="lab-ipca" label="Assumed IPCA (% p.a.)" value={A.inflationPa} min={0} max={12} step={0.1} onChange={(v) => set({ inflationPa: v })} display={f.pct(A.inflationPa, 1)} />}
          {sec.indexer === "selic" && <Slider id="lab-selic" label="Assumed Selic (% p.a.)" value={A.selicPa} min={2} max={20} step={0.25} onChange={(v) => set({ selicPa: v })} display={f.pct(A.selicPa)} />}
          <Slider id="lab-reinv" label="Reinvestment of flows (% p.a.)" value={A.reinvestPa} min={0} max={20} step={0.25} onChange={(v) => set({ reinvestPa: v })} display={f.pct(A.reinvestPa)} />
          <fieldset className="flex flex-col gap-1 text-[13px] text-ink2">
            <legend className="mb-1 text-[12px] font-medium text-ink2">Costs and taxes</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={A.applyCosts} onChange={(e) => set({ applyCosts: e.target.checked })} /> B3 custody</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={A.applyTaxes} onChange={(e) => set({ applyTaxes: e.target.checked })} /> Income tax and IOF (Brazilian resident)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={A.custodyDeductible} onChange={(e) => set({ custodyDeductible: e.target.checked })} /> Deduct custody from the tax base (unconfirmed)</label>
          </fieldset>
        </div>

        {result && (
          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="scenario-results">
            <Stat label="Gross value" value={f.brl(result.grossValue, 0)} sub={result.heldToMaturity ? "held to maturity" : `sale at ${f.pct(result.exitRate)}`} />
            <Stat label="Custody" value={f.brl(-result.custody, 0)} />
            <Stat label="Income tax + IOF" value={f.brl(-(result.incomeTax + result.iof), 0)} />
            <Stat label="Net value" value={f.brl(result.netValue, 0)} delta={f.signedPct(result.netReturnPct, 1)} deltaGood={result.netValue >= A.amount} />
            <Stat label="Net % p.a." value={f.pct(result.netReturnPaPct)} />
            <Stat label="Real net % p.a." value={result.realNetReturnPaPct == null ? "–" : f.pct(result.realNetReturnPaPct)} sub={result.realNetReturnPaPct == null ? "not indexed" : `deflator ${f.pct(A.inflationPa, 1)}`} />
          </div>
        )}
        {result && (
          <div className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[13px] leading-relaxed text-ink2" data-testid="scenario-now">
            <span className="font-semibold text-ink">What the data shows: </span>
            {`Buying ${f.brl(A.amount, 0)} of ${name} on ${f.date(refDate)} and ${result.heldToMaturity ? `holding it to maturity (${f.date(toISO(result.horizonDate))})` : `selling on ${f.date(toISO(result.horizonDate))} at ${f.pct(result.exitRate)}`} gives ${f.brl(result.netValue, 0)} after ${f.brl(result.custody, 0)} custody and ${f.brl(result.incomeTax + result.iof, 0)} in taxes: ${f.pct(result.netReturnPaPct)} a year nominal${result.realNetReturnPaPct != null ? `, ${f.pct(result.realNetReturnPaPct)} real` : ""}. `}
            {altTax ? `If custody were deductible from the tax base, income tax would be ${f.brl(altTax.incomeTax, 0)} instead of ${f.brl(result.incomeTax, 0)}. ` : ""}
            {observedAtHorizon ? `Observed for comparison: the same purchase was actually worth ${f.brl(observedAtHorizon.value, 0)} gross on ${f.date(observedAtHorizon.date)}.` : ""}
          </div>
        )}
        {result && result.immediateSpreadCost > 0 && (
          <p className="mt-3 text-[12px] text-muted">Buy/sell difference: selling immediately would cost about {f.brl(result.immediateSpreadCost)} (already reflected by exiting at the sale rate; not deducted again).</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className="rounded-md border border-edge px-3 py-1.5 text-[13px] text-ink2 hover:bg-surface2" data-testid="export-csv">Export summary (CSV)</button>
          <span className="self-center text-[12px] text-muted">Cost and tax assumptions version {assumptions.version} (reference {f.date(assumptions.reference_date)}).</span>
        </div>
      </section>

      <ChartCard basis="scenario" title="Scenario comparison" subtitle={`Horizon ${A.horizonYears >= yearsLeft ? "to maturity" : `${f.num(A.horizonYears, 2)} years`}, same assumptions`}
        ask={{ page: "lab", chart: "lab.scenario", scope, facts, product: sec.code }}
        explain={{
          shows: "The same holding-period scenario recomputed for seven exit-yield shocks, with gross value, costs and taxes, net value and annualised returns.",
          read: "Read across a row to see the cost and tax drag; read down the table to see how the exit yield changes the outcome. Shocks do not affect a bond held to maturity.",
          now: shockRows.length ? `Between a 200 bp fall and a 200 bp rise in the exit yield, the net value ranges from ${f.brl(shockRows[shockRows.length - 1].r.netValue, 0)} to ${f.brl(shockRows[0].r.netValue, 0)}.` : undefined,
          why: "It shows the range of outcomes created by yield risk over the chosen horizon, not a single estimate.",
          limits: "Each row is a hypothetical single shock at the exit date with fixed inflation and reinvestment assumptions; probabilities are not assigned to any row.",
        }}>
        <DataTable caption="Scenarios" rowKey={(x) => String(x.s)} rows={shockRows} selected={String(A.shockBp)} onRowClick={(x) => set({ shockBp: x.s })} columns={[
          { key: "s", label: "Shock", num: true, render: (x) => f.bp(x.s) },
          { key: "x", label: "Exit yield", num: true, render: (x) => (x.r.exitRate == null ? "–" : f.pct(x.r.exitRate)) },
          { key: "g", label: "Gross", num: true, render: (x) => f.brl(x.r.grossValue, 0) },
          { key: "c", label: "Costs + taxes", num: true, render: (x) => f.brl(-(x.r.custody + x.r.iof + x.r.incomeTax), 0) },
          { key: "n", label: "Net", num: true, render: (x) => f.brl(x.r.netValue, 0) },
          { key: "a", label: "Net % p.a.", num: true, render: (x) => f.pct(x.r.netReturnPaPct) },
          { key: "r", label: "Real % p.a.", num: true, render: (x) => (x.r.realNetReturnPaPct == null ? "–" : f.pct(x.r.realNetReturnPaPct)) },
        ]} />
      </ChartCard>

      {g && heatOpt && (
        <ChartCard basis="scenario" title="Shock × horizon map"
          subtitle="Each cell is a full scenario with the assumptions above. Rows reaching maturity do not depend on the shock."
          actions={<Segmented label="Metric" value={metric} onChange={setMetric} options={[
            { value: "netReturnPaPct", label: "Net % p.a." }, { value: "netReturnPct", label: "Net % total" },
            ...(sec.indexer === "ipca" ? [{ value: "realNetReturnPaPct" as GridMetric, label: "Real % p.a." }] : [])]} />}
          ask={{ page: "lab", chart: "lab.heatmap", scope, facts, product: sec.code }}
          table={<DataTable caption="Scenario grid" rowKey={(r) => String(r.h)} rows={g.horizons.map((x, i) => ({ h: x, vals: g.values[i] }))} maxHeight={420}
            columns={[{ key: "h", label: "Years", num: true, render: (r) => f.num(r.h, 2) },
              ...g.shocks.filter((_, j) => j % 4 === 0).map((s) => ({ key: String(s), label: f.bp(s), num: true, render: (r: { vals: number[] }) => f.num(r.vals[g.shocks.indexOf(s)], 2) }))]} />}
          note="Diverging scale: red = negative result, blue = positive, grey = near zero. The colour scale is clipped at the 90th percentile of absolute values; exact values are in the tooltip and table."
          explain={{
            shows: `${g.horizons.length * g.shocks.length} hypothetical scenarios for ${name} from ${f.date(refDate)}: horizons from ${f.num(g.horizons[0], 2)} years to maturity, and exit-yield shocks from −300 to +300 bp.`,
            read: "Moving right means selling at a higher yield (lower price). Moving up means holding longer. Short horizons are dominated by the price effect; long horizons by the yield earned along the way.",
            now: `At the shortest horizon the result ranges from ${f.num(Math.min(...g.values[0].filter(Number.isFinite)), 1)} to ${f.num(Math.max(...g.values[0].filter(Number.isFinite)), 1)}; held to maturity it is ${f.num(g.values[g.values.length - 1][12], 1)} regardless of the shock (${metric === "netValue" ? "BRL" : "%"}).`,
            why: "It shows how holding time reduces the impact of yield moves: the longer the holding, the more the contracted yield and the less the exit price drives the result.",
            limits: "Annualising very short horizons exaggerates results. Inflation, Selic and reinvestment are fixed across all cells; no probabilities are attached to shocks.",
          }}>
          <Chart option={heatOpt} height={Math.max(260, 26 * g.horizons.length + 90)} label="Scenario heatmap" testId="heatmap" />
          <div className="mt-3">
            {!show3d ? (
              <button type="button" className="rounded-md border border-edge px-3 py-1.5 text-[13px] text-ink2 hover:bg-surface2" onClick={() => setShow3d(true)} disabled={!webglAvailable()}>
                {webglAvailable() ? "Show 3D surface (WebGL)" : "WebGL unavailable on this device"}
              </button>
            ) : (
              <Suspense fallback={<p className="text-muted">…</p>}>
                <p className="mb-2 text-[12px] text-muted">X axis: shock (bp) · Z axis: horizon · Height and colour: same metric and clipped scale as the map. Drag to rotate.</p>
                <Surface3D grid={g} clip={lim} label="3D surface of the scenario map" reducedMotion={reducedMotion}
                  colors={{ neg: tokens.divNeg, mid: tokens.divMid, pos: tokens.divPos, grid: tokens.muted, bg: tokens.surface }} />
                <button type="button" className="mt-2 rounded-md border border-edge px-3 py-1 text-[12px] text-ink2" onClick={() => setShow3d(false)}>Close 3D</button>
              </Suspense>
            )}
          </div>
        </ChartCard>
      )}

      <Notice>Scenarios assume fixed inflation and Selic paths and a single shock at the exit date; they are not forecasts, offers or recommendations. Taxation is illustrative for a Brazilian-resident individual. A positive contracted yield does not guarantee a positive result if the bond is sold before maturity.</Notice>
    </div>
  );
}
