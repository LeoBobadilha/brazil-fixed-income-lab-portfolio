// Cash-flow pricing and rate sensitivity, mirroring src/pricing/engine.py.
import { businessDays } from "./calendar";
import { Day } from "./dates";
import { Flow, ProductCode, cashflowSchedule } from "./instruments";
import { roundHalfUp, trunc } from "./rounding";

const PV_ROUND: Partial<Record<ProductCode, number>> = { NTNF: 9, NTNB: 10, NTNC: 10, RENDA: 10, EDUCA: 10 };
export const NOMINAL_FACE: ProductCode[] = ["LTN", "NTNF"];

export interface FutureFlow extends Flow {
  du: number;
  t: number;
}

export function futureFlows(code: ProductCode, maturity: Day, settlement: Day, asof?: Day): FutureFlow[] {
  const out: FutureFlow[] = [];
  for (const f of cashflowSchedule(code, maturity)) {
    if (f.day <= settlement) continue;
    const du = businessDays(settlement, f.day, asof ?? settlement);
    if (du > 0) out.push({ ...f, du, t: du / 252 });
  }
  return out;
}

export interface OfficialPrice {
  cotacao: number | null;
  pu: number | null;
  puTd: number | null;
}

export function officialPrice(code: ProductCode, maturity: Day, settlement: Day, ratePct: number, vna?: number | null): OfficialPrice {
  const f = futureFlows(code, maturity, settlement);
  if (!f.length) return { cotacao: null, pu: null, puTd: null };
  const r = trunc(ratePct, 6) / 100;
  let total = 0;
  for (const x of f) {
    let pv = x.amount / Math.pow(1 + r, trunc(x.du / 252, 14));
    const nd = PV_ROUND[code];
    if (nd !== undefined) pv = roundHalfUp(pv, nd);
    total += pv;
  }
  if (code === "LTN" || code === "NTNF") {
    const pu = trunc(total, 6);
    return { cotacao: null, pu, puTd: trunc(pu, 2) };
  }
  const cot = trunc(total, 4);
  if (vna == null) return { cotacao: cot, pu: null, puTd: null };
  const pu = trunc((vna * cot) / 100, 6);
  return { cotacao: cot, pu, puTd: trunc(pu, 2) };
}

/** Unrounded value per 100 of VNA (or per 1000 face for LTN/NTN-F). */
export function modelValue(code: ProductCode, maturity: Day, settlement: Day, ratePct: number): number {
  let pv = 0;
  for (const x of futureFlows(code, maturity, settlement)) pv += x.amount * Math.pow(1 + ratePct / 100, -x.t);
  return pv;
}

export interface Risk {
  pv: number;
  macaulay: number;
  modified: number;
  convexity: number;
  dv01: number;
  yearsToLastFlow: number;
}

export function risk(code: ProductCode, maturity: Day, settlement: Day, ratePct: number): Risk | null {
  const f = futureFlows(code, maturity, settlement);
  if (!f.length) return null;
  const y = ratePct / 100;
  let p = 0, tw = 0, cw = 0;
  for (const x of f) {
    const pv = x.amount * Math.pow(1 + y, -x.t);
    p += pv;
    tw += x.t * pv;
    cw += x.t * (x.t + 1) * pv;
  }
  const mac = tw / p;
  const mod = mac / (1 + y);
  const conv = cw / ((1 + y) ** 2 * p);
  return { pv: p, macaulay: mac, modified: mod, convexity: conv, dv01: mod * p * 1e-4, yearsToLastFlow: f[f.length - 1].t };
}

/** Unrounded price per unit at `day` for yield `ratePct` (VNA-scaled for indexed products). */
export function modelPriceAt(code: ProductCode, maturity: Day, day: Day, ratePct: number, vna: number): number {
  let pv = 0;
  for (const f of cashflowSchedule(code, maturity)) {
    if (f.day <= day) continue;
    const du = businessDays(day, f.day, day); // calendar in force on the pricing date
    if (du <= 0) continue;
    pv += f.amount * Math.pow(1 + ratePct / 100, -du / 252);
  }
  return NOMINAL_FACE.includes(code) ? pv : (vna * pv) / 100;
}

/** Yield whose model value equals target (bisection; monotone in yield). */
export function solveRate(code: ProductCode, maturity: Day, settlement: Day, target: number): number {
  let lo = -50, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (modelValue(code, maturity, settlement, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
