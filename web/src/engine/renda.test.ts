// Renda+ income: net income includes every simulated deduction; custody threshold
// cases (below / at / above 6 minimum wages) checked against explicit formulas.
import assumptions from "../../../config/assumptions/br_costs_taxes_v2026-11.json";
import { parseISO, toISO } from "./dates";
import { accumulate } from "./renda";
import type { Assumptions } from "./scenario";

const A = assumptions as unknown as Assumptions;
const base = {
  code: "RENDA" as const, maturity: parseISO("2084-12-15"), d0: parseISO("2026-10-30"), vna0: 4771.175732, realRate: 7.28,
  monthly: 500, months: 120, ipca: 4.5, applyCosts: true, applyTaxes: true,
};

describe("Renda+ accumulation and income", () => {
  it("uses the official 240-instalment schedule of Renda+ 2065", () => {
    const r = accumulate(base, A);
    expect(r.payments).toBe(240);
    expect(toISO(r.first.day)).toBe("2065-01-15");
  });

  it("net income = gross - income tax - custody for every instalment (no double count)", () => {
    const r = accumulate(base, A);
    expect(r.first.netReal).toBeCloseTo(r.first.grossReal - r.first.incomeTaxReal - r.first.custodyReal, 9);
    expect(r.averageNetReal).toBeLessThan(r.grossIncomeReal);
  });

  const thr = 6 * 1621; // today's reais (minimum wage indexed to IPCA)
  it.each([
    ["below", 0.5],
    ["at", 1.0],
    ["above", 2.0],
  ])("custody threshold %s 6 minimum wages", (_label, factor) => {
    // Scale the contribution so gross real income = factor x threshold.
    const probe = accumulate({ ...base, monthly: 1000 }, A);
    const monthly = (1000 * thr * factor) / probe.grossIncomeReal;
    const r = accumulate({ ...base, monthly }, A);
    expect(r.grossIncomeReal).toBeCloseTo(thr * factor, 6);
    const expectedCustody = 0.001 * Math.max(0, r.first.grossReal - thr); // explicit formula, real terms
    expect(r.first.custodyReal).toBeCloseTo(expectedCustody, 9);
    expect(r.custodyApplies).toBe(factor > 1);
    // 239 regular instalments (Ta = 0.416666) and a final one of 0.416826 (official rounding rule);
    // at exactly the threshold only the slightly larger final instalment pays custody.
    const g = r.grossIncomeReal;
    const expected = (239 * 0.001 * Math.max(0, g - thr) + 0.001 * Math.max(0, (g * 0.416826) / 0.416666 - thr)) / 240;
    expect(r.averageCustodyReal).toBeCloseTo(expected, 9);
  });

  it("income tax is 15% of the gain part when every lot is older than 720 days (explicit check)", () => {
    const r = accumulate(base, A);
    const k = Math.pow(1.045, (r.first.day - base.d0) / 365.25);
    const payNominal = r.first.grossReal * k;
    const cost = (r.contributedNominal * 0.416666) / 100;
    expect(r.first.incomeTaxReal * k).toBeCloseTo(0.15 * (payNominal - cost), 6);
  });
});

// ---- Lot-aware income tax (Sprint 8) ---------------------------------------------
import lotCases from "../../../tests/fixtures/renda_lot_cases.json";
import { addMonths } from "./dates";
import { cashflowSchedule } from "./instruments";
import { purchaseSettlement } from "./scenario";
import { buildLots, taxInstalment, type Lot } from "./renda";

type LotCase = {
  id: string; input: { pay_day: string; instalment_pct: number; vna_nominal: number; threshold_nominal: number; lots: { settle: string; units: number; cost_nominal: number }[] };
  expected: { gross: number; cost_returned: number; income_tax: number; custody: number; net: number; effective_tax_rate: number; min_age_days: number; lots: { rate: number; income_tax: number }[] };
};
const rel = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
// The official regressive table, written out independently of the engine.
const bracket = (age: number) => (age <= 180 ? 0.225 : age <= 360 ? 0.2 : age <= 720 ? 0.175 : 0.15);

describe("Renda+ income tax by purchase lot (independent cases, tests/fixtures/renda_lot_cases.json)", () => {
  for (const c of (lotCases as unknown as { cases: LotCase[] }).cases) {
    it(c.id, () => {
      const lots: Lot[] = c.input.lots.map((l) => ({ trade: parseISO(l.settle), settle: parseISO(l.settle), units: l.units, costNominal: l.cost_nominal }));
      const r = taxInstalment(lots, parseISO(c.input.pay_day), c.input.instalment_pct, c.input.vna_nominal, A,
        { thresholdNominal: c.input.threshold_nominal, incomeRate: 0.001, applyCosts: true, applyTaxes: true });
      const e = c.expected;
      for (const [k, got, want] of [["gross", r.grossNominal, e.gross], ["cost", r.costNominal, e.cost_returned], ["tax", r.incomeTaxNominal, e.income_tax],
        ["custody", r.custodyNominal, e.custody], ["net", r.netNominal, e.net], ["effective", r.effectiveTaxRate, e.effective_tax_rate]] as const) {
        expect(rel(got, want), `${c.id} ${k}: ${got} vs ${want}`).toBe(true);
      }
      expect(r.minAgeDays).toBe(e.min_age_days);
      // Tax grouped by rate equals the hand-computed per-lot taxes grouped the same way.
      const want = new Map<number, number>();
      for (const l of e.lots) want.set(l.rate, (want.get(l.rate) ?? 0) + l.income_tax);
      expect(r.brackets.map((b) => b.rate).sort()).toEqual([...want.keys()].sort());
      for (const b of r.brackets) expect(rel(b.taxNominal, want.get(b.rate)!)).toBe(true);
    });
  }

  it("rejects a lot settled less than 30 days before a payment (IOF not modelled)", () => {
    const g = (lotCases as unknown as { guards: { pay_day: string; settle: string }[] }).guards[0];
    const lot: Lot = { trade: parseISO(g.settle), settle: parseISO(g.settle), units: 1, costNominal: 1000 };
    expect(() => taxInstalment([lot], parseISO(g.pay_day), 0.416666, 5000, A, { thresholdNominal: 1e12, incomeRate: 0.001, applyCosts: true, applyTaxes: true })).toThrow(RangeError);
  });

  it("settles each purchase D+1 on the settlement calendar", () => {
    expect(toISO(purchaseSettlement(parseISO("2026-10-30")))).toBe("2026-11-03"); // weekend + Finados
    expect(toISO(purchaseSettlement(parseISO("2029-11-30")))).toBe("2029-12-03"); // Friday -> Monday
  });

  it("Renda+ 2030 contributions up to conversion: recent lots pay 22.5% to 17.5% on early instalments", () => {
    const d0 = parseISO("2026-10-30");
    const inp = { ...base, maturity: parseISO("2049-12-15"), realRate: 7.5, monthly: 1000, months: 37 };
    const r = accumulate(inp, A);
    const lots = buildLots(inp);
    expect(toISO(lots[36].trade)).toBe(toISO(addMonths(d0, 36))); // last contribution 30/10/2029
    // Independent recomputation of the first instalment from the engine's lots.
    const pay = parseISO("2030-01-15");
    const k = Math.pow(1.045, (pay - d0) / 365.25);
    let tax = 0;
    for (const l of lots) {
      const age = pay - l.settle;
      tax += bracket(age) * Math.max(0, (l.units * 4771.175732 * k * 0.416666) / 100 - (l.costNominal * 0.416666) / 100);
    }
    expect(rel(r.first.incomeTaxReal * k, tax)).toBe(true);
    expect(r.first.effectiveTaxRate).toBeGreaterThan(0.15);
    expect(r.first.brackets.map((b) => b.rate)).toEqual([0.225, 0.2, 0.175, 0.15]);
    // Payments made while at least one lot is 720 days old or younger.
    const sched = cashflowSchedule("RENDA", inp.maturity);
    const youngest = Math.max(...lots.map((l) => l.settle));
    expect(r.paymentsAboveLowestRate).toBe(sched.filter((f) => f.day - youngest <= 720).length);
    expect(r.paymentsAboveLowestRate).toBeGreaterThan(20);
    expect(r.youngestLotDaysAtFirstPayment).toBe(pay - youngest);
  });

  it("Renda+ 2065 contributions ending decades before conversion: every instalment at 15%", () => {
    const r = accumulate(base, A);
    expect(r.paymentsAboveLowestRate).toBe(0);
    expect(r.first.brackets.map((b) => b.rate)).toEqual([0.15]);
  });
});
