// TypeScript engine parity with the validated Python engine (golden vectors)
// and with the official Tesouro Nacional worked examples.
import golden from "./__fixtures__/golden.json";
import official from "../../../tests/fixtures/official_examples.json";
import assumptions from "../../../config/assumptions/br_costs_taxes_v2026-11.json";
import reference from "../../../tests/fixtures/reference_cases.json";
import { businessDays, settlementDate } from "./calendar";
import { parseISO, toISO } from "./dates";
import { ProductCode, cashflowSchedule } from "./instruments";
import { futureFlows, modelValue, officialPrice, risk, solveRate } from "./pricing";
import { Assumptions, runScenario } from "./scenario";

const A = assumptions as unknown as Assumptions;
const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

describe("calendar parity", () => {
  it("matches 300 Python du counts across both holiday calendars", () => {
    for (const c of golden.du) expect(businessDays(parseISO(c.start), parseISO(c.end), parseISO(c.asof))).toBe(c.du);
  });
  it("matches settlement dates", () => {
    for (const c of golden.settlement) expect(toISO(settlementDate(parseISO(c.base), 1))).toBe(c.d1);
  });
});

describe("official worked examples", () => {
  it("LTN", () => {
    const e = official.ltn;
    expect(officialPrice("LTN", parseISO(e.maturity), parseISO(e.settlement), e.rate).pu).toBeCloseTo(e.pu, 9);
  });
  it("NTN-F", () => {
    const e = official.ntnf;
    expect(officialPrice("NTNF", parseISO(e.maturity), parseISO(e.settlement), e.rate).pu).toBeCloseTo(e.pu, 9);
  });
  it("NTN-B", () => {
    const e = official.ntnb;
    const r = officialPrice("NTNB", parseISO(e.maturity), parseISO(e.settlement), e.rate, e.vna_proj);
    expect(r.cotacao).toBeCloseTo(e.cotacao, 12);
    expect(r.pu).toBeCloseTo(e.pu, 9);
  });
  it("Renda+ 2030: 240 DU values and price", () => {
    const e = official.renda2030;
    const f = futureFlows("RENDA", parseISO(e.maturity), parseISO(e.settlement));
    expect(f.map((x) => x.du)).toEqual(e.table.map((r) => r.du));
    const r = officialPrice("RENDA", parseISO(e.maturity), parseISO(e.settlement), e.rate, e.vni_proj);
    expect(r.cotacao).toBeCloseTo(e.cotacao, 12);
    expect(r.puTd).toBeCloseTo(e.pu_td, 9);
  });
  it("Educa+ 2030 price", () => {
    const e = official.educa2030;
    expect(officialPrice("EDUCA", parseISO(e.maturity), parseISO(e.settlement), e.rate, e.vni_proj).puTd).toBeCloseTo(e.pu_td, 9);
  });
});

describe("schedules and pricing parity", () => {
  it("schedules", () => {
    for (const s of golden.schedules) {
      const f = cashflowSchedule(s.code as ProductCode, parseISO(s.maturity));
      expect(f.length).toBe(s.n);
      expect(toISO(f[0].day)).toBe(s.first);
      expect(toISO(f[f.length - 1].day)).toBe(s.last);
      expect(f.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(s.sum, 9);
    }
  });
  it("model value, duration, convexity and official prices", () => {
    for (const c of golden.prices) {
      const code = c.code as ProductCode, m = parseISO(c.maturity), d = parseISO(c.settlement);
      const r = risk(code, m, d, c.rate)!;
      expect(close(modelValue(code, m, d, c.rate), c.model_value, 1e-12)).toBe(true);
      expect(close(r.macaulay, c.macaulay, 1e-12)).toBe(true);
      expect(close(r.modified, c.modified, 1e-12)).toBe(true);
      expect(close(r.convexity, c.convexity, 1e-11)).toBe(true);
      const off = officialPrice(code, m, d, c.rate, code === "LTN" || code === "NTNF" ? null : 4771.175732);
      expect(off.cotacao).toBe(c.official_cotacao);
      expect(off.pu).toBe(c.official_pu);
      expect(solveRate(code, m, d, c.model_value)).toBeCloseTo(c.rate, 8);
    }
  });
});

describe("scenario parity", () => {
  it("reproduces 35 Python scenarios", () => {
    for (const c of golden.scenarios) {
      const i = c.input;
      const r = runScenario({
        code: i.product_code as ProductCode, maturity: parseISO(i.maturity), valuationDate: parseISO(i.valuation_date),
        buyPrice: i.buy_price, buyRate: i.buy_rate, sellRate: i.sell_rate, vna0: i.vna0, amount: i.amount,
        horizonYears: i.horizon_years, shockBp: i.shock_bp, inflationPa: i.inflation_pa, selicPa: i.selic_pa,
        reinvestPa: i.reinvest_pa, applyCosts: i.apply_costs, applyTaxes: i.apply_taxes,
      }, A);
      const e = c.result;
      expect(toISO(r.horizonDate)).toBe(e.horizon_date);
      expect(r.heldToMaturity).toBe(e.held_to_maturity);
      expect(r.events.length).toBe(c.n_events);
      expect(toISO(r.purchaseSettlement)).toBe(e.purchase_settlement);
      expect(r.taxHoldingDays).toBe(e.tax_holding_days);
      for (const [k, py] of [["grossValue", e.gross_value], ["netValue", e.net_value], ["custody", e.custody], ["incomeTax", e.income_tax],
        ["iof", e.iof], ["saleProceeds", e.sale_proceeds], ["immediateSpreadCost", e.immediate_spread_cost], ["custodyAtSale", e.custody_at_sale]] as const) {
        expect(close(r[k] as number, py as number, 1e-9), `${i.product_code} ${i.horizon_years} ${k}: ${r[k]} vs ${py}`).toBe(true);
      }
    }
  });
  it("costs and taxes are deducted exactly once", () => {
    const c = golden.scenarios[1].input;
    const base = {
      code: c.product_code as ProductCode, maturity: parseISO(c.maturity), valuationDate: parseISO(c.valuation_date), buyPrice: c.buy_price,
      buyRate: c.buy_rate, sellRate: c.sell_rate, vna0: c.vna0, amount: 50_000, horizonYears: 3, shockBp: -100, inflationPa: 4.5,
      selicPa: 12.5, reinvestPa: 0,
    };
    const gross = runScenario({ ...base, applyCosts: false, applyTaxes: false }, A);
    const net = runScenario({ ...base, applyCosts: true, applyTaxes: true }, A);
    expect(net.netValue).toBeCloseTo(gross.netValue - net.custody - net.iof - net.incomeTax, 6);
  });
});

describe("independent reference cases (hand-computed, tests/fixtures/reference_cases.json)", () => {
  type Ref = { id: string; input: Record<string, unknown>; expected?: Record<string, number | string>; expected_events?: { date: string; cash: number; custody: number; income_tax: number }[] };
  const map: Record<string, string> = { sale_proceeds: "saleProceeds", custody: "custody", income_tax: "incomeTax", iof: "iof", net_value: "netValue" };
  for (const c of (reference as unknown as { cases: Ref[] }).cases) {
    it(c.id, () => {
      const i = c.input as Record<string, never>;
      const r = runScenario({
        code: i.product_code, maturity: parseISO(i.maturity), valuationDate: parseISO(i.valuation_date), buyPrice: i.buy_price,
        buyRate: i.buy_rate, sellRate: i.sell_rate, vna0: i.vna0, amount: i.amount, horizonYears: i.horizon_years, shockBp: i.shock_bp,
        inflationPa: i.inflation_pa, selicPa: i.selic_pa, reinvestPa: i.reinvest_pa, applyCosts: i.apply_costs, applyTaxes: i.apply_taxes,
      }, A);
      for (const [k, v] of Object.entries(c.expected ?? {})) {
        if (k === "horizon_date") expect(toISO(r.horizonDate)).toBe(v);
        else if (k === "purchase_settlement") expect(toISO(r.purchaseSettlement)).toBe(v);
        else if (k === "tax_holding_days") expect(r.taxHoldingDays).toBe(v);
        else expect(close(r[map[k] as keyof typeof r] as number, v as number, 1e-9), `${c.id} ${k}`).toBe(true);
      }
      for (const e of c.expected_events ?? []) {
        const ev = r.events.find((x) => toISO(x.day) === e.date)!;
        expect(close(ev.cash, e.cash, 1e-9)).toBe(true);
        expect(close(ev.custody, e.custody, 1e-9), `${c.id} custody ${e.date}`).toBe(true);
        expect(close(ev.incomeTax, e.income_tax, 1e-9)).toBe(true);
      }
    });
  }
});
