import { useMemo, useState } from "react";
import { Chart } from "../charts/Chart";
import { axisStyle, dataZoom, grid, lineSeries, row, tooltip } from "../charts/base";
import { shortName, useCore } from "../data/core";
import { benchmarkDates, useData } from "../data/load";
import type { Benchmarks, Research as ResearchT } from "../data/types";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { ChartCard, DataTable, ErrorBox, Loading, Notice, PageHeader, Segmented } from "../ui/kit";
import { BENCH_LABEL } from "./common";

function Verdict({ kind }: { kind: "supported" | "not" | "descriptive" | "weak" }) {
  const m: Record<string, { icon: string; color: string; label: string }> = {
    supported: { icon: "✔", color: "var(--status-good)", label: "Statistically supported" },
    weak: { icon: "◐", color: "var(--status-warning)", label: "Detectable, not actionable" },
    not: { icon: "✖", color: "var(--status-critical)", label: "Not supported" },
    descriptive: { icon: "∑", color: "var(--text-muted)", label: "Descriptive (untested)" },
  };
  const x = m[kind];
  return <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink2"><span style={{ color: x.color }} aria-hidden>{x.icon}</span>{x.label}</span>;
}

export default function Research() {
  const r = useData<ResearchT>("research.json");
  const b = useData<Benchmarks>("benchmarks.json");
  const { byId } = useCore();
  const f = useFmt();
  const { tokens } = useTheme();
  const [pctKey, setPctKey] = useState("real_d10y");

  const calOpt = useMemo(() => {
    if (!r.data) return null;
    const rows = r.data.calendar.windows.rows;
    return {
      grid: grid(),
      tooltip: { ...tooltip(tokens, "item"), formatter: (p: { name: string; value: number; dataIndex: number }) => {
        const w = rows[p.dataIndex];
        const se = w.std_bp / Math.sqrt(w.days);
        return `<div style="opacity:.7;margin-bottom:4px">${p.name} · ${w.days} ${("days")}</div>` + row(tokens.real, `${f.num(w.mean_change_bp, 2)} bp`, ("mean daily change")) + row(tokens.muted, `± ${f.num(1.96 * se, 2)} bp`, ("95% CI")) + row(tokens.muted, f.num(w.p_holm, 3), "p (Holm)");
      } },
      xAxis: { type: "category", data: rows.map((w) => w.window), name: ("Day of month"), nameLocation: "middle", nameGap: 26, ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v} bp` } },
      series: [
        { type: "bar", barMaxWidth: 24, data: rows.map((w) => ({ value: w.mean_change_bp, itemStyle: { color: tokens.real, borderRadius: w.mean_change_bp >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })) },
        { type: "scatter", symbol: "rect", symbolSize: [14, 2], itemStyle: { color: tokens.ink2 }, tooltip: { show: false }, data: rows.map((w) => w.mean_change_bp + 1.96 * w.std_bp / Math.sqrt(w.days)) },
        { type: "scatter", symbol: "rect", symbolSize: [14, 2], itemStyle: { color: tokens.ink2 }, tooltip: { show: false }, data: rows.map((w) => w.mean_change_bp - 1.96 * w.std_bp / Math.sqrt(w.days)) },
      ],
    };
  }, [r.data, tokens, f]);

  const pctOpt = useMemo(() => {
    if (!b.data || !r.data) return null;
    const dates = benchmarkDates(b.data.d);
    const v = b.data.series[pctKey];
    const vals = v.filter((x): x is number => x != null).slice().sort((x, y) => x - y);
    const q = (p: number) => vals[Math.floor((vals.length - 1) * p)];
    const color = pctKey.startsWith("real") ? tokens.real : tokens.nominal;
    return {
      grid: grid({ bottom: 36, right: 48 }),
      tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(color, f.pct(ps[0].value[1]), (BENCH_LABEL[pctKey])) },
      xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (val: number) => `${f.num(val, 0)}%` } },
      dataZoom: dataZoom(tokens),
      series: [lineSeries((BENCH_LABEL[pctKey]), color, dates.map((d, i) => [d, v[i]]), {
        markLine: { symbol: "none", silent: true, lineStyle: { color: tokens.muted, width: 1 }, label: { color: tokens.muted, position: "end", fontSize: 10 },
          data: [{ yAxis: q(0.1), label: { formatter: "p10" } }, { yAxis: q(0.5), label: { formatter: "p50" } }, { yAxis: q(0.9), label: { formatter: "p90" } }] },
      })],
    };
  }, [b.data, r.data, pctKey, tokens, f]);

  const slopeOpt = useMemo(() => {
    if (!b.data) return null;
    const dates = benchmarkDates(b.data.d);
    const s = b.data.series.real_slope_20_2;
    return {
      grid: grid({ bottom: 36 }),
      tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + row(tokens.real, `${f.num(ps[0].value[1], 0)} bp`, (BENCH_LABEL.real_slope_20_2)) },
      xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v} bp` } },
      dataZoom: dataZoom(tokens),
      series: [lineSeries((BENCH_LABEL.real_slope_20_2), tokens.real, dates.map((d, i) => [d, s[i]]), { markLine: { symbol: "none", silent: true, lineStyle: { color: tokens.muted }, label: { show: false }, data: [{ yAxis: 0 }] } })],
    };
  }, [b.data, tokens, f]);

  if (r.error) return <ErrorBox message={r.error} />;
  if (!r.data) return <Loading />;
  const R = r.data;
  const cal = R.calendar;
  const w1114 = cal.windows.rows.find((w) => w.window === "11-14")!;
  const sig = cal.windows.rows.filter((w) => w.significant_5pct);
  const changeKeys = Object.keys(R.daily_changes);
  const pc = R.percentiles[pctKey];
  const facts: Record<string, string> = {
    sample: `${cal.windows.n_days} trading days, ${f.date(cal.windows.start)} to ${f.date(cal.windows.end)}`,
    w1114: `${f.num(w1114.diff_vs_rest_bp, 2)} bp per day vs the rest of the month (Holm-adjusted p = ${f.num(w1114.p_holm, 2)})`,
    oos: `${cal.out_of_sample.in_sample_best_window}: ${f.num(cal.out_of_sample.oos_diff_vs_rest_bp, 2)} bp, p = ${f.num(cal.out_of_sample.oos_p, 2)} after ${f.date(cal.out_of_sample.split_date)}`,
  };
  if (pc) { facts.bond = BENCH_LABEL[pctKey] ?? pctKey; facts.series = facts.bond; facts.current = f.pct(pc.last); if (pc.valid) facts.percentile = `${f.num(pc.percentile, 0)}th`; facts.observations = String(pc.observations); }
  const dd0 = R.drawdowns[0];
  if (dd0) facts.worstDrawdown = `${byId.get(dd0.id) ? shortName(byId.get(dd0.id)!) : dd0.id}, ${f.pct(dd0.max_drawdown_pct, 1)} from ${f.date(dd0.peak_date)} to ${f.date(dd0.trough_date)}`;
  const regRows = R.regimes.real_d10y.rows;
  const slopeLast = (() => { const v = b.data?.series.real_slope_20_2 ?? []; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return v[i] as number; return null; })();
  const askFor = (chart: string, scope: string) => ({ page: "research", chart: `research.${chart}`, scope, facts });

  return (
    <div className="space-y-5">
      <PageHeader kicker="Research & opportunities" title="What the history shows, and what it does not">
        {"Every result states its sample, period, test and limitations. A historically high yield does not make a bond cheap: it means compensation is high relative to the past, with mark-to-market risk proportional to duration."}
      </PageHeader>

      <ChartCard basis="statistical" title="Is there a best time of the month to buy IPCA+?"
        subtitle={`Mean daily change in purchase rates, ${f.date(cal.windows.start)} to ${f.date(cal.windows.end)}, ${cal.windows.n_days} trading days. Bars: mean; ticks: 95% CI.`}
        ask={askFor("calendar", "Calendar windows, IPCA+ purchase rates")}
        explain={{
          shows: "For each window of days in the month, the average daily change in Tesouro IPCA+ purchase rates (bars) with a 95% confidence interval (ticks), across all IPCA+ bonds.",
          read: "A bar below zero means rates tended to fall (prices rise) on those days. If the ticks straddle zero the effect is indistinguishable from noise. p-values are Holm-adjusted for testing several windows.",
          now: `Sample: ${facts.sample}. The original hypothesis (days 11–14): ${facts.w1114}. Out of sample, the best earlier window was ${facts.oos}.`,
          why: "It tests the legacy project's claim that there is a best time of the month to buy, with corrections for multiple testing and an out-of-sample check.",
          limits: "Even statistically detectable effects are a fraction of a basis point per day, far smaller than the buy/sell spread. Daily changes are autocorrelated and regimes change.",
        }}
        table={<DataTable caption="Windows" rowKey={(w) => w.window} rows={cal.windows.rows} columns={[
          { key: "w", label: "Window", render: (w) => w.window }, { key: "n", label: "n", num: true, render: (w) => String(w.days) },
          { key: "m", label: "Mean (bp)", num: true, render: (w) => f.num(w.mean_change_bp, 3) },
          { key: "d", label: "vs rest (bp)", num: true, render: (w) => f.num(w.diff_vs_rest_bp, 3) },
          { key: "t", label: "t", num: true, render: (w) => f.num(w.t_stat, 2) }, { key: "p", label: "p", num: true, render: (w) => f.num(w.p_value, 3) },
          { key: "pp", label: "p permutation", num: true, render: (w) => f.num(w.p_perm, 3) }, { key: "h", label: "p Holm", num: true, render: (w) => f.num(w.p_holm, 3) }]} />}>
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">{calOpt && <Chart option={calOpt} height={280} label={("Calendar effect")} />}</div>
          <div className="prose-lab text-[14px] lg:col-span-2">
            <div className="flex flex-wrap gap-2"><Verdict kind="not" /><span className="text-[12px] text-muted">{"Original project's hypothesis: days 11–14"}</span></div>
            <p>{`Days 11–14 differ from the rest of the month by ${f.num(w1114.diff_vs_rest_bp, 2)} bp per day (adjusted p = ${f.num(w1114.p_holm, 2)}).`}</p>
            <div className="flex flex-wrap gap-2"><Verdict kind={cal.out_of_sample.oos_supported ? "supported" : "not"} /><span className="text-[12px] text-muted">{"Out-of-sample test"}</span></div>
            <p>{`The best window up to ${f.date(cal.out_of_sample.split_date)} (${cal.out_of_sample.in_sample_best_window}) did not repeat afterwards: difference ${f.num(cal.out_of_sample.oos_diff_vs_rest_bp, 2)} bp, p = ${f.num(cal.out_of_sample.oos_p, 2)}.`}</p>
            {sig.length > 0 && <><Verdict kind="weak" /><p>{`Window ${sig.map((s) => s.window).join(", ")}: mean ${sig.map((s) => f.num(s.mean_change_bp, 2)).join(", ")} bp/day, statistically detectable but far smaller than the ~12 bp buy/sell spread and sensitive to autocorrelation.`}</p></>}
          </div>
        </div>
      </ChartCard>

      <ChartCard basis="statistical" title="Original project's metric (biased)"
        subtitle="Each day's deviation from the same month's average" note="Uses future information (later days of the month). Kept for transparency only: it should not drive decisions."
        ask={askFor("legacy", "Legacy calendar metric")}
        explain={{
          shows: "The metric used by the original project: how far each day's purchase rate sat from the average of its own month, grouped into day-of-month windows.",
          read: "Negative values mean rates were below the month's average on those days.",
          why: "It is kept to show why the original conclusion (buy on days 11–14) was not reliable.",
          limits: "The monthly average includes days that had not happened yet, so the metric uses future information (look-ahead bias). It cannot be traded on and is not a statistical test; see the tested results above.",
        }}>
        <DataTable caption="Legacy metric" rowKey={(x) => x.window} rows={cal.legacy_metric.rows} columns={[
          { key: "w", label: "Window", render: (x) => x.window }, { key: "d", label: "Mean deviation (bp)", num: true, render: (x) => f.num(x.mean_deviation_bp, 2) },
          { key: "n", label: "n", num: true, render: (x) => String(x.days) }]} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" basis="statistical" title="Yields relative to their own history"
          subtitle="Constant-duration rates with 10th/50th/90th percentiles of the full history"
          ask={askFor("percentile", `${BENCH_LABEL[pctKey] ?? pctKey}`)}
          explain={{
            shows: `${BENCH_LABEL[pctKey] ?? pctKey} over time: a constant-duration rate interpolated from same-family Tesouro bonds, with horizontal lines at the 10th, 50th and 90th percentiles of its full history.`,
            read: "Above the p90 line means the yield is higher than on 90% of past days.",
            now: facts.current ? `Current value ${facts.current}${facts.percentile ? `, at the ${facts.percentile} percentile of ${facts.observations} observations` : ""}.` : undefined,
            why: "It puts today's yield level in historical context without relying on a single bond whose duration changes over time.",
            limits: "A high percentile is not a buy signal: yields can remain high or rise further, and history may not include today's conditions. Interpolation between bonds adds small errors.",
          }}
          actions={<Segmented label="Series" value={pctKey} onChange={setPctKey} options={["real_d5y", "real_d10y", "real_d20y", "nom_d2y", "nom_d5y"].map((k) => ({ value: k, label: k.replace("real_d", "R ").replace("nom_d", "N ") }))} />}>
          {pctOpt && <Chart option={pctOpt} height={300} label={(BENCH_LABEL[pctKey])} />}
        </ChartCard>
        <ChartCard basis="statistical" title="Current percentile" note="A high percentile describes a historically elevated yield. It is not a buy signal and guarantees no return."
          explain={{
            shows: "For each constant-duration benchmark, the latest value and where it sits in that series' full history (percentile), with the number of observations.",
            read: "A percentile of 90 means the current yield is higher than on 90% of past days.",
            why: "It summarises how unusual today's yields are across horizons.",
            limits: "Descriptive only. Percentiles are shown only with at least 250 observations; history may not include today's conditions.",
          }}>
          <DataTable caption="Percentiles" rowKey={([k]) => k} rows={Object.entries(R.percentiles)} columns={[
            { key: "k", label: "Series", render: ([k]) => (BENCH_LABEL[k] ?? k) },
            { key: "l", label: "Current", num: true, render: ([, v]) => f.pct(v.last) },
            { key: "p", label: "Percentile", num: true, render: ([, v]) => (v.valid ? f.num(v.percentile, 0) : "n/a") },
            { key: "n", label: "n", num: true, render: ([, v]) => String(v.observations) }]} />
        </ChartCard>
      </div>

      <ChartCard basis="statistical" title="Real-yield regimes and the change over the next 12 months"
        subtitle="10y-duration real yield, fixed and transparent bands"
        note="Overlapping windows: the effective number of independent observations is small ('effective n'). Descriptive; may reflect a handful of episodes."
        ask={askFor("regimes", "Real-yield regimes, 10y duration")}
        explain={{
          shows: "Days grouped by the level of the 10-year-duration real yield (fixed bands), with the average change over the following 12 months and how often the yield fell.",
          read: "Compare the mean change and the share of falls across bands, together with the effective number of independent observations.",
          now: regRows.length ? `${regRows.length} bands; the highest band has an effective sample of ${f.num(regRows[regRows.length - 1].effective_independent_obs, 1)} independent observations.` : undefined,
          why: "It checks a common claim, that high real yields tend to fall afterwards, against the data.",
          limits: "Descriptive, not a statistical test or a forecast. Twelve-month windows overlap, so the effective sample is small and results may reflect a few episodes.",
        }}>
        <div className="mb-2"><Verdict kind="descriptive" /></div>
        <DataTable caption="Regimes" rowKey={(x) => x.regime} rows={R.regimes.real_d10y.rows} columns={[
          { key: "r", label: "Regime", render: (x) => x.regime }, { key: "d", label: "Days", num: true, render: (x) => String(x.days) },
          { key: "e", label: "Effective n", num: true, render: (x) => f.num(x.effective_independent_obs, 1) },
          { key: "m", label: "Mean 12m change", num: true, render: (x) => f.bp(x.mean_change_bp) },
          { key: "s", label: "% where it fell", num: true, render: (x) => (x.share_rate_fell == null ? "–" : f.pct(x.share_rate_fell * 100, 0)) }]} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard basis="observed" title="Largest price drawdowns"
          subtitle="Sale price, zero-coupon bonds and Renda+ before conversion"
          note="Includes time and inflation effects on price; measures the maximum mark-to-market loss for a buyer at the peak."
          ask={askFor("drawdowns", "Largest historical drawdowns")}
          explain={{
            shows: "The largest peak-to-trough falls in the sale price of zero-coupon bonds and pre-conversion Renda+ bonds, with the dates and when (if ever) the price recovered.",
            read: "A 30% drawdown means a buyer at the peak could have sold for 30% less at the trough.",
            now: R.drawdowns[0] ? `Largest: ${byId.get(R.drawdowns[0].id) ? shortName(byId.get(R.drawdowns[0].id)!) : R.drawdowns[0].id}, ${f.pct(R.drawdowns[0].max_drawdown_pct, 1)} from ${f.date(R.drawdowns[0].peak_date)} to ${f.date(R.drawdowns[0].trough_date)}.` : undefined,
            why: "It shows, with real history, how large mark-to-market losses on long government bonds can be even without any default.",
            limits: "Coupon bonds are excluded because their price drops at each coupon. Holding to maturity would have avoided realising these losses.",
          }}>
          <DataTable caption="Drawdowns" rowKey={(x) => x.id} rows={R.drawdowns.slice(0, 10)} columns={[
            { key: "i", label: "Bond", render: (x) => (byId.get(x.id) ? shortName(byId.get(x.id)!) : x.id) },
            { key: "d", label: "Max fall", num: true, render: (x) => f.pct(x.max_drawdown_pct, 1) },
            { key: "p", label: "Peak → trough", render: (x) => `${f.date(x.peak_date)} → ${f.date(x.trough_date)}` },
            { key: "r", label: "Recovery", render: (x) => (x.recovery_date ? f.date(x.recovery_date) : ("not recovered")) }]} />
        </ChartCard>
        <ChartCard basis="statistical" title="Daily changes by duration" subtitle="Constant-duration rates, in bp"
          ask={askFor("daily", "Daily changes by duration")}
          explain={{
            shows: "The distribution of daily changes in each constant-duration benchmark: standard deviation, 1st and 99th percentiles and the largest daily rise, in basis points.",
            read: "Wider ranges mean more daily risk. The 1st and 99th percentiles show a bad day that happens roughly 2–3 times a year.",
            why: "Multiplied by duration, these moves translate into daily price swings.",
            limits: "Historical; volatility clusters in crises and the largest moves cluster in a few episodes.",
          }}>
          <DataTable caption="Daily changes" rowKey={(k) => k} rows={changeKeys} columns={[
            { key: "k", label: "Series", render: (k) => (BENCH_LABEL[k]) },
            { key: "s", label: "Std (bp)", num: true, render: (k) => f.num(R.daily_changes[k].std_bp, 1) },
            { key: "p1", label: "p1", num: true, render: (k) => f.num(R.daily_changes[k].p01_bp, 0) },
            { key: "p99", label: "p99", num: true, render: (k) => f.num(R.daily_changes[k].p99_bp, 0) },
            { key: "mx", label: "Largest rise", num: true, render: (k) => f.num(R.daily_changes[k].max_rise_bp, 0) },
            { key: "n", label: "n", num: true, render: (k) => String(R.daily_changes[k].n) }]} />
        </ChartCard>
      </div>

      <ChartCard basis="statistical" title="Real curve slope (20y − 2y)"
        subtitle={`Monthly moves above ${R.slope_episodes.threshold_bp} bp: ${R.slope_episodes.steepening.length} steepening and ${R.slope_episodes.flattening.length} flattening episodes in ${R.slope_episodes.months} months`}
        note={<span>{"Steepening: "}{R.slope_episodes.steepening.join(", ")} · {"Flattening: "}{R.slope_episodes.flattening.join(", ")}</span>}
        ask={askFor("slope", "Real curve slope (20y − 2y)")}
        explain={{
          shows: "The 20-year-duration real yield minus the 2-year-duration real yield, in basis points, with months of large steepening or flattening listed below.",
          read: "Above zero, long real yields exceed short ones. A rising line is a steepening curve.",
          now: slopeLast != null ? `Latest slope: ${f.num(slopeLast, 0)} bp.` : undefined,
          why: "The slope shows whether the market demands more compensation for long horizons, which matters most for Renda+ and long IPCA+ bonds.",
          limits: "Descriptive history; the site does not attribute causes to moves or forecast the slope.",
        }}>
        {slopeOpt && <Chart option={slopeOpt} height={260} label={(BENCH_LABEL.real_slope_20_2)} />}
      </ChartCard>

      <Notice>{"Preferred indicators: historically elevated real yield, duration sensitivity, relative rate difference, volatility, and upside/downside scenarios. Nothing here is a recommendation or a forecast."}</Notice>
    </div>
  );
}
