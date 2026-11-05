import { useMemo } from "react";
import { parseISO, toYMD } from "./engine/dates";

const locale = "en-GB";

export function useFmt() {
  return useMemo(() => {
    const nf = (min: number, max = min) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    const cache = new Map<string, Intl.NumberFormat>();
    const num = (v: number | null | undefined, d = 2) => {
      if (v == null || !Number.isFinite(v)) return "–";
      const k = String(d);
      if (!cache.has(k)) cache.set(k, nf(d));
      const out = cache.get(k)!.format(v);
      return /^-0(?:\.0+)?$/.test(out) ? out.slice(1) : out; // never show "-0.00"
    };
    const brl = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : `R$ ${num(v, d)}`);
    const pct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : `${num(v, d)}%`);
    const bp = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${num(v, d)} bp`);
    const signedPct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${num(v, d)}%`);
    const compact = (v: number) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
    const date = (iso: string | null | undefined) => {
      if (!iso) return "–";
      const [y, m, d] = toYMD(parseISO(iso));
      return `${d} ${MONTHS_EN[m - 1]} ${y}`;
    };
    const month = (iso: string) => {
      const [y, m] = toYMD(parseISO(iso));
      return `${MONTHS_EN[m - 1]} ${y}`;
    };
    const rateLabel = (family: string, v: number | null | undefined) =>
      family === "real" ? `IPCA + ${pct(v)}` : family === "floating" ? `Selic ${v != null && v >= 0 ? "+" : ""}${pct(v, 2)}` : pct(v);
    return { num, brl, pct, bp, signedPct, compact, date, month, rateLabel };
  }, []);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
