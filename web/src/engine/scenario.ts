// Hypothetical holding-period scenarios, mirroring src/pricing/scenario.py.
// Verified against Python golden vectors and the independent reference cases
// (tests/fixtures/reference_cases.json) in engine.test.ts.
import { addBusinessDays, businessDays, settlementDate } from "./calendar";
import { Day, addMonths, parseISO, toISO } from "./dates";
import { PRODUCTS, ProductCode, cashflowSchedule } from "./instruments";
import { NOMINAL_FACE, modelPriceAt } from "./pricing";
import { roundHalfEven } from "./rounding";

interface Ntnb1Rules {
  income_rate: number;
  income_threshold_minimum_wages: number;
  early_redemption_tiers: { max_years: number | null; rate_pa: number }[];
}

export interface Assumptions {
  version: string;
  reference_date: string;
  income_tax: { regressive_table: { max_days: number | null; rate: number }[]; custody_deductible_from_tax_base: boolean; custody_deductible_note?: string };
  iof: { applies_if_days_below: number; share_of_gain_by_day: number[] };
  custody: {
    b3_rate_pa: number;
    selic_exempt_amount_brl: number;
    renda_plus: Ntnb1Rules;
    educa_plus: Ntnb1Rules;
    minimum_wage_brl: number;
  };
  sources?: { id: string; name: string; url: string; accessed: string }[];
}

export interface ScenarioInput {
  code: ProductCode;
  maturity: Day;
  valuationDate: Day;
  buyPrice: number;
  buyRate: number;
  sellRate: number;
  vna0: number | null;
  amount: number;
  horizonYears: number;
  shockBp: number;
  inflationPa: number;
  selicPa: number;
  reinvestPa: number;
  applyCosts: boolean;
  applyTaxes: boolean;
  custodyDeductible?: boolean;
}

export interface ScenarioEvent { day: Day; kind: string; cash: number; custody: number; incomeTax: number; valueAtHorizon: number }

export interface ScenarioResult {
  horizonDate: Day;
  heldToMaturity: boolean;
  units: number;
  exitRate: number | null;
  exitPrice: number | null;
  saleProceeds: number;
  flowsReceived: number;
  flowsReinvestedValue: number;
  grossValue: number;
  grossReturnPct: number;
  grossReturnPaPct: number;
  custody: number;
  custodyAtSale: number;
  iof: number;
  incomeTax: number;
  netValue: number;
  netReturnPct: number;
  netReturnPaPct: number;
  realNetReturnPaPct: number | null;
  immediateSpreadCost: number;
  custodyDeductible: boolean;
  events: ScenarioEvent[];
  purchaseSettlement: Day; // start of the tax and custody clock (purchase D+1)
  taxHoldingDays: number; // purchase settlement to sale settlement (or maturity)
}

const yearsCal = (d0: Day, d1: Day) => (d1 - d0) / 365.25;

export function horizonDate(d0: Day, years: number, maturity: Day): [Day, boolean] {
  const d1 = d0 + roundHalfEven(years * 365.25);
  if (d1 >= maturity) return [maturity, true];
  return [addBusinessDays(d1, 0), false];
}

export function vnaAt(code: ProductCode, vna0: number | null, d0: Day, d1: Day, inflationPa: number, selicPa: number): number {
  if (NOMINAL_FACE.includes(code)) return 1;
  if (code === "LFT") return vna0! * Math.pow(1 + selicPa / 100, businessDays(d0, d1) / 252);
  return vna0! * Math.pow(1 + inflationPa / 100, yearsCal(d0, d1));
}

// Tesouro Direto sales settle D+0 from this date (D+1 before); purchases settle D+1.
const SELL_D0_FROM = parseISO("2021-09-13");
/** Settlement date of a Tesouro Direto purchase made on `trade` (D+1). */
export const purchaseSettlement = (trade: Day): Day => settlementDate(trade, 1);
/** Settlement date of a Tesouro Direto sale made on `trade` (D+0 since 13/09/2021). */
export const saleSettlement = (trade: Day): Day => (trade >= SELL_D0_FROM ? trade : settlementDate(trade, 1));

export function irRate(days: number, a: Assumptions): number {
  for (const row of a.income_tax.regressive_table) if (row.max_days === null || days <= row.max_days) return row.rate;
  return a.income_tax.regressive_table[a.income_tax.regressive_table.length - 1].rate;
}

export function iofShare(days: number, a: Assumptions): number {
  if (days >= a.iof.applies_if_days_below || days < 1) return 0;
  return a.iof.share_of_gain_by_day[days - 1];
}

/** Trapezoidal integral of rate x max(base, 0) over actual/365 time. */
export function accrue(points: [Day, number][], ratePa: number): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [t0, b0] = points[i - 1];
    const [t1, b1] = points[i];
    total += (ratePa * (Math.max(b0, 0) + Math.max(b1, 0))) / 2 * (t1 - t0) / 365;
  }
  return total;
}

/** from, every `stepMonths` after it, and to (mirrors accrual_grid). */
export function accrualGrid(from: Day, to: Day, stepMonths = 3): Day[] {
  const out = [from];
  for (let k = 1; ; k++) {
    const t = addMonths(from, stepMonths * k);
    if (t >= to) break;
    out.push(t);
  }
  out.push(to);
  return out;
}

export function ntnb1EarlyRate(tiers: Ntnb1Rules["early_redemption_tiers"], years: number): number {
  for (const t of tiers) if (t.max_years === null || years < t.max_years) return t.rate_pa;
  return tiers[tiers.length - 1].rate_pa;
}

export function runScenario(inp: ScenarioInput, a: Assumptions): ScenarioResult {
  const { code, valuationDate: d0 } = inp;
  const p = PRODUCTS[code];
  const nominal = NOMINAL_FACE.includes(code);
  const deductible = inp.custodyDeductible ?? a.income_tax.custody_deductible_from_tax_base;
  const units = inp.amount / inp.buyPrice;
  const [d1, held] = horizonDate(d0, inp.horizonYears, inp.maturity);
  // Income-tax and IOF holding periods run between the settlement dates of the purchase
  // and the sale (RFB Nota Cosit 144/2018; STN/B3 communication 070/2018). Coupons and
  // instalments count from the purchase settlement. B3 custody accrues from settlement.
  const settleBuy = purchaseSettlement(d0);
  const settleSell = held ? d1 : saleSettlement(d1);
  const daysTotal = Math.max(0, settleSell - settleBuy);
  const exitRate = held ? null : inp.sellRate + inp.shockBp / 100;
  const vnaNow = inp.vna0 ? inp.vna0 : 1;
  const sellNow = modelPriceAt(code, inp.maturity, d0, inp.sellRate, vnaNow);
  const buyNow = modelPriceAt(code, inp.maturity, d0, inp.buyRate, vnaNow);
  const spreadCost = units * Math.max(0, buyNow - sellNow);

  const sched = cashflowSchedule(code, inp.maturity);
  const live = sched.filter((f) => f.day > d0 && f.day <= d1);
  const flowOn = new Map<Day, number>();
  for (const f of live) flowOn.set(f.day, (flowOn.get(f.day) ?? 0) + f.amount);
  const vnaT = (t: Day) => vnaAt(code, inp.vna0, d0, t, inp.inflationPa, inp.selicPa);
  const cashPerUnit = (amt: number, t: Day) => (nominal ? amt : (vnaT(t) * amt) / 100);

  // Custody base: modelled value along a linear yield path from the purchase
  // rate to the exit rate (flat when held). A period starts ex-payment and ends
  // cum-payment.
  const yEnd = held ? inp.buyRate : exitRate!;
  const span = Math.max(d1 - d0, 1);
  const positionValue = (t: Day, cumFlow: boolean) => {
    const y = inp.buyRate + ((yEnd - inp.buyRate) * (t - d0)) / span;
    let v = modelPriceAt(code, inp.maturity, t, y, vnaT(t));
    if (cumFlow && flowOn.has(t)) v += cashPerUnit(flowOn.get(t)!, t);
    return units * v;
  };
  const standardCustody = inp.applyCosts && !p.nAmort;
  const exempt = code === "LFT" ? a.custody.selic_exempt_amount_brl : 0;
  let lastCollection = settleBuy;
  const collect = (t: Day) => {
    if (!standardCustody || t <= lastCollection) return 0;
    const pts = accrualGrid(lastCollection, t).map((g) => [g, positionValue(g, g === t) - exempt] as [Day, number]);
    lastCollection = t;
    return accrue(pts, a.custody.b3_rate_pa);
  };
  const rules = code === "RENDA" ? a.custody.renda_plus : a.custody.educa_plus;
  const minWage = (t: Day) => a.custody.minimum_wage_brl * Math.pow(1 + inp.inflationPa / 100, yearsCal(d0, t));

  const remainingPrincipal = p.nAmort ? sched.filter((f) => f.day > d0).reduce((s, f) => s + f.amount, 0) : 0;
  const events: ScenarioEvent[] = [];
  let flowsReceived = 0, flowsFv = 0, flowsGrossFv = 0, taxFlows = 0, custodyFlows = 0, costUsed = 0;
  for (const f of live) {
    const cash = units * cashPerUnit(f.amount, f.day);
    let costPart = 0;
    if (p.nAmort) costPart = (inp.amount * f.amount) / remainingPrincipal;
    else if (f.kind.includes("principal")) costPart = inp.amount;
    costUsed += costPart;
    const gain = cash - costPart;
    let cust = 0;
    if (p.nAmort) {
      if (inp.applyCosts) cust = rules.income_rate * Math.max(0, cash - rules.income_threshold_minimum_wages * minWage(f.day));
    } else cust = collect(f.day);
    const taxable = Math.max(0, gain - (deductible ? cust : 0));
    const tax = inp.applyTaxes ? irRate(Math.max(0, f.day - settleBuy), a) * taxable : 0;
    const growth = Math.pow(1 + inp.reinvestPa / 100, businessDays(f.day, d1) / 252);
    const fv = (cash - cust - tax) * growth;
    flowsGrossFv += cash * growth;
    flowsReceived += cash;
    flowsFv += fv;
    taxFlows += tax;
    custodyFlows += cust;
    events.push({ day: f.day, kind: f.kind, cash, custody: cust, incomeTax: tax, valueAtHorizon: fv });
  }

  let sale = 0, exitPrice: number | null = null;
  let custodySale = 0, iof = 0, taxSale = 0;
  if (!held) {
    exitPrice = modelPriceAt(code, inp.maturity, d1, exitRate!, vnaT(d1));
    sale = units * exitPrice;
    const costLeft = inp.amount - costUsed;
    if (inp.applyCosts) {
      if (p.nAmort) {
        const yrsHeld = daysTotal / 365;
        custodySale = ntnb1EarlyRate(rules.early_redemption_tiers, yrsHeld) * yrsHeld * sale;
      } else custodySale = collect(d1);
    }
    const gain = sale - costLeft - (deductible ? custodySale : 0);
    if (inp.applyTaxes && gain > 0) {
      iof = iofShare(daysTotal, a) * gain;
      taxSale = irRate(daysTotal, a) * (gain - iof);
    }
  }
  const gross = sale + flowsGrossFv;
  const net = sale - custodySale - iof - taxSale + flowsFv;
  const yrs = Math.max(yearsCal(d0, d1), 1e-9);
  const ann = (v: number) => (v > 0 ? (Math.pow(v / inp.amount, 1 / yrs) - 1) * 100 : -100);
  const real = p.indexer === "ipca" ? ((1 + ann(net) / 100) / (1 + inp.inflationPa / 100) - 1) * 100 : null;
  return {
    horizonDate: d1, heldToMaturity: held, units, exitRate, exitPrice, saleProceeds: sale, flowsReceived,
    flowsReinvestedValue: flowsFv, grossValue: gross, grossReturnPct: (gross / inp.amount - 1) * 100, grossReturnPaPct: ann(gross),
    custody: custodyFlows + custodySale, custodyAtSale: custodySale, iof, incomeTax: taxFlows + taxSale, netValue: net,
    netReturnPct: (net / inp.amount - 1) * 100, netReturnPaPct: ann(net), realNetReturnPaPct: real,
    immediateSpreadCost: spreadCost, custodyDeductible: deductible, purchaseSettlement: settleBuy, taxHoldingDays: daysTotal, events,
  };
}

export { parseISO, toISO };
