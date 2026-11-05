import { useMemo, useState } from "react";
import { Chart } from "../charts/Chart";
import { axisStyle, grid, legend, lineSeries, row, tooltip } from "../charts/base";
import { shortName, useCore } from "../data/core";
import { useData } from "../data/load";
import type { Macro, Security } from "../data/types";
import { runScenario, irRate } from "../engine/scenario";
import { useFmt } from "../format";
import { useTheme } from "../theme";
import { ChartCard, DataTable, Field, Notice, PageHeader, Slider } from "../ui/kit";
import { Assume, defaultAssume, scenarioInput } from "./scenarioBase";

type Kind = "tesouro" | "cdb" | "lci";
interface Slot { kind: Kind; id: string; pctCdi: number }

interface Out {
  label: string; gross: number; net: number; netPa: number; realPa: number | null; liquidity: string; inflation: string; sensitivity: string;
  structure: string; tax: string; issuer: string; earlySale: string; heldToMaturity: boolean; path: [number, number][];
}

const LETTERS = ["A", "B", "C"];

function bankProduct(kind: Kind, pctCdi: number, a: Assume, assumptionsIr: (d: number) => number, horizonYears: number) {
  const cdi = a.selicPa; // CDI assumed equal to the assumed Selic path (historically within ~0.1 pp)
  const r = (cdi / 100) * (pctCdi / 100);
  const days = Math.round(horizonYears * 365.25);
  const du = Math.round(horizonYears * 252);
  const gross = a.amount * Math.pow(1 + r, du / 252);
  const gain = gross - a.amount;
  const tax = kind === "cdb" && a.applyTaxes ? assumptionsIr(days) * gain : 0;
  return { gross, net: gross - tax };
}

export default function Compare() {
  const { securities, latestById, latest, assumptions, byId } = useCore();
  const macro = useData<Macro>("macro.json");
  const f = useFmt();
  const { tokens } = useTheme();
  const colors = [tokens.nominal, tokens.real, tokens.floating]; // position colours A/B/C

  const offered = useMemo(() => securities.filter((s) => s.active && s.modelled && latestById.get(s.id)?.buy_offered), [securities, latestById]);
  const pick = (code: string, y: number) => offered.filter((s) => s.code === code).sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y))[0]?.id;
  const [slots, setSlots] = useState<Slot[]>(() => [
    { kind: "tesouro", id: pick("LFT", 2029) ?? offered[0].id, pctCdi: 100 },
    { kind: "tesouro", id: pick("LTN", 2029) ?? offered[0].id, pctCdi: 100 },
    { kind: "tesouro", id: pick("NTNBP", 2029) ?? offered[0].id, pctCdi: 100 },
  ]);
  const focusIpca = macro.data?.focus.latest.find((x) => x.indicator === "IPCA" && x.year === Number(latest.date.slice(0, 4)) + 1)?.median ?? null;
  const selic = macro.data ? macro.data.series.selic_target.values.at(-1) ?? null : null;
  const [a, setA] = useState<Assume | null>(null);
  const A = a ?? defaultAssume(focusIpca, selic);
  const set = (p: Partial<Assume>) => setA({ ...A, ...p });
  const upd = (i: number, p: Partial<Slot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const outs: Out[] = useMemo(() => slots.map((sl) => {
    const steps = [0.5, 1, 2, 3, 5, 7, 10].filter((h) => h < A.horizonYears).concat([A.horizonYears]);
    if (sl.kind !== "tesouro") {
      const r = bankProduct(sl.kind, sl.pctCdi, A, (d) => irRate(d, assumptions), A.horizonYears);
      const yrs = A.horizonYears;
      const netPa = (Math.pow(r.net / A.amount, 1 / yrs) - 1) * 100;
      return {
        label: `${sl.kind === "cdb" ? "CDB" : "LCI/LCA"} ${f.num(sl.pctCdi, 0)}% CDI`, gross: r.gross, net: r.net, netPa,
        realPa: ((1 + netPa / 100) / (1 + A.inflationPa / 100) - 1) * 100,
        liquidity: "Per contract (assumed held to the horizon)",
        inflation: "No (floating, CDI-linked)", sensitivity: "≈ 0",
        structure: "Paid at maturity",
        tax: sl.kind === "cdb" ? "Regressive income tax" : "Income-tax exempt for individuals (assumption)",
        issuer: "Credit risk of the issuing bank; FGC deposit insurance subject to limits",
        earlySale: "Early redemption may be unavailable", heldToMaturity: true,
        path: steps.map((h) => [h, bankProduct(sl.kind, sl.pctCdi, A, (d) => irRate(d, assumptions), h).net]),
      };
    }
    const s = byId.get(sl.id)!;
    const lr = latestById.get(sl.id)!;
    const inp = scenarioInput(s, lr, latest, A)!;
    const r = runScenario(inp, assumptions);
    return {
      label: shortName(s), gross: r.grossValue, net: r.netValue, netPa: r.netReturnPaPct,
      realPa: s.indexer === "ipca" ? r.realNetReturnPaPct : ((1 + r.netReturnPaPct / 100) / (1 + A.inflationPa / 100) - 1) * 100,
      liquidity: "Daily, at market price (sale rate)",
      inflation: s.indexer === "ipca" ? "Yes (IPCA + real rate)" : s.indexer === "selic" ? "Indirect (tracks Selic)" : "No (fixed nominal rate)",
      sensitivity: lr.modified == null ? "–" : s.indexer === "selic" ? `≈ 0 ${("to Selic")}; ${("spread")} ${f.num(lr.modified, 2)}` : `${f.num(lr.modified, 2)}`,
      structure: s.coupon === "none" ? "Paid at maturity" : s.coupon === "semiannual" ? "Semiannual coupons" : "Monthly income after conversion",
      tax: "Regressive income tax; IOF < 30 days",
      issuer: "Sovereign risk (National Treasury)",
      earlySale: s.indexer === "selic" ? "Low: spread (premium/discount) changes only" : lr.modified != null && lr.modified > 1 ? `Yes: ~${f.num(lr.modified, 1)}% price move per 100 bp` : "Low",
      heldToMaturity: r.heldToMaturity,
      path: steps.map((h) => [h, runScenario({ ...inp, horizonYears: h }, assumptions).netValue]),
    };
  }), [slots, A, assumptions, byId, latestById, latest, f]);

  const pathOpt = useMemo(() => ({
    grid: grid({ top: 36 }), legend: legend(tokens),
    tooltip: { ...tooltip(tokens), formatter: (ps: { seriesName: string; value: number[]; color: string }[]) => `<div style="opacity:.7;margin-bottom:4px">${f.num(ps[0].value[0], 1)} ${("years")}</div>` + ps.map((p) => row(p.color, f.brl(p.value[1], 0), p.seriesName)).join("") },
    xAxis: { type: "value", name: ("Horizon (years)"), nameLocation: "middle", nameGap: 26, min: 0, ...axisStyle(tokens) },
    yAxis: { type: "value", scale: true, ...axisStyle(tokens), axisLabel: { color: tokens.muted, formatter: (v: number) => f.compact(v) } },
    series: outs.map((o, i) => lineSeries(`${LETTERS[i]} · ${o.label}`, colors[i], [[0, A.amount], ...o.path], { showSymbol: true, symbolSize: 8, itemStyle: { color: colors[i], borderColor: tokens.surface, borderWidth: 2 } })),
  }), [outs, tokens, f, A.amount, colors]);

  const best = outs.reduce((a, b) => (b.net > a.net ? b : a), outs[0]);
  const worst = outs.reduce((a, b) => (b.net < a.net ? b : a), outs[0]);
  const facts: Record<string, string> = {
    horizon: `${f.num(A.horizonYears, 1)} years`, ipca: f.pct(A.inflationPa, 1), selic: f.pct(A.selicPa), shock: f.bp(A.shockBp),
    amount: f.brl(A.amount, 0), assumptionsVersion: assumptions.version, reference: f.date(latest.date), dataAsOf: f.date(latest.date),
    ...Object.fromEntries(outs.map((o, i) => [`net${LETTERS[i]}`, `${o.label}: ${f.brl(o.net, 0)} (${f.pct(o.realPa)} real a year)`])),
  };

  const rowsDef: { key: string; label: string; render: (o: Out) => string }[] = [
    { key: "gross", label: "Gross value at horizon", render: (o) => f.brl(o.gross, 0) },
    { key: "net", label: "Estimated net value", render: (o) => f.brl(o.net, 0) },
    { key: "netpa", label: "Net % p.a. (nominal)", render: (o) => f.pct(o.netPa) },
    { key: "real", label: "Net real % p.a. (deflated by assumed IPCA)", render: (o) => f.pct(o.realPa) },
    { key: "liq", label: "Liquidity", render: (o) => (o.liquidity) },
    { key: "inf", label: "Inflation protection", render: (o) => (o.inflation) },
    { key: "dur", label: "Modified duration (sensitivity)", render: (o) => o.sensitivity },
    { key: "early", label: "Early-sale risk", render: (o) => (o.earlySale) },
    { key: "pay", label: "Payment structure", render: (o) => (o.structure) },
    { key: "tax", label: "Taxation", render: (o) => (o.tax) },
    { key: "iss", label: "Issuer and risk", render: (o) => (o.issuer) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Fixed-income comparison" title="Three investments, the same assumptions">
        {"Compare up to three alternatives over the same horizon with the same inflation and Selic paths. Nominal and real rates are not compared directly: every result is converted to a final value and a real return using the assumed IPCA."}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        {slots.map((sl, i) => (
          <div key={i} className="card space-y-3 p-4" style={{ borderTop: `3px solid ${colors[i]}` }}>
            <div className="text-[13px] font-semibold text-ink">{`Investment ${LETTERS[i]}`}</div>
            <Field label="Type" htmlFor={`k${i}`}>
              <select id={`k${i}`} value={sl.kind} onChange={(e) => upd(i, { kind: e.target.value as Kind })}>
                <option value="tesouro">Tesouro Direto</option>
                <option value="cdb">{("Hypothetical CDB (% of CDI)")}</option>
                <option value="lci">{("Hypothetical LCI/LCA (% of CDI)")}</option>
              </select>
            </Field>
            {sl.kind === "tesouro" ? (
              <Field label="Bond" htmlFor={`s${i}`}>
                <select id={`s${i}`} value={sl.id} onChange={(e) => upd(i, { id: e.target.value })}>
                  {offered.map((s: Security) => <option key={s.id} value={s.id}>{shortName(s)} · {f.rateLabel(s.family, latestById.get(s.id)?.buy_rate)}</option>)}
                </select>
              </Field>
            ) : (
              <Slider id={`p${i}`} label="Rate (% of CDI)" value={sl.pctCdi} min={70} max={130} step={1} onChange={(v) => upd(i, { pctCdi: v })} display={`${sl.pctCdi}% CDI`} />
            )}
          </div>
        ))}
      </div>

      <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Amount (R$)" htmlFor="c-amt"><input id="c-amt" type="number" min={100} step={100} value={A.amount} onChange={(e) => set({ amount: Math.max(100, Number(e.target.value) || 0) })} /></Field>
        <Slider id="c-h" label="Horizon" value={A.horizonYears} min={0.5} max={15} step={0.5} onChange={(v) => set({ horizonYears: v })} display={`${f.num(A.horizonYears, 1)} ${("years")}`} />
        <Slider id="c-i" label="Assumed IPCA" value={A.inflationPa} min={0} max={12} step={0.1} onChange={(v) => set({ inflationPa: v })} display={f.pct(A.inflationPa, 1)} />
        <Slider id="c-s" label="Assumed Selic/CDI" value={A.selicPa} min={2} max={20} step={0.25} onChange={(v) => set({ selicPa: v, reinvestPa: v })} display={f.pct(A.selicPa)} />
        <Slider id="c-sh" label="Exit shock (Tesouro)" value={A.shockBp} min={-300} max={300} step={25} onChange={(v) => set({ shockBp: v })} display={f.bp(A.shockBp)} />
      </div>

      <ChartCard basis="scenario" title="Net value along the horizon"
        subtitle="Each point is a full scenario closed at that horizon (bond sold with the same shock)."
        note="Colours identify the position (A, B, C), not the product."
        ask={{ page: "compare", chart: "compare.path", scope: `${outs.map((o, i) => `${LETTERS[i]}: ${o.label}`).join(" · ")} · ${f.num(A.horizonYears, 1)} years`, facts }}
        explain={{
          shows: "The estimated net value (after B3 custody, income tax and IOF) of each alternative if the position were closed at each horizon, using the same amount, inflation and Selic assumptions for all three.",
          read: "Higher is better at a given horizon. Tesouro bonds sold before maturity are valued at today's sale rate plus the exit shock, so their lines reflect mark-to-market risk; bank products are assumed to be held to the horizon.",
          now: outs.length ? `At ${f.num(A.horizonYears, 1)} years: highest net value ${best.label} (${f.brl(best.net, 0)}), lowest ${worst.label} (${f.brl(worst.net, 0)}). Real returns use IPCA ${f.pct(A.inflationPa, 1)} a year.` : undefined,
          why: "Real and nominal yields cannot be compared directly; converting every alternative into a final value under one explicit set of assumptions makes them comparable.",
          limits: "A scenario, not a forecast: the outcome depends on the assumed inflation, Selic path and exit yield. Bank-product rates are user-defined, not real offers, and carry the issuing bank's credit risk.",
        }}>
        <Chart option={pathOpt} height={320} label={("Net value by horizon")} />
      </ChartCard>

      <section className="card overflow-x-auto p-4" tabIndex={0} aria-label={("Side-by-side comparison")}>
        <table className="data min-w-[640px]">
          <thead><tr><th scope="col"></th>{outs.map((o, i) => <th key={i} scope="col"><span style={{ color: colors[i] }} aria-hidden>■ </span>{LETTERS[i]} · {o.label}</th>)}</tr></thead>
          <tbody>{rowsDef.map((r) => <tr key={r.key}><th scope="row" className="!normal-case !tracking-normal text-[12px]">{(r.label)}</th>{outs.map((o, i) => <td key={i}>{r.render(o)}</td>)}</tr>)}</tbody>
        </table>
      </section>

      <Notice>
        {"CDB, LCI and LCA are generic user-defined scenarios, not real bank offers. CDI is assumed equal to the assumed Selic. The LCI/LCA income-tax exemption for individuals and FGC coverage are assumptions to check against current rules. For Tesouro bonds, an exit before maturity uses today's sale rate plus the shock."}
      </Notice>
      <DataTable caption="Assumptions" rowKey={(x) => x.k} rows={[
        { k: "v", a: ("Cost/tax assumption version"), b: `${assumptions.version} (${f.date(assumptions.reference_date)})` },
        { k: "d", a: ("Price reference date"), b: f.date(latest.date) },
        { k: "c", a: ("B3 custody"), b: A.applyCosts ? ("included") : ("excluded") },
      ]} columns={[{ key: "a", label: "Item", render: (x) => x.a }, { key: "b", label: "Value", render: (x) => x.b }]} />
    </div>
  );
}
