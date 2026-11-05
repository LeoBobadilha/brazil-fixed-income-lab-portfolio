import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chart } from "../charts/Chart";
import { axisStyle, dataZoom, grid, legend, lineSeries, row, tooltip } from "../charts/base";
import { FAMILY_LABEL, familyColor, secName, shortName, useCore } from "../data/core";
import { benchmarkDates, useData } from "../data/load";
import type { Benchmarks, Curves, Macro, Reconciliation, Security } from "../data/types";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { ChartCard, DataTable, Field, PageHeader, Segmented, Stat } from "../ui/kit";
import { AskButton, Explain, Term } from "../ui/explain";
import { Intro } from "../ui/intro";
import { BENCH_LABEL, BUCKETS, PERIODS, RANGES, largestMoves, rangeStart } from "./common";

type Fam = "real" | "nominal" | "floating";

export default function Overview() {
  const { securities, latest, manifest } = useCore();
  const f = useFmt();
  const { tokens } = useTheme();
  const nav = useNavigate();
  const curves = useData<Curves>("curves.json");
  const bench = useData<Benchmarks>("benchmarks.json");
  const macro = useData<Macro>("macro.json");
  const recon = useData<Reconciliation>("reconciliation.json");

  const [family, setFamily] = useState<Fam>("real");
  const [period, setPeriod] = useState("1m");
  const [bucket, setBucket] = useState("all");
  const [product, setProduct] = useState("all");
  const [obsDate, setObsDate] = useState<string>(latest.date);
  const [benchKey, setBenchKey] = useState("real_d10y");
  const [range, setRange] = useState("5y");

  const famProducts = useMemo(() => {
    const codes = new Set(securities.filter((s) => s.active && s.family === family).map((s) => s.code));
    return [...codes];
  }, [securities, family]);

  const inScope = (s: Security, years: number | undefined) => {
    const b = BUCKETS.find((x) => x.key === bucket)!;
    return s.active && s.family === family && (product === "all" || s.code === product) && years != null && years >= b.lo && years < b.hi;
  };

  const rows = useMemo(() => latest.rows
    .map((r) => ({ r, s: securities.find((x) => x.id === r.id)! }))
    .filter(({ r, s }) => inScope(s, r.years_to_last_flow ?? r.days_to_maturity / 365.25))
    .sort((a, b) => a.s.maturity.localeCompare(b.s.maturity) || a.s.code.localeCompare(b.s.code)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [latest, securities, family, bucket, product]);

  // Comparison date: the same period offset from the selected observation date. For the
  // latest date the exact business-day reference dates are used; for older dates the
  // nearest published curve on or before the target date (curves are monthly further back).
  const targetFor = (per: string): string | null => {
    if (obsDate === latest.date) return latest.reference_dates[per] ?? null;
    const d = new Date(`${obsDate}T00:00:00Z`);
    if (per === "1d") d.setUTCDate(d.getUTCDate() - 1);
    else if (per === "1w") d.setUTCDate(d.getUTCDate() - 7);
    else if (per === "1m") d.setUTCMonth(d.getUTCMonth() - 1);
    else if (per === "3m") d.setUTCMonth(d.getUTCMonth() - 3);
    else if (per === "1y") d.setUTCFullYear(d.getUTCFullYear() - 1);
    else return `${Number(obsDate.slice(0, 4)) - 1}-12-31`;
    return d.toISOString().slice(0, 10);
  };
  const refTarget = targetFor(period);
  // The published curve actually used for a comparison: the latest one on or before the
  // target that is earlier than the selected observation curve (null when none exists).
  const obsCurveKey = curves.data ? curves.data.dates.filter((x) => x <= obsDate).pop() ?? null : obsDate;
  const resolveRef = (target: string | null): string | null => {
    if (!target || !curves.data) return target;
    const k = curves.data.dates.filter((x) => x <= target).pop() ?? null;
    return k != null && obsCurveKey != null && k < obsCurveKey ? k : null;
  };

  // Curve points for the observation date and the comparison date (from curves.json)
  const curveSeries = useMemo(() => {
    if (!curves.data) return null;
    const pick = (d: string | null) => {
      if (!d) return [];
      const key = curves.data!.dates.filter((x) => x <= d).pop();
      if (!key) return [];
      return curves.data!.curves[key]
        .map(([id, ytl, mac, rate]) => ({ id, ytl, mac, rate, s: securities.find((s) => s.id === id)! }))
        .filter((p) => p.s && p.s.family === family && (product === "all" || p.s.code === product) && (() => {
          const b = BUCKETS.find((x) => x.key === bucket)!;
          return p.mac >= b.lo && p.mac < b.hi;
        })())
        .map((p) => ({ ...p, key }));
    };
    const obsPts = pick(obsDate);
    const obsKey = obsPts[0]?.key ?? null;
    // The comparison layer shows the same securities on the earlier curve, so the chart and the
    // "What changed" panel describe the same set (bonds that matured in between are excluded).
    const obsIds = new Set(obsPts.map((p) => p.id));
    let refPts = pick(refTarget).filter((p) => obsIds.has(p.id));
    if (refPts[0]?.key != null && obsKey != null && refPts[0].key >= obsKey) refPts = [];
    return { obs: obsPts, ref: refPts, obsKey, refKey: refPts[0]?.key ?? null };
  }, [curves.data, obsDate, refTarget, family, product, bucket, securities]);

  const curveFacts = useMemo(() => {
    const pts = curveSeries?.obs ?? [];
    if (!pts.length) return {} as Record<string, string>;
    const sorted = [...pts].sort((a, b) => a.mac - b.mac);
    const lab = (r: number) => (family === "real" ? `IPCA + ${f.pct(r)}` : f.pct(r));
    return { family: FAMILY_LABEL[family], date: f.date(curveSeries!.obsKey), short: lab(sorted[0].rate), long: lab(sorted[sorted.length - 1].rate), dataAsOf: f.date(latest.date) } as Record<string, string>;
  }, [curveSeries, family, f, latest.date]);

  const famColor = family === "nominal" ? tokens.nominal : family === "real" ? tokens.real : tokens.floating;

  const curveOption = useMemo(() => {
    if (!curveSeries) return null;
    const mk = (pts: typeof curveSeries.obs, color: string, name: string, hollow: boolean) => ({
      name, type: "scatter", symbolSize: 9, itemStyle: { color: hollow ? tokens.muted : color },
      data: pts.map((p) => ({ value: [p.mac, p.rate], id: p.id, symbol: p.s.coupon === "none" ? "circle" : p.s.code === "RENDA" || p.s.code === "EDUCA" ? "triangle" : "diamond",
        itemStyle: { color: hollow ? "transparent" : (p.s.code === "RENDA" || p.s.code === "EDUCA") ? tokens.ntnb1 : color, borderColor: hollow ? tokens.muted : tokens.surface, borderWidth: hollow ? 1.5 : 2 } })),
      emphasis: { scale: 1.4 },
    });
    const obsName = `${f.date(curveSeries.obsKey)}`;
    const refName = curveSeries.refKey ? `${f.date(curveSeries.refKey)}` : "";
    return {
      grid: grid({ top: 52 }),
      legend: { ...legend(tokens), icon: "circle", itemWidth: 8, itemHeight: 8 },
      tooltip: { ...tooltip(tokens, "item"), formatter: (p: { data: { id: string; value: number[] }; seriesName: string }) => {
        const s = securities.find((x) => x.id === p.data.id)!;
        return `<div style="opacity:.7;margin-bottom:4px">${shortName(s)} · ${p.seriesName}</div>` +
          row(familyColor(tokens, s), f.rateLabel(s.family, p.data.value[1]), ("purchase rate")) +
          row(tokens.muted, `${f.num(p.data.value[0], 2)}`, ("Macaulay duration (years)"));
      } },
      xAxis: { type: "value", name: ("Duration (years)"), nameLocation: "middle", nameGap: 26, ...axisStyle(tokens) },
      yAxis: { type: "value", scale: true, name: family === "real" ? ("Real yield % p.a.") : family === "nominal" ? ("Nominal yield % p.a.") : ("Spread over Selic % p.a."), ...axisStyle(tokens), nameTextStyle: { color: tokens.muted, fontSize: 11, align: "left" } },
      series: [
        ...(curveSeries.ref.length ? [mk(curveSeries.ref, tokens.muted, refName, true)] : []),
        mk(curveSeries.obs, famColor, obsName, false),
      ],
    };
  }, [curveSeries, tokens, f, family, famColor, securities]);

  // What changed between the comparison curve and the selected curve, security by security
  // (both taken from the published curve snapshots, so any observation date is scoped correctly).
  const summary = useMemo(() => {
    if (!curveSeries || !curveSeries.ref.length) return null;
    const refById = new Map(curveSeries.ref.map((p) => [p.id, p]));
    const pairs = curveSeries.obs.filter((p) => refById.has(p.id)).map((p) => ({
      s: p.s, chg: (p.rate - refById.get(p.id)!.rate) * 100, modified: p.mac / (1 + p.rate / 100),
    }));
    if (!pairs.length) return null;
    const avg = pairs.reduce((a, b) => a + b.chg, 0) / pairs.length;
    const longest = pairs.reduce((a, b) => (b.modified > a.modified ? b : a));
    const maxUp = pairs.reduce((a, b) => (b.chg > a.chg ? b : a));
    const maxDn = pairs.reduce((a, b) => (b.chg < a.chg ? b : a));
    return { avg, n: pairs.length, longest, maxUp, maxDn };
  }, [curveSeries]);

  const benchOption = useMemo(() => {
    if (!bench.data) return null;
    const dates = benchmarkDates(bench.data.d);
    const vals = bench.data.series[benchKey] ?? [];
    const i0 = rangeStart(dates, RANGES.find((r) => r.key === range)!.years);
    const color = benchKey.startsWith("real") ? tokens.real : benchKey.startsWith("nom") ? tokens.nominal : tokens.floating;
    const data = dates.slice(i0).map((d, i) => [d, vals[i0 + i]]);
    return {
      grid: grid({ bottom: 36 }),
      tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, f.pct(ps[0].value[1]), (BENCH_LABEL[benchKey])) },
      xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${f.num(v, 1)}%` } },
      dataZoom: dataZoom(tokens),
      series: [lineSeries((BENCH_LABEL[benchKey]), color, data, { areaStyle: { color, opacity: 0.08 } })],
    };
  }, [bench.data, benchKey, range, tokens, f]);

  const benchFacts = useMemo(() => {
    const out: Record<string, string> = { series: BENCH_LABEL[benchKey] ?? benchKey, dataAsOf: f.date(latest.date) };
    if (!bench.data) return out;
    const dates = benchmarkDates(bench.data.d);
    const vals = bench.data.series[benchKey] ?? [];
    const i0 = rangeStart(dates, RANGES.find((r) => r.key === range)!.years);
    const idx = dates.map((_, i) => i).slice(i0).filter((i) => vals[i] != null);
    if (idx.length < 2) return out;
    const unit = benchKey.includes("vol") || benchKey.includes("slope") ? (v: number) => `${f.num(v, 0)} bp` : (v: number) => f.pct(v);
    const a = idx[0], b = idx[idx.length - 1];
    const lo = idx.reduce((m, i) => (vals[i]! < vals[m]! ? i : m)), hi = idx.reduce((m, i) => (vals[i]! > vals[m]! ? i : m));
    return { ...out, from: f.date(dates[a]), to: f.date(dates[b]), rateFrom: unit(vals[a]!), rateTo: unit(vals[b]!), current: unit(vals[b]!),
      rateLow: `${unit(vals[lo]!)} (${f.date(dates[lo])})`, rateHigh: `${unit(vals[hi]!)} (${f.date(dates[hi])})` };
  }, [bench.data, benchKey, range, f, latest.date]);

  const moves = useMemo(() => {
    if (!bench.data) return [];
    return largestMoves(benchmarkDates(bench.data.d), bench.data.series[benchKey] ?? [], 21, 8);
  }, [bench.data, benchKey]);

  const ctx = useMemo(() => {
    if (!macro.data || !bench.data) return null;
    const last = (k: string) => {
      const s = macro.data!.series[k];
      return s ? { v: s.values[s.values.length - 1], d: s.dates[s.dates.length - 1] } : null;
    };
    const b = bench.data.series;
    const lastOf = (k: string) => { const a = b[k] ?? []; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    const focusIpca = macro.data.focus.latest.find((x) => x.indicator === "IPCA" && x.year === Number(latest.date.slice(0, 4)) + 1);
    return { selic: last("selic_target"), ipca: last("ipca_12m"), real10: lastOf("real_d10y"), nom2: lastOf("nom_d2y"), be5: lastOf("breakeven_5y"), focusIpca };
  }, [macro.data, bench.data, latest.date]);

  const famOptions = (["real", "nominal", "floating"] as Fam[]).map((k) => ({ value: k, label: FAMILY_LABEL[k] }));
  const benchKeys = family === "nominal" ? ["nom_d1y", "nom_d2y", "nom_d3y", "nom_d5y", "nom_slope_5_1", "nom_vol_2y_bp", "breakeven_5y"]
    : family === "real" ? ["real_d2y", "real_d5y", "real_d10y", "real_d20y", "real_slope_20_2", "real_vol_10y_bp", "breakeven_5y"] : ["selic_target"];
  const recentDates = curves.data ? [...curves.data.dates].reverse() : [latest.date];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Market overview" title="Brazilian government bonds on Tesouro Direto">
        {`Official rates and prices validated to ${f.date(latest.date)}. ${manifest.counts.active_securities} securities on offer. `}
        <Term k="real">Real yields</Term> (IPCA+) and <Term k="nominal">nominal yields</Term> (fixed-rate) are shown separately because they are not directly comparable.
      </PageHeader>
      <Intro />

      {/* Filters: one row, above everything they scope */}
      <div className="card flex flex-wrap items-end gap-4 p-3" role="group" aria-label={("Filters")}>
        <Field label="Rate family">
          <Segmented label="Rate family" value={family} onChange={(v) => { setFamily(v); setProduct("all"); setBenchKey(v === "nominal" ? "nom_d2y" : v === "real" ? "real_d10y" : "selic_target"); }} options={famOptions} />
        </Field>
        <Field label="Bond type" htmlFor="f-prod">
          <select id="f-prod" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="all">{("All in family")}</option>
            {famProducts.map((c) => <option key={c} value={c}>{securities.find((s) => s.code === c)!["product_en"]}</option>)}
          </select>
        </Field>
        <Field label="Maturity bucket (duration)" htmlFor="f-bucket">
          <select id="f-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {BUCKETS.map((b) => <option key={b.key} value={b.key}>{(b.label)}</option>)}
          </select>
        </Field>
        <Field label="Observation date" htmlFor="f-date">
          <select id="f-date" value={obsDate} onChange={(e) => setObsDate(e.target.value)}>
            {recentDates.slice(0, 400).map((d) => <option key={d} value={d}>{f.date(d)}</option>)}
          </select>
        </Field>
        <Field label="Compare with" htmlFor="f-per">
          <select id="f-per" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => { const k = resolveRef(targetFor(p.key)); return <option key={p.key} value={p.key}>{p.label} ({k ? f.date(k) : "no earlier curve"})</option>; })}
          </select>
        </Field>
      </div>

      {ctx && (
        <>
        <div className="kicker -mb-2">Context on the latest date ({f.date(latest.date)})</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Selic target" value={f.pct(ctx.selic?.v)} sub={`as of ${f.date(ctx.selic?.d)}`} />
          <Stat label="IPCA, 12 months" value={f.pct(ctx.ipca?.v)} sub={`ref. ${f.month(ctx.ipca!.d)}`} />
          <Stat label="Real yield, 10y duration" value={`IPCA + ${f.pct(ctx.real10)}`} sub={"interpolated"} />
          <Stat label="Nominal yield, 2y duration" value={f.pct(ctx.nom2)} sub={"interpolated"} />
          <Stat label="Expected IPCA (Focus)" value={f.pct(ctx.focusIpca?.median)} sub={`${ctx.focusIpca?.year} · median`} />
        </div>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <ChartCard className="lg:col-span-3" basis="observed"
          title="Yield curve"
          subtitle="Purchase rate by Macaulay duration. ● zero-coupon · ◆ semiannual coupon · ▲ Renda+/Educa+"
          note={curveSeries?.refKey ? `Filled markers: ${f.date(curveSeries.obsKey)}; hollow markers: comparison curve of ${f.date(curveSeries.refKey)}.` : "No earlier curve is available for this comparison."}
          ask={{ page: "overview", chart: "overview.curve", scope: `${FAMILY_LABEL[family]} curve · ${f.date(curveSeries?.obsKey ?? obsDate)}`, facts: curveFacts }}
          explain={{
            shows: `Purchase yields of every ${FAMILY_LABEL[family].toLowerCase()} security on Tesouro Direto on ${f.date(curveSeries?.obsKey ?? obsDate)}, plotted against Macaulay duration (years). Source: Tesouro Transparente. Hollow markers show the same securities on the comparison date.`,
            read: "Each point is one security; the vertical axis is the yield it offers, the horizontal axis how far in the future its cash flows are on average. Points above the hollow ones mean yields have risen since the comparison date (prices fell).",
            now: curveFacts.short ? `On ${curveFacts.date}, yields ranged from ${curveFacts.short} at the shortest duration to ${curveFacts.long} at the longest (${curveSeries?.obs.length} securities).` : undefined,
            why: "The curve summarises what the market requires to lend to the Treasury over different horizons; its level and slope drive the value of every bond in the family.",
            limits: "Bonds with different cash-flow structures (zero-coupon, coupons, Renda+ instalments) sit on the same chart but are not perfect substitutes. The curve does not by itself forecast policy rates or inflation, and real and nominal curves must not be compared point by point.",
          }}
          table={curveSeries && <DataTable caption="Curve" rowKey={(p) => p.id} rows={curveSeries.obs}
            columns={[{ key: "n", label: "Bond", render: (p) => shortName(p.s) },
              { key: "d", label: "Duration", num: true, render: (p) => f.num(p.mac, 2) },
              { key: "r", label: "Rate", num: true, render: (p) => f.pct(p.rate) }]} />}>
          {curveOption ? <Chart option={curveOption} height={340} label={("Yield curve by duration")} testId="curve-chart"
            onClick={(p) => { const id = (p.data as { id?: string })?.id; if (id) nav(`/bond/${id}`); }} /> : <div style={{ height: 340 }} />}
        </ChartCard>

        <section className="card p-5 lg:col-span-2" aria-labelledby="changed">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="changed" className="text-[15px] font-semibold text-ink">What changed</h2>
            <AskButton ctx={{ page: "overview", chart: "overview.changed", title: "What changed", scope: `${FAMILY_LABEL[family]} · ${f.date(curveSeries?.obsKey ?? obsDate)}`,
              facts: { ...curveFacts, ...(curveSeries?.refKey ? { from: f.date(curveSeries.refKey), to: f.date(curveSeries.obsKey) } : {}) } }} />
          </div>
          <p className="mt-1 text-[13px] text-muted" data-testid="changed-scope">{curveSeries?.refKey ? `From ${f.date(curveSeries.refKey)} to ${f.date(curveSeries.obsKey)} · ${FAMILY_LABEL[family]}` : `${f.date(curveSeries?.obsKey ?? obsDate)} · ${FAMILY_LABEL[family]}`}</p>
          {summary ? (
            <div className="prose-lab mt-2 text-[14px]" data-testid="changed-body">
              <p>{`Purchase yields moved by ${f.bp(summary.avg, 1)} on average across the ${summary.n} securities quoted on both dates.`}</p>
              <p>{`For the longest-duration bond (${shortName(summary.longest.s)}, modified duration ${f.num(summary.longest.modified, 1)}), the ${f.bp(summary.longest.chg)} move is worth roughly ${f.signedPct(-summary.longest.modified * summary.longest.chg / 100, 1)} in price, using the duration approximation (ΔP/P ≈ −D*·Δy).`}</p>
              <p data-testid="changed-extremes">{
                summary.maxUp.chg <= 0
                  ? `Every yield fell. Largest fall: ${shortName(summary.maxDn.s)} (${f.bp(summary.maxDn.chg)}); smallest fall: ${shortName(summary.maxUp.s)} (${f.bp(summary.maxUp.chg)}).`
                  : summary.maxDn.chg >= 0
                    ? `Every yield rose or was unchanged. Largest rise: ${shortName(summary.maxUp.s)} (${f.bp(summary.maxUp.chg)}); smallest: ${shortName(summary.maxDn.s)} (${f.bp(summary.maxDn.chg)}).`
                    : `Largest rise: ${shortName(summary.maxUp.s)} (${f.bp(summary.maxUp.chg)}). Largest fall: ${shortName(summary.maxDn.s)} (${f.bp(summary.maxDn.chg)}).`
              }</p>
              {curveSeries && curveSeries.refKey && curveSeries.refKey !== refTarget && <p className="text-[12px]">{`The comparison uses the nearest published curve on or before ${f.date(refTarget)}.`}</p>}
              <p className="text-[12px]">These figures describe the observed move; the site does not attribute causes to it.</p>
            </div>
          ) : <p className="mt-3 text-[13px] text-muted">No comparable observations for this date and period.</p>}
          <Explain testId="explain-overview.changed" e={{
            shows: "The change in purchase yield of each security quoted on both the comparison date and the selected date, summarised as an average, the largest moves and the price effect on the longest-duration bond.",
            read: "Positive values mean yields rose (prices fell). The price effect multiplies the yield change by modified duration, a first-order estimate.",
            why: "It turns a yield move into what it meant for holders: the same move costs a long-duration bond far more than a short one.",
            limits: "Only securities quoted on both dates are compared; bonds issued or matured in between are excluded. Older history is stored as monthly curves, so the comparison date can be the nearest earlier curve rather than the exact target.",
          }} />
        </section>
      </div>

      <ChartCard basis="observed" title="Bond universe"
        subtitle={`Latest date only: securities on offer on ${f.date(latest.date)}. Click a row to open it in the explorer.`}
        note="Percentile: where today's rate sits in the bond's own history (minimum 250 observations). A historically high rate does not mean the bond is cheap."
        explain={{
          shows: `Every ${FAMILY_LABEL[family].toLowerCase()} security on offer on ${f.date(latest.date)} that matches the filters: rates, price, the change in purchase rate over the selected period, modified duration, DV01 and the historical percentile.`,
          read: "Buy is the rate a new investor locks in; Sell is the rate at which Tesouro buys the bond back. DV01 is the price change per unit for a 1 bp move.",
          now: `${rows.length} securities match the filters on the latest date.`,
          why: "It puts yield, risk (duration, DV01) and recent change side by side for every bond, so trade-offs are visible at a glance.",
          limits: "Latest date only, whatever observation date is selected above. Bonds offered for sale only have no purchase rate.",
        }}>
        <DataTable caption="Bond universe" rowKey={(x) => x.r.id} rows={rows} maxHeight={480} onRowClick={(x) => nav(`/bond/${x.r.id}`)}
          columns={[
            { key: "name", label: "Bond", render: ({ s }) => <span className="text-ink">{secName(s)}</span> },
            { key: "mat", label: "Final maturity", render: ({ s }) => f.date(s.maturity) },
            { key: "buy", label: "Buy", num: true, render: ({ r }) => r.buy_offered ? f.pct(r.buy_rate) : <span className="text-muted">{("sell only")}</span> },
            { key: "sell", label: "Sell", num: true, render: ({ r }) => f.pct(r.sell_rate) },
            { key: "pu", label: "Buy price", num: true, render: ({ r }) => f.brl(r.buy_price) },
            { key: "chg", label: latest.reference_dates[period] ? `Δ since ${f.date(latest.reference_dates[period])}` : "Δ period", num: true, render: ({ r }) => f.bp(r.change_bp[period]) },
            { key: "dur", label: "Mod. dur.", num: true, render: ({ r }) => f.num(r.modified, 2) },
            { key: "dv01", label: "DV01 R$", num: true, render: ({ r }) => f.num(r.dv01_brl, 3) },
            { key: "pctl", label: "Percentile", num: true, render: ({ r }) => r.percentile.valid ? `${f.num(r.percentile.percentile, 0)} (${r.percentile.observations})` : <span className="text-muted">n/a</span> },
          ]} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" basis="statistical" title="Benchmark history"
          subtitle="Constant-duration rate, interpolated across same-family securities (no extrapolation)."
          actions={<Segmented label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} />}
          note={bench.data?.notes[benchKey.startsWith("breakeven") ? "breakeven" : benchKey.includes("vol") ? "vol" : "construction"]}
          ask={{ page: "overview", chart: "overview.benchmark", scope: `${BENCH_LABEL[benchKey]} · ${RANGES.find((r) => r.key === range)!.label}`, facts: benchFacts }}
          explain={{
            shows: `${BENCH_LABEL[benchKey]}: a constant-horizon series built each day from official Tesouro Direto purchase rates by linear interpolation between the two same-family bonds whose durations bracket the target.`,
            read: benchKey.includes("slope") ? "Positive values mean long yields are above short ones; a rising line is a steepening curve." : benchKey.includes("vol") ? "Higher values mean larger day-to-day moves in the rate." : benchKey.startsWith("breakeven") ? "The breakeven is the inflation rate at which fixed-rate and IPCA-linked bonds of similar duration would earn the same." : "A rising line means the yield for that horizon rose, so prices of bonds near that duration fell.",
            now: benchFacts.rateFrom ? `From ${benchFacts.from} to ${benchFacts.to} the series moved from ${benchFacts.rateFrom} to ${benchFacts.rateTo}; range low ${benchFacts.rateLow}, high ${benchFacts.rateHigh}.` : undefined,
            why: "Individual bonds age and their duration shrinks; a constant-duration series isolates changes in the rate itself, which is what drives mark-to-market.",
            limits: "Interpolation adds small errors where few bonds exist, and no value is extrapolated beyond the shortest or longest bond, so some horizons start later. Breakeven inflation also contains risk premia and is not a pure inflation forecast.",
          }}>
          <div className="mb-2"><label className="sr-only" htmlFor="bench">Benchmark</label>
            <select id="bench" value={benchKey} onChange={(e) => setBenchKey(e.target.value)}>{benchKeys.map((k) => <option key={k} value={k}>{(BENCH_LABEL[k])}</option>)}</select></div>
          {benchOption ? <Chart option={benchOption} height={300} label={(BENCH_LABEL[benchKey])} /> : <div style={{ height: 300 }} />}
        </ChartCard>
        <ChartCard basis="observed" title="Largest 21-day moves" subtitle={BENCH_LABEL[benchKey]}
          ask={{ page: "overview", chart: "overview.moves", scope: BENCH_LABEL[benchKey] ?? benchKey, facts: benchFacts }}
          explain={{
            shows: "The largest changes in the selected benchmark over 21 trading days (about one month), across its full history, without overlapping windows.",
            read: "Each row is one window; positive changes mean yields rose.",
            now: moves.length ? `The largest listed move is ${f.bp(moves[0].change)}, from ${f.date(moves[0].start)} to ${f.date(moves[0].end)}.` : undefined,
            why: "Combined with duration, these moves show how large a month's mark-to-market swing can be in stress.",
            limits: "History only; a future stress can be larger. The list depends on the benchmark's construction and start date.",
          }}>
          <DataTable caption="Largest moves" rowKey={(m) => m.end} rows={moves}
            columns={[{ key: "p", label: "Window", render: (m) => `${f.date(m.start)} → ${f.date(m.end)}` },
              { key: "c", label: "Change", num: true, render: (m) => f.bp(m.change) }]} />
        </ChartCard>
      </div>

      {recon.data && (
        <section className="card p-5" aria-labelledby="dq">
          <h2 id="dq" className="text-[15px] font-semibold text-ink">{"Data quality"}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-[13px] text-ink2"><span style={{ color: manifest.status === "current" ? "var(--good-text)" : "var(--status-warning)" }}>{manifest.status === "current" ? "✔" : "⚠"}</span>{" "}
              {manifest.status === "current" ? "Current snapshot" : "Stale snapshot"} · {manifest.business_days_since_data} {"business days since last observation"}</div>
            {recon.data.by_product.filter((r) => ["LTN", "NTNBP", "RENDA"].includes(r.product_code)).map((r) => (
              <div key={r.product_code} className="text-[13px] text-ink2"><span style={{ color: "var(--good-text)" }}>✔</span> {r.product_code}: {f.pct(r.within_1c_pct * 100, 2)} {"of official prices reproduced (±R$ 0.01)"}</div>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">A snapshot is current when every source is within its freshness threshold. The percentages are the share of historical official prices the pricing engine reproduces within one cent, a test of the calculations, not of any forecast.</p>
          <a href="#/methodology" className="mt-2 inline-block text-[13px] underline" style={{ color: "var(--accent-text)" }}>{"See full reconciliation and methodology"}</a>
        </section>
      )}
    </div>
  );
}
