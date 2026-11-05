import type { LatestRow, Latest, Macro, Security } from "../data/types";
import { parseISO, toISO } from "../engine/dates";
import type { ScenarioInput, ScenarioResult } from "../engine/scenario";

export interface Assume { amount: number; horizonYears: number; shockBp: number; inflationPa: number; selicPa: number; reinvestPa: number; applyCosts: boolean; applyTaxes: boolean; custodyDeductible: boolean }

export function scenarioInput(sec: Security, lr: LatestRow, latest: Latest, a: Assume): ScenarioInput | null {
  if (!sec.modelled || lr.buy_price == null || lr.buy_rate == null || lr.sell_rate == null) return null;
  const vna = sec.indexer === "selic" ? latest.vna.selic.base.consensus : sec.indexer === "ipca" ? latest.vna.ipca.base.consensus : null;
  return {
    code: sec.code, maturity: parseISO(sec.maturity), valuationDate: parseISO(latest.date), buyPrice: lr.buy_price, buyRate: lr.buy_rate,
    sellRate: lr.sell_rate, vna0: vna, ...a,
  };
}

/**
 * Defaults anchored to public data (Focus medians, Selic target).
 * Custody is not deducted from the income-tax base by default (treatment unconfirmed).
 */
export function defaultAssume(focusIpca: number | null, selic: number | null): Assume {
  const s = selic ?? 12;
  return { amount: 10_000, horizonYears: 3, shockBp: 0, inflationPa: Math.round((focusIpca ?? 4) * 10) / 10, selicPa: s, reinvestPa: s, applyCosts: true, applyTaxes: true, custodyDeductible: false };
}

/** Latest Focus next-year IPCA median and Selic target known on `iso` (no look-ahead). */
export function publicDefaultsAt(macro: Macro | null, iso: string): { ipca: number | null; selic: number | null; focusDate: string | null } {
  if (!macro) return { ipca: null, selic: null, focusDate: null };
  const h = macro.focus.history.IPCA_y1;
  let ipca: number | null = null, focusDate: string | null = null;
  if (h) for (let i = h.dates.length - 1; i >= 0; i--) if (h.dates[i] <= iso) { ipca = h.median[i]; focusDate = h.dates[i]; break; }
  const s = macro.series.selic_target;
  let selic: number | null = null;
  for (let i = s.dates.length - 1; i >= 0; i--) if (s.dates[i] <= iso && s.values[i] != null) { selic = s.values[i]; break; }
  return { ipca, selic, focusDate };
}

// ---- CSV export (RFC 4180) ---------------------------------------------------

export function csvField(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export interface ExportContext {
  sec: Security; name: string; reference: string; input: ScenarioInput; result: ScenarioResult; assumptionsVersion: string; snapshotId: string; dataAsOf: string;
}

/**
 * Long-format scenario summary: field, value, unit. Machine-readable values (ISO dates,
 * '.' decimals, no thousands separators); a UTF-8 BOM is added when downloading so
 * Excel detects the encoding.
 */
export function scenarioCsv(c: ExportContext): string {
  const i = c.input, r = c.result;
  const rows: (string | number | boolean | null)[][] = [
    ["field", "value", "unit"],
    ["security_id", c.sec.id, ""], ["security_name", c.name, ""], ["reference_date", c.reference, "ISO 8601 date"],
    ["data_as_of", c.dataAsOf, "ISO 8601 date"], ["snapshot_id", c.snapshotId, ""], ["assumptions_version", c.assumptionsVersion, ""],
    ["buy_price", i.buyPrice, "BRL per unit"], ["buy_rate", i.buyRate, "% p.a."], ["sell_rate", i.sellRate, "% p.a."], ["vna", i.vna0, "BRL"],
    ["amount", i.amount, "BRL"], ["horizon_years", i.horizonYears, "years"], ["shock", i.shockBp, "bp"], ["inflation_assumption", i.inflationPa, "% p.a."],
    ["selic_assumption", i.selicPa, "% p.a."], ["reinvestment_rate", i.reinvestPa, "% p.a."], ["costs_applied", i.applyCosts, "boolean"],
    ["taxes_applied", i.applyTaxes, "boolean"], ["custody_deducted_from_tax_base", r.custodyDeductible, "boolean"],
    ["horizon_date", toISO(r.horizonDate), "ISO 8601 date"], ["held_to_maturity", r.heldToMaturity, "boolean"], ["units", r.units, "units"],
    ["exit_rate", r.exitRate, "% p.a."], ["exit_price", r.exitPrice, "BRL per unit"], ["sale_proceeds", r.saleProceeds, "BRL"],
    ["flows_received", r.flowsReceived, "BRL"], ["gross_value", r.grossValue, "BRL"], ["custody", r.custody, "BRL"], ["iof", r.iof, "BRL"],
    ["income_tax", r.incomeTax, "BRL"], ["net_value", r.netValue, "BRL"], ["net_return_pa", r.netReturnPaPct, "% p.a."],
    ["real_net_return_pa", r.realNetReturnPaPct, "% p.a."],
    ["note", "Hypothetical scenario, not a forecast. Brazil Fixed Income Lab, https://leobobadilha.github.io/brazil-fixed-income-lab/", ""],
  ];
  return toCsv(rows);
}

export function downloadText(name: string, text: string, mime = "text/csv") {
  const blob = new Blob(["﻿" + text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
