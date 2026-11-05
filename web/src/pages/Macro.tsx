import { useMemo, useState } from "react";
import { Chart } from "../charts/Chart";
import { axisStyle, dataZoom, grid, legend, lineSeries, row, tooltip } from "../charts/base";
import { useCore } from "../data/core";
import { benchmarkDates, useData } from "../data/load";
import type { Benchmarks, Debt, Macro as MacroT } from "../data/types";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { BasisTag, ChartCard, DataTable, ErrorBox, Loading, Notice, PageHeader, Segmented, Stat } from "../ui/kit";
import { RANGES } from "./common";

// Display labels for the indexer classes used in the Tesouro debt-stock data (keys stay as published).
const INDEXER_LABEL: Record<string, string> = { Prefixado: "Fixed-rate (Prefixado)", IPCA: "Inflation-linked (IPCA)", Selic: "Floating (Selic)", "Câmbio (dívida externa)": "Exchange rate (external debt)", "IGP-M": "Inflation-linked (IGP-M)", Outros: "Other" };

function since(dates: string[], years: number | null) {
  if (years == null) return 0;
  const last = dates[dates.length - 1];
  const cut = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  const i = dates.findIndex((d) => d >= cut);
  return Math.max(0, i);
}

export default function Macro() {
  const { manifest } = useCore();
  const m = useData<MacroT>("macro.json");
  const d = useData<Debt>("debt.json");
  const b = useData<Benchmarks>("benchmarks.json");
  const f = useFmt();
  const { tokens } = useTheme();
  const [range, setRange] = useState("10y");
  const years = RANGES.find((r) => r.key === range)!.years;

  const ts = (pairs: [string, number | null][], color: string, name: string, extra = {}) => lineSeries(name, color, pairs, extra);
  const timeOpt = (series: unknown[], unit = "%", zoom = true) => ({
    grid: grid({ top: series.length > 1 ? 36 : 16, bottom: zoom ? 36 : 8 }), legend: legend(tokens, series.length > 1),
    tooltip: { ...tooltip(tokens), formatter: (ps: { seriesName: string; value: [string, number]; color: string }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.date(ps[0].value[0])}</div>` + ps.filter((p) => p.value[1] != null).map((p) => row(p.color, `${f.num(p.value[1], 2)}${unit}`, p.seriesName)).join("") },
    xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${f.num(v, 0)}${unit}` } },
    dataZoom: zoom ? dataZoom(tokens) : undefined,
    series,
  });

  const mon = useMemo(() => {
    if (!m.data) return null;
    const S = m.data.series;
    const sel = S.selic_target, ipca = S.ipca_12m;
    const i0 = since(sel.dates, years);
    const ipcaMap = new Map(ipca.dates.map((dd, i) => [dd.slice(0, 7), ipca.values[i]]));
    const realExPost = sel.dates.slice(i0).map((dd, k) => {
      const s = sel.values[i0 + k], p = ipcaMap.get(dd.slice(0, 7));
      return [dd, s != null && p != null ? ((1 + s / 100) / (1 + p / 100) - 1) * 100 : null] as [string, number | null];
    });
    const j0 = since(ipca.dates, years);
    const policy = timeOpt([
      ts(sel.dates.slice(i0).map((dd, k) => [dd, sel.values[i0 + k]]), tokens.floating, ("Selic target (month-end)"), { step: "end" }),
      ts(ipca.dates.slice(j0).map((dd, k) => [dd, ipca.values[j0 + k]]), tokens.inflation, ("IPCA, 12 months")),
    ]);
    let real: unknown = null;
    if (b.data) {
      const bd = benchmarkDates(b.data.d);
      const r10 = b.data.series.real_d10y;
      const me = new Map<string, [string, number | null]>();
      bd.forEach((dd, i) => { if (r10[i] != null) me.set(dd.slice(0, 7), [dd, r10[i]]); });
      const realMarket = [...me.values()].filter(([dd]) => dd >= (realExPost[0]?.[0] ?? ""));
      real = timeOpt([
        ts(realExPost, tokens.floating, ("Ex-post real policy rate (Selic ÷ 12m IPCA)")),
        ts(realMarket, tokens.real, ("Market real yield, 10y duration")),
      ]);
    }
    return { policy, real };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.data, b.data, years, tokens, f]);

  const focusOpt = useMemo(() => {
    if (!m.data) return null;
    const h = m.data.focus.history;
    const pick = (k: string) => (h[k] ? h[k].dates.map((dd, i) => [dd, h[k].median[i]] as [string, number]) : []);
    const cut = years == null ? "" : `${Number(m.data.focus.survey_date.slice(0, 4)) - years}`;
    const flt = (a: [string, number][]) => a.filter(([dd]) => dd >= cut);
    return {
      ipca: timeOpt([ts(flt(pick("IPCA_y1")), tokens.inflation, ("Expected IPCA for the following year (median)"))], "%", false),
      selic: timeOpt([ts(flt(pick("Selic_y1")), tokens.floating, ("Expected Selic at the end of the following year (median)"))], "%", false),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.data, years, tokens]);

  const fiscal = useMemo(() => {
    if (!m.data) return null;
    const S = m.data.series;
    const g = S.gross_debt_gdp, n = S.net_debt_gdp, p = S.primary_balance_12m, nom = S.nominal_balance_12m;
    const debt = timeOpt([
      ts(g.dates.map((dd, i) => [dd, g.values[i]]), tokens.debtGross, ("General government gross debt (% GDP)")),
      ts(n.dates.map((dd, i) => [dd, n.values[i]]), tokens.debtNet, ("Public sector net debt (% GDP)")),
    ], "%");
    const bars = (s: typeof p, name: string) => ({
      grid: grid({ bottom: 36 }),
      tooltip: { ...tooltip(tokens), formatter: (ps: { value: [string, number] }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.month(ps[0].value[0])}</div>` + row(ps[0].value[1] >= 0 ? tokens.divPos : tokens.divNeg, `${f.num(ps[0].value[1], 2)}% ${("of GDP")}`, name) },
      xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v}%` } },
      dataZoom: dataZoom(tokens),
      series: [{ type: "bar", name, barMaxWidth: 6, data: s.dates.map((dd, i) => ({ value: [dd, s.values[i] == null ? null : -(s.values[i] as number)], itemStyle: { color: (s.values[i] ?? 0) <= 0 ? tokens.divPos : tokens.divNeg } })) }],
    });
    return { debt, primary: bars(p, ("12m primary balance")), nominal: bars(nom, ("12m nominal balance")), g, n, p, nom };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.data, tokens, f]);

  const dpf = useMemo(() => {
    if (!d.data) return null;
    const D = d.data;
    const palette: Record<string, string> = { Prefixado: tokens.nominal, IPCA: tokens.real, Selic: tokens.floating, "Câmbio (dívida externa)": tokens.debtGross, "IGP-M": tokens.inflation, Outros: tokens.muted };
    const order = ["Selic", "Prefixado", "IPCA", "Câmbio (dívida externa)", "IGP-M", "Outros"].filter((k) => D.indexers.includes(k));
    const share = (k: string) => D.months.map((mm, i) => [mm, (D.stock_bn[k][i] / D.total_bn[i]) * 100]);
    const comp = {
      grid: grid({ top: 56 }), legend: { ...legend(tokens), icon: "rect", itemWidth: 10, itemHeight: 10 },
      tooltip: { ...tooltip(tokens), formatter: (ps: { seriesName: string; value: [string, number]; color: string }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.month(ps[0].value[0])}</div>` + [...ps].reverse().map((p) => row(p.color, `${f.num(p.value[1], 1)}%`, p.seriesName)).join("") },
      xAxis: { type: "time", ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", max: 100, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${v}%` } },
      series: order.map((k) => ({ name: INDEXER_LABEL[k] ?? k, type: "line", stack: "s", showSymbol: false, data: share(k), lineStyle: { width: 2, color: tokens.surface }, areaStyle: { color: palette[k], opacity: 0.9 }, itemStyle: { color: palette[k] } })),
    };
    const prof = {
      grid: grid(), tooltip: { ...tooltip(tokens, "item"), formatter: (p: { name: string; value: number }) => row(tokens.accent, `R$ ${f.num(p.value, 0)} bi`, p.name) },
      xAxis: { type: "category", data: Object.keys(D.maturity_profile_bn), ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
      series: [{ type: "bar", barMaxWidth: 24, data: Object.values(D.maturity_profile_bn), itemStyle: { color: tokens.accent, borderRadius: [4, 4, 0, 0] } }],
    };
    const mat = timeOpt([ts(D.months.map((mm, i) => [mm, D.avg_years_to_final_maturity[i]]), tokens.accent, ("Years to final maturity (weighted)"))], "", false);
    const st = timeOpt([ts(D.months.map((mm, i) => [mm, D.share_maturing_12m_pct[i]]), tokens.accent, ("% maturing within 12 months"))], "%", false);
    return { comp, prof, mat, st, D, order };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.data, tokens, f]);

  if (m.error) return <ErrorBox message={m.error} />;
  if (!m.data || !fiscal) return <Loading />;
  const S = m.data.series;
  const lastOf = (k: string) => ({ v: S[k].values.at(-1), d: S[k].dates.at(-1) as string, ref: S[k].reference_date });
  const fy = Number(m.data.focus.survey_date.slice(0, 4));
  const focusRows = m.data.focus.latest.filter((x) => x.year >= fy && x.year <= fy + 3);
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  const focusIpca = focusRows.find((x) => x.indicator === "IPCA" && x.year === fy + 1);
  const focusSelic = focusRows.find((x) => x.indicator === "Selic" && x.year === fy + 1);
  // Facts for explanations and the Q&A panel, taken from the latest published observations.
  const sel = lastOf("selic_target"), ip = lastOf("ipca_12m"), gd = lastOf("gross_debt_gdp"), nd = lastOf("net_debt_gdp"), pb = lastOf("primary_balance_12m"), nb = lastOf("nominal_balance_12m");
  const exPost = sel.v != null && ip.v != null ? ((1 + sel.v / 100) / (1 + ip.v / 100) - 1) * 100 : null;
  let market10: { v: number; d: string } | null = null;
  if (b.data) {
    const bd = benchmarkDates(b.data.d), r10 = b.data.series.real_d10y;
    for (let i = r10.length - 1; i >= 0; i--) if (r10[i] != null) { market10 = { v: r10[i] as number, d: bd[i] }; break; }
  }
  const facts: Record<string, string> = {
    selic: f.pct(sel.v), selicDate: f.date(sel.d), ipca12: f.pct(ip.v), ipcaMonth: f.month(ip.d),
    grossDebt: `${f.pct(gd.v, 1)} of GDP`, grossDebtDate: f.month(gd.d), netDebt: `${f.pct(nd.v, 1)} of GDP`,
    primary: `${f.signedPct(-(pb.v ?? 0), 2)} of GDP`, nominal: `${f.signedPct(-(nb.v ?? 0), 2)} of GDP`, dataAsOf: f.date(manifest.data_as_of),
    focusYear: String(fy + 1),
  };
  if (focusIpca) facts.focusIpca = f.pct(focusIpca.median);
  if (focusSelic) facts.focusSelic = f.pct(focusSelic.median);
  if (exPost != null) facts.exPostReal = f.pct(exPost);
  if (market10) facts.marketReal = `IPCA + ${f.pct(market10.v)} (${f.date(market10.d)})`;
  if (dpf) {
    facts.selicShare = f.pct((dpf.D.stock_bn.Selic.at(-1)! / dpf.D.total_bn.at(-1)!) * 100, 1); facts.dpfMonth = f.month(dpf.D.latest_month);
    facts.maturingShare = f.pct(dpf.D.share_maturing_12m_pct.at(-1), 1); facts.avgMaturity = f.num(dpf.D.avg_years_to_final_maturity.at(-1), 2);
  }
  const askFor = (chart: string, scope?: string) => ({ page: "macro", chart: `macro.${chart}`, scope: scope ?? `Latest observations · range ${rangeLabel}`, facts });

  return (
    <div className="space-y-5">
      <PageHeader kicker="Macro & sovereign fundamentals" title="The context behind the yields">
        {"Official indicators from Banco Central, IBGE and Tesouro Nacional. Observed facts, market expectations and statistical relationships are labelled separately; no single indicator here explains rate moves on its own."}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Selic target" value={f.pct(lastOf("selic_target").v)} sub={`SGS 432 · ${f.date(lastOf("selic_target").d)}`} />
        <Stat label="Effective Selic" value={f.pct(lastOf("selic_effective").v)} sub={`SGS 1178 · ${f.date(lastOf("selic_effective").d)}`} />
        <Stat label="CDI" value={f.pct(lastOf("cdi_annual").v)} sub={`SGS 4389 · ${f.date(lastOf("cdi_annual").d)}`} />
        <Stat label="IPCA, 12 months" value={f.pct(lastOf("ipca_12m").v)} sub={`SGS 13522 · ${f.month(lastOf("ipca_12m").d)}`} />
        <Stat label="Gross debt / GDP" value={f.pct(lastOf("gross_debt_gdp").v, 1)} sub={`SGS 13762 · ${f.month(lastOf("gross_debt_gdp").d)}`} />
        <Stat label="12m primary balance" value={f.signedPct(-(lastOf("primary_balance_12m").v ?? 0), 2)} sub={`${("surplus +")} · ${f.month(lastOf("primary_balance_12m").d)}`} />
      </div>

      <div className="flex justify-end"><Segmented label="Range" value={range} onChange={setRange} options={RANGES.filter((r) => r.key !== "1y").map((r) => ({ value: r.key, label: r.label }))} /></div>

      <h2 className="text-lg font-semibold text-ink">{"Monetary policy and inflation"}</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard basis="observed" title="Selic target and inflation" subtitle="Same unit (% p.a.), single axis"
          ask={askFor("policy")}
          explain={{
            shows: "The central bank's Selic policy-rate target (end of month) and 12-month IPCA consumer-price inflation, both in % a year. Sources: BCB SGS 432 and 13522.",
            read: "When the Selic line is well above inflation, monetary policy is restrictive in real terms; when the lines are close or inflation is higher, it is loose.",
            now: `Selic target ${facts.selic} (${facts.selicDate}); IPCA over 12 months ${facts.ipca12} (${facts.ipcaMonth}).`,
            why: "The Selic sets what Tesouro Selic pays and anchors short-term yields; inflation drives IPCA+ payments and the real return of fixed-rate bonds.",
            limits: "Co-movement is not causation. 12-month IPCA is backward-looking, while policy responds to expected inflation.",
          }}>
          {mon && <Chart option={mon.policy} height={300} label={("Selic target and IPCA")} />}
        </ChartCard>
        <ChartCard basis="observed" title="Real rates: policy vs. market"
          note="The ex-post real rate uses past 12-month inflation; the market rate is forward-looking (Tesouro IPCA+ yield). They are not the same measure."
          ask={askFor("real")}
          explain={{
            shows: "Two real interest rates: the policy rate deflated by past 12-month inflation, and the real yield the market demands on a 10-year-duration Tesouro IPCA+ bond (interpolated from official rates).",
            read: "The market real yield reflects expectations for policy, inflation and risk over the next decade; the ex-post policy rate shows how restrictive policy is today.",
            now: `${facts.exPostReal ? `Ex-post real policy rate ${facts.exPostReal}` : ""}${facts.marketReal ? `; 10-year-duration market real yield ${facts.marketReal}.` : "."}`,
            why: "Long real yields set the price of Tesouro IPCA+ and Renda+ bonds; comparing them with the policy rate shows how much term premium investors demand.",
            limits: "Different horizons and inflation measures: the two series are related but not comparable point by point.",
          }}>
          {mon?.real ? <Chart option={mon.real as Record<string, unknown>} height={300} label={("Real rates")} /> : <Loading />}
        </ChartCard>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard basis="expectation" title="Focus expectations" subtitle={`Survey of ${f.date(m.data.focus.survey_date)} · medians`} note="Market expectations, not forecasts by this site."
          ask={askFor("focus", `Focus survey of ${f.date(m.data.focus.survey_date)}`)}
          explain={{
            shows: "Median forecasts from the Banco Central's weekly Focus survey of market economists, with the range of answers and the number of respondents.",
            read: "Medians summarise the consensus; a wide range means disagreement.",
            now: focusIpca || focusSelic ? `For ${fy + 1}: expected IPCA ${focusIpca ? f.pct(focusIpca.median) : "n/a"}, expected end-year Selic ${focusSelic ? f.pct(focusSelic.median) : "n/a"}.` : undefined,
            why: "These public expectations are the default inflation and Selic assumptions in the simulators.",
            limits: "Survey expectations are often revised and can be wrong. They are not forecasts by this site.",
          }}>
          <DataTable caption="Focus" rowKey={(x) => `${x.indicator}${x.year}`} rows={focusRows} columns={[
            { key: "i", label: "Indicator", render: (x) => x.indicator },
            { key: "y", label: "Year", render: (x) => String(x.year) },
            { key: "m", label: "Median", num: true, render: (x) => f.pct(x.median) },
            { key: "r", label: "Range", num: true, render: (x) => `${f.num(x.min, 2)}–${f.num(x.max, 2)}` },
            { key: "n", label: "Resp.", num: true, render: (x) => (x.respondents == null ? "–" : String(x.respondents)) }]} />
        </ChartCard>
        <ChartCard basis="expectation" title="Expected IPCA, following year"
          ask={askFor("focus-ipca", `Focus survey · range ${rangeLabel}`)}
          explain={{
            shows: "The weekly Focus median forecast for IPCA inflation in the following calendar year, over time.",
            read: "A rising line means economists expect higher inflation next year than they did before.",
            now: facts.focusIpca ? `Latest median for ${facts.focusYear}: ${facts.focusIpca}.` : undefined,
            why: "Expected inflation is part of every nominal yield, and it is the default inflation assumption in the simulators.",
            limits: "A survey median, not a market price; it is revised often and can be persistently wrong.",
          }}>{focusOpt && <Chart option={focusOpt.ipca} height={240} label="Focus IPCA" />}</ChartCard>
        <ChartCard basis="expectation" title="Expected Selic, end of following year"
          ask={askFor("focus-selic", `Focus survey · range ${rangeLabel}`)}
          explain={{
            shows: "The weekly Focus median forecast for the Selic target at the end of the following calendar year, over time.",
            read: "A falling line means economists expect lower policy rates ahead.",
            now: facts.focusSelic ? `Latest median for the end of ${facts.focusYear}: ${facts.focusSelic}.` : undefined,
            why: "Expected policy rates anchor short-term yields and the Selic path used by default in the Comparison page.",
            limits: "Market yields can price a different path from the survey, which also reflects risk premia.",
          }}>{focusOpt && <Chart option={focusOpt.selic} height={240} label="Focus Selic" />}</ChartCard>
      </div>

      <h2 className="pt-2 text-lg font-semibold text-ink">{"Fiscal indicators"}</h2>
      <ChartCard basis="observed" title="Public debt"
        note="Different coverage: gross debt (DBGG, 2008 methodology) covers general government; net debt (DLSP) covers the consolidated public sector, including the central bank and state firms, net of assets. They are not added or combined."
        ask={askFor("debt")}
        explain={{
          shows: "General government gross debt and public sector net debt, both as % of GDP. Sources: BCB SGS 13762 and 4513.",
          read: "A rising line means debt is growing faster than the economy. The two series have different coverage and must not be added.",
          now: `Gross debt ${facts.grossDebt} and net debt ${facts.netDebt} (${facts.grossDebtDate}).`,
          why: "Debt dynamics influence the risk premium investors demand on long-term government bonds.",
          limits: "The level alone does not determine default risk: interest costs, growth, the primary balance, maturity profile and holders all matter. Monthly data with a 1–2 month lag.",
        }}>
        <Chart option={fiscal.debt} height={300} label={("Gross and net debt")} />
      </ChartCard>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard basis="observed" title="Primary balance, 12 months (% GDP)" subtitle="Consolidated public sector; blue = surplus, red = deficit"
          note="Sign flipped relative to BCB NFSP (SGS 5793), where positive = deficit."
          ask={askFor("primary")}
          explain={{
            shows: "Revenue minus non-interest spending of the consolidated public sector over the last 12 months, as % of GDP.",
            read: "Positive (blue) bars are surpluses; negative (red) bars are deficits.",
            now: `Latest 12-month primary balance: ${facts.primary}.`,
            why: "Primary surpluses are needed to stabilise debt when interest rates exceed growth.",
            limits: "Includes one-off items; the 12-month sum smooths but delays turning points.",
          }}>
          <Chart option={fiscal.primary} height={260} label={("Primary balance")} />
        </ChartCard>
        <ChartCard basis="observed" title="Nominal balance, 12 months (% GDP)" subtitle="Includes nominal interest; blue = surplus, red = deficit" note="SGS 5727 with sign flipped."
          ask={askFor("nominal")}
          explain={{
            shows: "The consolidated public sector's balance over the last 12 months including interest payments on the debt, as % of GDP.",
            read: "Bars below zero are deficits. The gap between this chart and the primary balance is the interest bill.",
            now: `Latest 12-month nominal balance: ${facts.nominal}; primary balance: ${facts.primary}.`,
            why: "The nominal deficit is what has to be financed by issuing debt; with high interest rates it can be large even with a small primary deficit.",
            limits: "Interest is accrued on an accrual basis and is affected by inflation-indexed debt; 12-month sums delay turning points.",
          }}>
          <Chart option={fiscal.nominal} height={260} label={("Nominal balance")} />
        </ChartCard>
      </div>

      <h2 className="pt-2 text-lg font-semibold text-ink">{"Federal public debt"}</h2>
      {d.error ? <ErrorBox message={d.error} /> : !dpf ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Stock held by the market" value={`R$ ${f.num(dpf.D.total_bn.at(-1)! / 1000, 2)} tri`} sub={f.month(dpf.D.latest_month)} />
            <Stat label="Selic-linked share" value={f.pct((dpf.D.stock_bn.Selic.at(-1)! / dpf.D.total_bn.at(-1)!) * 100, 1)} />
            <Stat label="Years to final maturity" value={f.num(dpf.D.avg_years_to_final_maturity.at(-1), 2)} sub={"stock-weighted"} />
            <Stat label="Maturing in 12 months" value={f.pct(dpf.D.share_maturing_12m_pct.at(-1), 1)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" basis="observed" title="Composition by indexer" subtitle="Share of the stock held by the market (%)" note={dpf.D.notes.indexer}
              ask={askFor("dpf", `Federal public debt · ${facts.dpfMonth}`)}
              explain={{
                shows: "How the federal public debt held by the market is split between fixed-rate, Selic-linked, inflation-linked and exchange-rate-linked securities each month. Source: Tesouro Transparente.",
                read: "Each band's height is that indexer's share of the total; the bands add up to 100%.",
                now: `Selic-linked share: ${facts.selicShare} (${facts.dpfMonth}).`,
                why: "A larger Selic-linked share makes the Treasury's interest bill respond faster to policy-rate changes; fixed-rate and inflation-linked debt lock in costs for longer.",
                limits: "Shares of the stock held by the market, not of new issuance.",
              }}
              table={<DataTable caption="Composition" rowKey={(k) => k} rows={dpf.order} columns={[
                { key: "k", label: "Indexer", render: (k) => INDEXER_LABEL[k] ?? k },
                { key: "v", label: "R$ bn", num: true, render: (k) => f.num(dpf.D.stock_bn[k].at(-1), 0) },
                { key: "s", label: "%", num: true, render: (k) => f.pct((dpf.D.stock_bn[k].at(-1)! / dpf.D.total_bn.at(-1)!) * 100, 1) }]} />}>
              <Chart option={dpf.comp} height={320} label={("DPF composition")} />
            </ChartCard>
            <ChartCard basis="observed" title="Maturity profile" subtitle={`R$ billion, ${f.month(dpf.D.latest_month)}`}
              ask={askFor("maturity", `Federal public debt · ${facts.dpfMonth}`)}
              explain={{
                shows: "How much of the federal debt held by the market reaches its final maturity in each future period, in R$ billion.",
                read: "Tall bars close to today are large refinancing needs in the near term.",
                now: `${facts.maturingShare} of the stock matures within 12 months (${facts.dpfMonth}).`,
                why: "Large near-term maturities must be rolled over at prevailing rates, which raises refinancing risk.",
                limits: "Grouped by final maturity of each security; coupons paid before maturity are not shown.",
              }}>
              <Chart option={dpf.prof} height={320} label={("Maturity profile")} />
            </ChartCard>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard basis="observed" title="Time to final maturity" note={dpf.D.notes.maturity}
              ask={askFor("term", `Federal public debt · ${facts.dpfMonth}`)}
              explain={{
                shows: "The stock-weighted average time until the final maturity of the federal debt held by the market, in years.",
                read: "A rising line means the Treasury has been financing itself for longer.",
                now: `Latest: ${facts.avgMaturity} years (${facts.dpfMonth}).`,
                why: "Longer maturities reduce how often the debt must be refinanced and how fast rate changes reach the interest bill.",
                limits: "This measure weights final maturities only; the official average maturity also weights coupons, so the two differ.",
              }}><Chart option={dpf.mat} height={240} label="maturity" /></ChartCard>
            <ChartCard basis="observed" title="Debt maturing within 12 months" note="By final maturity of each security (coupons excluded)."
              ask={askFor("short-term", `Federal public debt · ${facts.dpfMonth}`)}
              explain={{
                shows: "The share of the federal debt held by the market that reaches final maturity within the next 12 months.",
                read: "A higher share means more debt to refinance soon.",
                now: `Latest: ${facts.maturingShare} (${facts.dpfMonth}).`,
                why: "It is a standard refinancing-risk indicator watched by investors and rating agencies.",
                limits: "Excludes coupons; the Treasury's cash reserve, which can cover maturities, is not shown.",
              }}><Chart option={dpf.st} height={240} label="12m" /></ChartCard>
          </div>
        </>
      )}

      <section className="card p-5" aria-labelledby="interp">
        <div className="flex items-center gap-2"><h2 id="interp" className="text-[15px] font-semibold text-ink">{"How to read these indicators"}</h2><BasisTag basis="statistical" /></div>
        <div className="prose-lab text-[14px]">
          <ul>
            <li>{"Long real yields reflect expected monetary policy, risk premia and global conditions; the site does not decompose these components or attribute causes to specific moves."}</li>
            <li>{"There is no composite sovereign-risk score or default probability: the site prefers direct indicators, each with its source and date."}</li>
            <li>{`Data fetched on ${f.date(manifest.sources["sgs.selic_target"]?.last_success_at?.slice(0, 10))}. Monthly series are published with a 1–2 month lag.`}</li>
          </ul>
        </div>
      </section>
      <Notice>{"Sources: BCB SGS (series 432, 1178, 4389, 13522, 13762, 4513, 5793, 5727), BCB Focus, Tesouro Transparente (DPF stock)."}</Notice>
    </div>
  );
}
