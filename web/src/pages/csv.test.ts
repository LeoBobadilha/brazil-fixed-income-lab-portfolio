// CSV export: RFC 4180 quoting and a frozen fixture also read by pandas (tests/test_csv_export.py).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assumptions from "../../../config/assumptions/br_costs_taxes_v2026-11.json";
import { parseISO } from "../engine/dates";
import { Assumptions, runScenario } from "../engine/scenario";
import type { Security } from "../data/types";
import { csvField, scenarioCsv, toCsv } from "./scenarioBase";

const FIXTURE = resolve(__dirname, "../engine/__fixtures__/scenario_export.csv");

describe("CSV export", () => {
  it("quotes fields with commas, quotes and line breaks", () => {
    expect(csvField('IPCA + 7,5% "real"')).toBe('"IPCA + 7,5% ""real"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField(1234.5)).toBe("1234.5");
    expect(csvField(null)).toBe("");
    expect(csvField(Number.NaN)).toBe("");
    expect(toCsv([["a", "b"], [1, true]])).toBe("a,b\r\n1,true\r\n");
  });

  it("matches the frozen scenario export fixture", () => {
    const sec = { id: "NTNBP-20350515", code: "NTNBP" } as Security;
    const input = { code: "NTNBP" as const, maturity: parseISO("2035-05-15"), valuationDate: parseISO("2026-10-30"), buyPrice: 2509.91, buyRate: 7.88,
      sellRate: 8.0, vna0: 4771.175732, amount: 10000, horizonYears: 3, shockBp: -50, inflationPa: 4.5, selicPa: 13.75, reinvestPa: 13.75, applyCosts: true, applyTaxes: true };
    const result = runScenario(input, assumptions as unknown as Assumptions);
    const csv = scenarioCsv({ sec, name: "IPCA+ 2035, \"zero-coupon\"", reference: "2026-10-30", input, result, assumptionsVersion: "2026-11.2", snapshotId: "test", dataAsOf: "2026-10-30" });
    if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE, csv, "utf-8");
    expect(csv).toBe(readFileSync(FIXTURE, "utf-8"));
    const netLine = csv.split("\r\n").find((l) => l.startsWith("net_value,"))!;
    expect(Number(netLine.split(",")[1])).toBeCloseTo(result.netValue, 9);
  });
});
