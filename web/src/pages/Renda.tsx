import { useMemo, useState } from "react";
import { Chart } from "../charts/Chart";
import { axisStyle, grid, legend, row, tooltip } from "../charts/base";
import { shortName, useCore } from "../data/core";
import { useData } from "../data/load";
import type { Macro } from "../data/types";
import { parseISO, toISO } from "../engine/dates";
import { amortisationRates, cashflowSchedule } from "../engine/instruments";
import { accumulate } from "../engine/renda";
import { runScenario } from "../engine/scenario";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { AskButton, Term } from "../ui/explain";
import { ChartCard, DataTable, Field, Notice, PageHeader, Segmented, Slider, Stat } from "../ui/kit";
import { defaultAssume, scenarioInput } from "./scenarioBase";

const TA = amortisationRates(240)[0];
const SHOCKS = [-200, -100, 0, 100, 200];

export default function Renda() {
  const { securities, latestById, latest, assumptions, byId } = useCore();
  const macro = useData<Macro>("macro.json");
  const f = useFmt();
  const { tokens } = useTheme();
  const vna = latest.vna.ipca.base.consensus ?? 0;
  const d0 = parseISO(latest.date);

  const renda = useMemo(() => securities.filter((s) => s.code === "RENDA" && s.active).sort((a, b) => a.maturity.localeCompare(b.maturity)), [securities]);
  const [id, setId] = useState(() => renda.find((s) => s.year === 2065)?.id ?? renda[renda.length - 1].id);
  const sec = byId.get(id)!;
  const lr = latestById.get(id)!;
  const incomePerUnit = (vna * TA) / 100; // per month, today's reais

  const focusIpca = macro.data?.focus.latest.find((x) => x.indicator === "IPCA" && x.year === Number(latest.date.slice(0, 4)) + 1)?.median ?? 4;
  const [ipca, setIpca] = useState<number | null>(null);
  const IPCA = ipca ?? Math.round(focusIpca * 10) / 10;
  const [monthly, setMonthly] = useState(500);
  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const realRate = rateOverride ?? lr.buy_rate ?? 7;
  const conv = parseISO(sec.conversion!);
  const monthsToConv = Math.max(1, Math.round((conv - d0) / 30.44) - 1);
  const [months, setMonths] = useState<number | null>(null);
  const M = Math.min(months ?? Math.min(120, monthsToConv), monthsToConv);
  const [view, setView] = useState<"real" | "nominal">("real");

  const lineup = useMemo(() => renda.map((s) => {
    const r = latestById.get(s.id)!;
    return { s, r, costPerReal: r.buy_price ? r.buy_price / incomePerUnit : null };
  }), [renda, latestById, incomePerUnit]);

  const acc = useMemo(() => accumulate({
    code: "RENDA", maturity: parseISO(sec.maturity), d0, vna0: vna, realRate, monthly, months: M, ipca: IPCA, applyCosts: true, applyTaxes: true,
  }, assumptions), [sec, d0, vna, realRate, monthly, M, IPCA, assumptions]);

  const ipcaZero = useMemo(() => securities.filter((s) => s.code === "NTNBP" && s.active).map((s) => ({ s, r: latestById.get(s.id)! })), [securities, latestById]);
  const curveOpt = useMemo(() => ({
    grid: grid({ top: 36, bottom: 30 }), legend: { ...legend(tokens), icon: "circle", itemWidth: 8, itemHeight: 8 },
    tooltip: { ...tooltip(tokens, "item"), formatter: (p: { seriesName: string; value: number[]; color: string }) => row(p.color, `IPCA + ${f.pct(p.value[1])}`, `${p.seriesName} · ${Math.round(p.value[0])}`) },
    xAxis: { type: "value", min: 2025, name: "Year (Renda+ first payment / IPCA+ maturity)", nameLocation: "middle", nameGap: 26, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => String(v) } },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => `${f.num(v, 1)}%` } },
    series: [
      { name: "Renda+", type: "scatter", symbol: "triangle", symbolSize: 11, itemStyle: { color: tokens.ntnb1, borderColor: tokens.surface, borderWidth: 2 }, data: lineup.map((x) => [x.s.year, x.r.buy_rate]) },
      { name: "IPCA+ (zero-coupon)", type: "scatter", symbolSize: 10, itemStyle: { color: tokens.real, borderColor: tokens.surface, borderWidth: 2 }, data: ipcaZero.map((x) => [Number(x.s.maturity.slice(0, 4)) + Number(x.s.maturity.slice(5, 7)) / 12, x.r.buy_rate]) },
    ],
  }), [ipcaZero, lineup, tokens, f]);

  const calOpt = useMemo(() => {
    const per: Record<string, number> = {};
    for (const fl of cashflowSchedule("RENDA", parseISO(sec.maturity))) {
      const y = toISO(fl.day).slice(0, 4);
      const real = (acc.units * vna * fl.amount) / 100;
      per[y] = (per[y] ?? 0) + (view === "real" ? real : real * Math.pow(1 + IPCA / 100, (fl.day - d0) / 365.25));
    }
    const ys = Object.keys(per);
    return {
      grid: grid(), tooltip: { ...tooltip(tokens, "item"), formatter: (p: { name: string; value: number }) => row(tokens.ntnb1, f.brl(p.value, 0), `${p.name} · ${view === "real" ? "today's reais, gross" : "nominal, gross"}`) },
      xAxis: { type: "category", data: ys, ...axisStyle(tokens), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
      series: [{ type: "bar", barMaxWidth: 24, data: ys.map((y) => per[y]), itemStyle: { color: tokens.ntnb1, borderRadius: [4, 4, 0, 0] } }],
    };
  }, [sec, acc.units, vna, view, IPCA, d0, tokens, f]);

  const early = useMemo(() => {
    const base = defaultAssume(IPCA, null);
    const inp = scenarioInput(sec, lr, latest, { ...base, inflationPa: IPCA, reinvestPa: 0 });
    if (!inp) return [];
    return [1, 3, 5, 10].map((h) => ({ h, cells: SHOCKS.map((s) => runScenario({ ...inp, horizonYears: h, shockBp: s }, assumptions).realNetReturnPaPct) }));
  }, [sec, lr, latest, IPCA, assumptions]);

  const ntnbNear = useMemo(() => {
    const target = Number(sec.conversion!.slice(0, 4));
    return ipcaZero.map((x) => x.s).sort((a, b) => Math.abs(Number(a.maturity.slice(0, 4)) - target) - Math.abs(Number(b.maturity.slice(0, 4)) - target))[0];
  }, [ipcaZero, sec]);
  const nb = ntnbNear ? latestById.get(ntnbNear.id) : null;

  // Facts shared with the explanations and the Q&A panel (all from the snapshot or the simulator).
  const name = shortName(sec);
  const facts = {
    bond: name, date: f.date(latest.date), modified: f.num(lr.modified, 1), convexity: f.num(lr.convexity, 0), dv01: f.brl(lr.dv01_brl, 3),
    ipca: f.pct(IPCA, 1), gross: f.brl(acc.grossIncomeReal, 0), net: f.brl(acc.averageNetReal, 0), dataAsOf: f.date(latest.date),
    firstTaxRate: f.pct(acc.first.effectiveTaxRate * 100, 1), paymentsAbove15: String(acc.paymentsAboveLowestRate),
    youngestLotDays: String(acc.youngestLotDaysAtFirstPayment), months: String(M), conversion: f.date(sec.conversion),
  } as Record<string, string>;
  const cheapest = lineup.reduce((a, b) => ((b.costPerReal ?? 1e9) < (a.costPerReal ?? 1e9) ? b : a), lineup[0]);
  const earlyTen = early.find((r) => r.h === 10);
  const earlyOne = early.find((r) => r.h === 1);
  const scope = `${name} · data as of ${f.date(latest.date)}`;

  return (
    <div className="space-y-5">
      <PageHeader kicker="Renda+ planning" title="Tesouro Renda+ Aposentadoria Extra">
        <Term k="renda">Tesouro Renda+</Term> (NTN-B1) pays 240 IPCA-indexed monthly instalments from January of the year in its name until December 19 years later.
        Each unit pays 0.416666% of the inflation-updated nominal value (<Term k="vna">VNA</Term>) per month, about <b className="tnum text-ink">{f.brl(incomePerUnit)}</b> per unit in today's reais.
      </PageHeader>

      <ChartCard basis="observed" title="Securities on offer" subtitle={`Prices and rates on ${f.date(latest.date)}. The official maturity in the Tesouro Transparente data is the final instalment date.`}
        ask={{ page: "renda", chart: "renda.lineup", scope, facts, product: "RENDA" }}
        explain={{
          shows: "Every Renda+ bond currently offered: the first and last instalment dates, the purchase rate (real yield above IPCA), the unit price, the price of R$ 1 of monthly income in today's reais, and modified duration. Source: Tesouro Transparente daily rates and prices.",
          read: "The year in each name is the conversion year, when payments start; the final instalment is 19 years and 11 months later. 'Cost per R$ 1 of monthly income' divides the price by the monthly payment per unit at today's VNA, so lower means cheaper income — mostly because later conversion dates are discounted for longer.",
          now: `${shortName(cheapest.s)} has the lowest cost per R$ 1 of monthly income (${f.brl(cheapest.costPerReal)}), and purchase rates range from IPCA + ${f.pct(Math.min(...lineup.map((x) => x.r.buy_rate ?? 99)))} to IPCA + ${f.pct(Math.max(...lineup.map((x) => x.r.buy_rate ?? 0)))}.`,
          why: "Renda+ converts a lump sum or regular contributions into inflation-protected monthly income for 20 years. Comparing conversion years shows the trade-off between waiting longer and paying less per real of income.",
          limits: "Cheaper income for later conversion dates comes with much longer duration, so their sale value before conversion is far more volatile. Prices are for one day and change daily.",
        }}>
        <DataTable caption="Renda+ securities" rowKey={(x) => x.s.id} rows={lineup} selected={id} onRowClick={(x) => setId(x.s.id)} columns={[
          { key: "n", label: "Bond", render: (x) => <span className="text-ink">{shortName(x.s)}</span> },
          { key: "c", label: "First instalment", render: (x) => f.date(x.s.conversion) },
          { key: "m", label: "Final instalment", render: (x) => f.date(x.s.maturity) },
          { key: "r", label: "Purchase rate", num: true, render: (x) => `IPCA + ${f.pct(x.r.buy_rate)}` },
          { key: "p", label: "Price", num: true, render: (x) => f.brl(x.r.buy_price) },
          { key: "k", label: "Cost per R$ 1 of monthly income", num: true, render: (x) => f.brl(x.costPerReal) },
          { key: "d", label: "Mod. dur.", num: true, render: (x) => f.num(x.r.modified, 1) },
        ]} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard basis="observed" title="Renda+ versus conventional IPCA+"
          ask={{ page: "renda", chart: "renda.vs-ipca", scope, facts, product: "RENDA" }}
          explain={{
            shows: `Purchase real yields on ${f.date(latest.date)}: Renda+ bonds (violet triangles) at the year their payments start, and zero-coupon Tesouro IPCA+ bonds (orange circles) at their maturity year.`,
            read: "Both are real yields above IPCA, so they can be compared directly. Points higher up pay more above inflation. Renda+ is plotted at its first payment, although its cash flows continue for 20 more years.",
            now: nb ? `${name} yields IPCA + ${f.pct(lr.buy_rate)} with modified duration ${f.num(lr.modified, 1)}; the IPCA+ bond maturing closest to its conversion year (${shortName(ntnbNear)}) yields IPCA + ${f.pct(nb.buy_rate)} with modified duration ${f.num(nb.modified, 1)}.` : undefined,
            why: "Renda+ and long IPCA+ bonds price off the same long-term real yield curve; differences reflect cash-flow timing and the extra duration of the 20-year payment period.",
            limits: "Plotting at the first payment year understates how long Renda+ cash flows last. A yield difference is not by itself a mispricing; liquidity, demand and custody rules differ between the products.",
          }}>
          <Chart option={curveOpt} height={300} label="Renda+ and IPCA+ real yields by year" />
        </ChartCard>
        <section className="card p-5" aria-labelledby="cmp">
          <h2 id="cmp" className="text-[15px] font-semibold text-ink">{name} vs. similar-dated IPCA+</h2>
          <dl className="mt-3 grid grid-cols-3 gap-y-2 text-[13px]">
            <dt className="text-muted"></dt><dd className="font-medium text-ink">Renda+ {sec.year}</dd><dd className="font-medium text-ink">{ntnbNear ? shortName(ntnbNear) : "–"}</dd>
            <dt className="text-muted">Real rate</dt><dd className="tnum">{f.pct(lr.buy_rate)}</dd><dd className="tnum">{f.pct(nb?.buy_rate)}</dd>
            <dt className="text-muted"><Term k="modified">Modified duration</Term></dt><dd className="tnum">{f.num(lr.modified, 1)}</dd><dd className="tnum">{f.num(nb?.modified, 1)}</dd>
            <dt className="text-muted">Cash flows</dt><dd>240 monthly instalments</dd><dd>single payment</dd>
            <dt className="text-muted"><Term k="custody">B3 custody</Term></dt><dd>0% if held; 0.10% of each payment above 6 minimum wages; 0.50%/0.20%/0.10% p.a. on early sales by holding period</dd><dd>0.20% p.a.</dd>
          </dl>
          <p className="mt-3 text-[12px] text-muted">Very long duration means large price swings before conversion: see the early-sale table below.</p>
        </section>
      </div>

      <section className="card p-4 sm:p-5" aria-labelledby="acc">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div><h2 id="acc" className="text-[15px] font-semibold text-ink">Accumulation simulator</h2>
            <p className="text-[13px] text-muted">Constant monthly contributions in today's reais (indexed to IPCA), each bought at the assumed real rate.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <AskButton ctx={{ page: "renda", chart: "renda.accumulation", title: "Accumulation simulator", scope, facts, product: "RENDA" }} />
            <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink2">▲ Hypothetical scenario</span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Bond" htmlFor="r-sec"><select id="r-sec" value={id} onChange={(e) => { setId(e.target.value); setMonths(null); }}>{renda.map((s) => <option key={s.id} value={s.id}>{shortName(s)}</option>)}</select></Field>
          <Field label="Monthly contribution (today's R$)" htmlFor="r-m"><input id="r-m" type="number" min={50} step={50} value={monthly} onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))} /></Field>
          <Slider id="r-n" label="Months of contributions" value={M} min={1} max={monthsToConv} step={1} onChange={setMonths} display={`${M} (${f.num(M / 12, 1)} years)`} />
          <Slider id="r-r" label="Real rate on purchases" value={realRate} min={3} max={10} step={0.05} onChange={setRateOverride} display={`IPCA + ${f.pct(realRate)}`} />
          <Slider id="r-i" label="Assumed IPCA" value={IPCA} min={0} max={12} step={0.1} onChange={setIpca} display={f.pct(IPCA, 1)} />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total contributed (today's R$)" value={f.brl(acc.contributedReal, 0)} sub={`${f.num(acc.units, 2)} units`} />
          <Stat label="Gross monthly income (today's R$)" value={f.brl(acc.grossIncomeReal, 0)} sub={`for ${acc.payments} months`} />
          <Stat label="Net monthly income after IR and custody" value={f.brl(acc.averageNetReal, 0)} sub="estimate: average over the 240 payments, today's R$" />
          <Stat label="First payment, nominal (gross)" value={f.brl(acc.firstNominalGross, 0)} sub={f.date(sec.conversion)} />
        </div>
        <div className="mt-3 overflow-x-auto" data-testid="renda-breakdown" tabIndex={0} role="region" aria-label="Monthly income breakdown">
          <table className="data min-w-[480px]">
            <caption className="sr-only">Monthly income breakdown</caption>
            <thead><tr><th scope="col">Per month, today's reais</th><th scope="col" className="num">First payment</th><th scope="col" className="num">Average of 240</th></tr></thead>
            <tbody>
              <tr><td>Gross instalment</td><td className="num">{f.brl(acc.first.grossReal)}</td><td className="num">{f.brl(acc.averageNetReal + acc.averageIncomeTaxReal + acc.averageCustodyReal)}</td></tr>
              <tr><td>Income tax (regressive rate by the age of each purchase)</td><td className="num">{f.brl(-acc.first.incomeTaxReal)}</td><td className="num">{f.brl(-acc.averageIncomeTaxReal)}</td></tr>
              <tr><td>B3 custody (0.10% of the amount above 6 minimum wages)</td><td className="num">{f.brl(-acc.first.custodyReal)}</td><td className="num">{f.brl(-acc.averageCustodyReal)}</td></tr>
              <tr><td className="text-ink">Net income</td><td className="num text-ink">{f.brl(acc.first.netReal)}</td><td className="num text-ink">{f.brl(acc.averageNetReal)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 overflow-x-auto" data-testid="renda-tax-lots" tabIndex={0} role="region" aria-label="Income tax on the first payment by purchase age">
          <table className="data min-w-[480px]">
            <caption className="text-left text-[12px] text-muted">Income tax on the first payment ({f.date(sec.conversion)}) by the age of each monthly purchase</caption>
            <thead><tr><th scope="col">Purchase age on the payment date</th><th scope="col" className="num">Rate</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Share of units</th><th scope="col" className="num">Tax (today's R$)</th></tr></thead>
            <tbody>{acc.first.brackets.map((b) => {
              const label = b.rate >= 0.225 ? "Up to 180 days" : b.rate >= 0.2 ? "181 to 360 days" : b.rate >= 0.175 ? "361 to 720 days" : "More than 720 days";
              const toReal = acc.firstNominalGross > 0 ? acc.first.grossReal / acc.firstNominalGross : 0; // deflate to today's reais
              return <tr key={b.rate}><td>{label}</td><td className="num">{f.pct(b.rate * 100, 1)}</td><td className="num">{b.lots}</td>
                <td className="num">{f.pct((b.units / acc.units) * 100, 1)}</td>
                <td className="num">{f.brl(-b.taxNominal * toReal)}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[13px] leading-relaxed text-ink2" data-testid="renda-acc-now">
          <span className="font-semibold text-ink">What the data shows: </span>
          {`Contributing ${f.brl(monthly, 0)} a month (today's reais) for ${M} months at IPCA + ${f.pct(realRate)} buys ${f.num(acc.units, 2)} units of ${name}, which pay about ${f.brl(acc.grossIncomeReal, 0)} a month in today's reais from ${f.date(sec.conversion)}, or ${f.brl(acc.averageNetReal, 0)} after simulated income tax and custody. `}
          {acc.custodyApplies
            ? `The income is above the custody threshold of 6 minimum wages (${f.brl(acc.thresholdReal, 0)} in today's reais), so 0.10% of the excess is deducted from each payment.`
            : `The income is at or below the custody threshold of 6 minimum wages (${f.brl(acc.thresholdReal, 0)} in today's reais), so no custody is charged while the bond is held.`}
          {" "}
          <span data-testid="renda-tax-now">{acc.paymentsAboveLowestRate > 0
            ? `Income tax depends on how long each purchase has been held: the most recent purchase is only ${acc.youngestLotDaysAtFirstPayment} days old at the first payment, so the first payment is taxed at an effective ${f.pct(acc.first.effectiveTaxRate * 100, 1)} of its gain, and ${acc.paymentsAboveLowestRate} instalments are paid before every purchase reaches the 15% bracket (more than 720 days).`
            : `Every purchase has been held for more than 720 days at the first payment, so each instalment's gain is taxed at 15%.`}</span>
        </div>
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-ink2 hover:text-ink">Understand this simulation</summary>
          <dl className="mt-2 grid gap-2 leading-relaxed text-ink2">
            <div><dt className="font-semibold text-ink">What it shows</dt><dd>The income a stream of monthly purchases would buy, assuming every purchase happens at the same real rate and contributions rise with inflation.</dd></div>
            <div><dt className="font-semibold text-ink">How to read it</dt><dd>All income figures are in today's reais: inflation-indexed payments keep their purchasing power, so the real amount is constant and the nominal amount grows with IPCA. Each monthly contribution is a separate purchase. On every instalment, each purchase pays income tax on its own gain at the regressive rate for its age, counted from its settlement date: 22.5% up to 180 days, 20% up to 360, 17.5% up to 720 and 15% beyond. B3 custody of 0.10% applies to the part of each payment above 6 minimum wages, with the minimum wage assumed to keep pace with inflation.</dd></div>
            <div><dt className="font-semibold text-ink">Why it matters</dt><dd>It translates a savings plan into the retirement income it would buy, the way Renda+ is designed to be used.</dd></div>
            <div><dt className="font-semibold text-ink">Key limitations</dt><dd>The net figures are an estimate. Official sources fix the tax table and that holding periods run from settlement, but they do not state how the purchase cost is split across the 240 instalments; the simulator assumes each instalment returns the same share of every purchase's cost. Future purchase rates will not stay constant; a lower real rate means fewer units and less income. Broker fees, changes in tax law and the actual minimum-wage path are not modelled.</dd></div>
          </dl>
        </details>
      </section>

      <ChartCard basis="scenario" title="Payment calendar" subtitle={`${name}: annual sum of the 12 gross instalments for the simulated holding`}
        actions={<Segmented label="Values" value={view} onChange={setView} options={[{ value: "real", label: "Today's reais" }, { value: "nominal", label: "Nominal (assumed IPCA)" }]} />}
        ask={{ page: "renda", chart: "renda.calendar", scope, facts, product: "RENDA" }}
        explain={{
          shows: `Gross annual income from the simulated ${f.num(acc.units, 2)} units of ${name}, from ${f.date(sec.conversion)} to ${f.date(sec.maturity)}: 240 monthly instalments of 0.416666% of the VNA each.`,
          read: "In today's reais every full year is the same height, because payments are indexed to IPCA. Switch to nominal to see the amounts in future reais, growing with the inflation assumption.",
          now: `Each full year pays about ${f.brl(acc.grossIncomeReal * 12, 0)} gross in today's reais; in nominal terms the first year pays about ${f.brl(acc.firstNominalGross * 12, 0)} at ${f.pct(IPCA, 1)} IPCA.`,
          why: "It shows when the income arrives and how inflation indexation preserves purchasing power over two decades.",
          limits: "Gross amounts before income tax and custody (see the breakdown above). Nominal values depend entirely on the inflation assumption.",
        }}>
        <Chart option={calOpt} height={260} label="Renda+ payment calendar" />
      </ChartCard>

      <ChartCard basis="scenario" title="Early sale: net real return % p.a."
        subtitle={`Buy today at IPCA + ${f.pct(lr.buy_rate)}, sell after the horizon at today's sale rate + shock. IPCA ${f.pct(IPCA, 1)}, no reinvestment, custody and income tax included.`}
        ask={{ page: "renda", chart: "renda.early", scope, facts, product: "RENDA" }}
        explain={{
          shows: `Annualised real return after costs and taxes if ${name} is bought today and sold before conversion, for horizons of 1 to 10 years and sale yields from 200 bp below to 200 bp above today's sale rate.`,
          read: "Each cell is a complete scenario. Columns change the yield at which you sell; rows change how long you hold. Negative shocks (yields fall) raise the sale price; positive shocks lower it.",
          now: earlyOne && earlyTen ? `Selling after 1 year at an unchanged sale rate returns ${f.pct(earlyOne.cells[2])} a year in real terms, versus ${f.pct(earlyOne.cells[4])} if yields rise 200 bp; over 10 years the same range narrows to ${f.pct(earlyTen.cells[4])} to ${f.pct(earlyTen.cells[0])}.` : undefined,
          why: `With modified duration around ${f.num(lr.modified, 0)}, small yield moves change the sale value a lot. Early-sale custody is also highest in the first ten years (0.50% p.a. on the value sold).`,
          limits: "A single shock applied at the sale date, constant IPCA, and no reinvestment; not a forecast of where yields will be. Holding to the payment dates avoids these price effects.",
        }}>
        <DataTable caption="Early-sale scenarios" rowKey={(r) => String(r.h)} rows={early} columns={[
          { key: "h", label: "Horizon", render: (r) => `${r.h} ${r.h === 1 ? "year" : "years"}` },
          ...SHOCKS.map((s, j) => ({ key: String(s), label: f.bp(s), num: true, render: (r: { cells: (number | null)[] }) => f.pct(r.cells[j]) })),
        ]} />
      </ChartCard>

      <Notice>Hypothetical, generic values: they do not represent any investor's position. Illustrative taxation for a Brazilian-resident individual; check current Tesouro Direto and B3 rules.</Notice>
    </div>
  );
}
