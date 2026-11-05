// Renda+ / Educa+ accumulation and income estimate (monthly contributions).
// All "real" values are in today's reais (deflated by the assumed IPCA).
//
// Income tax is computed per purchase lot. Each monthly contribution is a separate
// purchase with its own settlement date (D+1) and its own nominal cost. At every
// instalment, each lot receives its share of the payment and pays income tax at the
// regressive rate for its own age: days from that lot's settlement to the payment date.
// Holding periods count from settlement (RFB Nota Cosit 144/2018; STN/B3 communication
// 070/2018); coupons and instalments use the time since purchase (Tesouro Direto rules,
// section 14). Lots bought shortly before conversion are therefore taxed at 22.5%, 20%
// or 17.5% on their first instalments, not 15%.
//
// Assumption (not stated in an official source): each instalment returns amount/100 of
// every lot's purchase cost, so the taxable part of a lot's instalment is its payment
// minus that share of its cost. IOF does not apply to instalments (Tesouro Direto rules,
// section 14); the simulator never places a purchase within 30 days of a payment.
import { Day, addMonths } from "./dates";
import { amortisationRates, cashflowSchedule } from "./instruments";
import { modelValue } from "./pricing";
import { type Assumptions, irRate, purchaseSettlement } from "./scenario";

export interface AccumInput {
  code: "RENDA" | "EDUCA";
  maturity: Day;
  d0: Day;
  vna0: number; // VNA on d0
  realRate: number; // % p.a. assumed for every purchase
  monthly: number; // contribution in today's reais (indexed to IPCA)
  months: number; // number of monthly contributions starting on d0
  ipca: number; // % p.a. assumption (also used for the minimum-wage path)
  applyCosts: boolean;
  applyTaxes: boolean;
}

/** One purchase: trade and settlement dates, units bought and nominal cost in reais. */
export interface Lot { trade: Day; settle: Day; units: number; costNominal: number }

/** Lots of one payment grouped by income-tax rate. */
export interface BracketShare { rate: number; lots: number; units: number; gainNominal: number; taxNominal: number }

export interface InstalmentTax {
  grossNominal: number;
  costNominal: number; // purchase cost returned by this instalment
  incomeTaxNominal: number;
  custodyNominal: number;
  netNominal: number;
  effectiveTaxRate: number; // income tax / taxable gain (0 when there is no gain)
  brackets: BracketShare[]; // highest rate first
  minAgeDays: number; // age of the youngest lot on the payment date
}

/**
 * Income tax and custody on one NTN-B1 instalment for a position made of several lots.
 * `vnaNominal` is the VNA on the payment date and `amountPct` the instalment (% of VNA).
 * Custody applies to the whole payment above the threshold (per investor, not per lot).
 */
export function taxInstalment(
  lots: Lot[], payDay: Day, amountPct: number, vnaNominal: number, a: Assumptions,
  opts: { thresholdNominal: number; incomeRate: number; applyCosts: boolean; applyTaxes: boolean },
): InstalmentTax {
  const byRate = new Map<number, BracketShare>();
  let gross = 0, cost = 0, tax = 0, gainTotal = 0, minAge = Infinity;
  for (const l of lots) {
    const age = payDay - l.settle;
    if (age < a.iof.applies_if_days_below) {
      throw new RangeError(`A purchase settled ${age} days before a payment: IOF on instalments is not modelled.`);
    }
    minAge = Math.min(minAge, age);
    const pay = (l.units * vnaNominal * amountPct) / 100;
    const c = (l.costNominal * amountPct) / 100;
    const gain = Math.max(0, pay - c);
    const rate = irRate(age, a);
    const t = opts.applyTaxes ? rate * gain : 0;
    gross += pay; cost += c; tax += t; gainTotal += gain;
    const b = byRate.get(rate) ?? { rate, lots: 0, units: 0, gainNominal: 0, taxNominal: 0 };
    b.lots += 1; b.units += l.units; b.gainNominal += gain; b.taxNominal += t;
    byRate.set(rate, b);
  }
  const custody = opts.applyCosts ? opts.incomeRate * Math.max(0, gross - opts.thresholdNominal) : 0;
  return {
    grossNominal: gross, costNominal: cost, incomeTaxNominal: tax, custodyNominal: custody, netNominal: gross - tax - custody,
    effectiveTaxRate: gainTotal > 0 ? tax / gainTotal : 0,
    brackets: [...byRate.values()].sort((x, y) => y.rate - x.rate),
    minAgeDays: minAge,
  };
}

export interface PaymentBreakdown {
  day: Day; grossReal: number; incomeTaxReal: number; custodyReal: number; netReal: number;
  effectiveTaxRate: number; brackets: BracketShare[];
}

export interface AccumResult {
  units: number;
  lots: Lot[];
  contributedReal: number;
  contributedNominal: number;
  grossIncomeReal: number; // per month, constant in real terms
  thresholdReal: number; // custody-exemption threshold in today's reais
  custodyApplies: boolean;
  first: PaymentBreakdown;
  averageNetReal: number; // average over all instalments, after simulated IR and custody
  averageIncomeTaxReal: number;
  averageCustodyReal: number;
  firstNominalGross: number;
  payments: number;
  youngestLotDaysAtFirstPayment: number;
  /** Instalments paid before every lot has been held for more than 720 days (all at 15%). */
  paymentsAboveLowestRate: number;
}

export function buildLots(i: AccumInput): Lot[] {
  const infl = (t: Day) => Math.pow(1 + i.ipca / 100, (t - i.d0) / 365.25);
  const lots: Lot[] = [];
  for (let k = 0; k < i.months; k++) {
    const trade = addMonths(i.d0, k);
    // Real unit price at a constant real rate: VNA0 x cotação(t)/100 in today's reais.
    const priceReal = (i.vna0 * modelValue(i.code, i.maturity, trade, i.realRate)) / 100;
    lots.push({ trade, settle: purchaseSettlement(trade), units: i.monthly / priceReal, costNominal: i.monthly * infl(trade) });
  }
  return lots;
}

export function accumulate(i: AccumInput, a: Assumptions): AccumResult {
  const rules = i.code === "RENDA" ? a.custody.renda_plus : a.custody.educa_plus;
  const infl = (t: Day) => Math.pow(1 + i.ipca / 100, (t - i.d0) / 365.25);
  const lots = buildLots(i);
  const units = lots.reduce((s, l) => s + l.units, 0);
  const contributedNominal = lots.reduce((s, l) => s + l.costNominal, 0);
  const n = i.code === "RENDA" ? 240 : 60;
  const ta = amortisationRates(n)[0];
  const thresholdReal = rules.income_threshold_minimum_wages * a.custody.minimum_wage_brl; // MW indexed to IPCA
  const lowest = a.income_tax.regressive_table[a.income_tax.regressive_table.length - 1].rate;
  const sched = cashflowSchedule(i.code, i.maturity);
  let sumNet = 0, sumTax = 0, sumCust = 0, aboveLowest = 0;
  let first: PaymentBreakdown | null = null;
  let youngest = 0;
  for (const f of sched) {
    const k = infl(f.day);
    const r = taxInstalment(lots, f.day, f.amount, i.vna0 * k, a, {
      thresholdNominal: thresholdReal * k, incomeRate: rules.income_rate, applyCosts: i.applyCosts, applyTaxes: i.applyTaxes,
    });
    const b: PaymentBreakdown = {
      day: f.day, grossReal: r.grossNominal / k, incomeTaxReal: r.incomeTaxNominal / k, custodyReal: r.custodyNominal / k,
      netReal: r.netNominal / k, effectiveTaxRate: r.effectiveTaxRate, brackets: r.brackets,
    };
    if (!first) { first = b; youngest = r.minAgeDays; }
    if (r.brackets.some((x) => x.rate > lowest)) aboveLowest += 1;
    sumNet += b.netReal; sumTax += b.incomeTaxReal; sumCust += b.custodyReal;
  }
  const grossIncomeReal = (units * i.vna0 * ta) / 100;
  return {
    units, lots, contributedReal: i.monthly * i.months, contributedNominal, grossIncomeReal, thresholdReal,
    custodyApplies: grossIncomeReal > thresholdReal + 1e-6,
    first: first!, averageNetReal: sumNet / sched.length, averageIncomeTaxReal: sumTax / sched.length, averageCustodyReal: sumCust / sched.length,
    firstNominalGross: first!.grossReal * infl(first!.day), payments: sched.length,
    youngestLotDaysAtFirstPayment: youngest, paymentsAboveLowestRate: aboveLowest,
  };
}
