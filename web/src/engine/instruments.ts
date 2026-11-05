// Security master mirroring src/pricing/instruments.py.
import { Day, addMonths } from "./dates";
import { roundHalfUp, trunc } from "./rounding";

export type ProductCode = "LTN" | "NTNF" | "LFT" | "NTNBP" | "NTNB" | "RENDA" | "EDUCA" | "NTNC";
export type Family = "nominal" | "real" | "floating";

export interface Product {
  code: ProductCode;
  instrument: string;
  family: Family;
  indexer: "pre" | "ipca" | "selic" | "igpm";
  coupon: "none" | "semiannual" | "monthly_amortisation";
  modelled: boolean;
  nAmort: number;
}

export const PRODUCTS: Record<ProductCode, Product> = {
  LTN: { code: "LTN", instrument: "LTN", family: "nominal", indexer: "pre", coupon: "none", modelled: true, nAmort: 0 },
  NTNF: { code: "NTNF", instrument: "NTN-F", family: "nominal", indexer: "pre", coupon: "semiannual", modelled: true, nAmort: 0 },
  LFT: { code: "LFT", instrument: "LFT", family: "floating", indexer: "selic", coupon: "none", modelled: true, nAmort: 0 },
  NTNBP: { code: "NTNBP", instrument: "NTN-B Principal", family: "real", indexer: "ipca", coupon: "none", modelled: true, nAmort: 0 },
  NTNB: { code: "NTNB", instrument: "NTN-B", family: "real", indexer: "ipca", coupon: "semiannual", modelled: true, nAmort: 0 },
  RENDA: { code: "RENDA", instrument: "NTN-B1", family: "real", indexer: "ipca", coupon: "monthly_amortisation", modelled: true, nAmort: 240 },
  EDUCA: { code: "EDUCA", instrument: "NTN-B1", family: "real", indexer: "ipca", coupon: "monthly_amortisation", modelled: true, nAmort: 60 },
  NTNC: { code: "NTNC", instrument: "NTN-C", family: "real", indexer: "igpm", coupon: "semiannual", modelled: false, nAmort: 0 },
};

export const NTNB_COUPON = roundHalfUp((Math.pow(1.06, 0.5) - 1) * 100, 6); // 2.956301
export const NTNF_COUPON = roundHalfUp((Math.pow(1.1, 0.5) - 1) * 1000, 5); // 48.80885

export interface Flow {
  day: Day;
  amount: number;
  kind: "principal" | "coupon" | "coupon+principal" | "amortisation";
}

export function amortisationRates(n: number): number[] {
  const ta = trunc(100 / n, 6);
  const last = roundHalfUp(100 - (n - 1) * ta, 6);
  return [...Array(n - 1).fill(ta), last];
}

export function conversionDate(code: ProductCode, maturity: Day): Day | null {
  const n = PRODUCTS[code].nAmort;
  return n ? addMonths(maturity, -(n - 1)) : null;
}

const cache = new Map<string, Flow[]>();

export function cashflowSchedule(code: ProductCode, maturity: Day): Flow[] {
  const key = `${code}-${maturity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let flows: Flow[];
  if (code === "LTN") flows = [{ day: maturity, amount: 1000, kind: "principal" }];
  else if (code === "LFT" || code === "NTNBP") flows = [{ day: maturity, amount: 100, kind: "principal" }];
  else if (code === "NTNF" || code === "NTNB" || code === "NTNC") {
    const coupon = code === "NTNF" ? NTNF_COUPON : NTNB_COUPON;
    const principal = code === "NTNF" ? 1000 : 100;
    flows = [];
    let d = maturity;
    for (let i = 0; i < 100; i++) {
      flows.push({ day: d, amount: coupon, kind: "coupon" });
      d = addMonths(d, -6);
      if (new Date(d * 86_400_000).getUTCFullYear() < 2000) break;
    }
    flows.reverse();
    flows[flows.length - 1] = { day: maturity, amount: coupon + principal, kind: "coupon+principal" };
  } else {
    const n = PRODUCTS[code].nAmort;
    const first = conversionDate(code, maturity)!;
    const rates = amortisationRates(n);
    flows = rates.map((a, i) => ({ day: addMonths(first, i), amount: a, kind: "amortisation" as const }));
  }
  cache.set(key, flows);
  return flows;
}

export function parseSecurityId(id: string): { code: ProductCode; maturity: Day } {
  const [code, ymd] = id.split("-");
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return { code: code as ProductCode, maturity: Math.round(Date.UTC(y, m - 1, d) / 86_400_000) };
}
