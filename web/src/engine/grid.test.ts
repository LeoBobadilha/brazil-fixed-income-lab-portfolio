import assumptions from "../../../config/assumptions/br_costs_taxes_v2026-11.json";
import { parseISO } from "./dates";
import { SHOCKS, horizonsFor, scenarioGrid, surfaceHeights } from "./grid";
import { Assumptions, runScenario } from "./scenario";

const A = assumptions as unknown as Assumptions;
const base = {
  code: "RENDA" as const, maturity: parseISO("2084-12-15"), valuationDate: parseISO("2026-10-30"), buyPrice: 178.94, buyRate: 7.28,
  sellRate: 7.4, vna0: 4771.175732, amount: 10_000, horizonYears: 3, shockBp: 0, inflationPa: 4.5, selicPa: 13, reinvestPa: 13,
  applyCosts: true, applyTaxes: true,
};

describe("3D surface / 2D heatmap / table consistency", () => {
  const g = scenarioGrid(base, A, "netReturnPaPct", horizonsFor(10));

  it("surface heights equal the heatmap grid values cell by cell", () => {
    const h = surfaceHeights(g);
    expect(h.length).toBe(g.horizons.length * SHOCKS.length);
    g.values.forEach((row, i) => row.forEach((v, j) => expect(h[i * SHOCKS.length + j]).toBeCloseTo(v, 3)));
  });

  it("grid cells equal independent single-scenario runs (what the table shows)", () => {
    for (const [i, j] of [[0, 0], [3, 12], [g.horizons.length - 1, 24]]) {
      const r = runScenario({ ...base, horizonYears: g.horizons[i], shockBp: g.shocks[j] }, A);
      expect(g.values[i][j]).toBe(r.netReturnPaPct);
    }
  });

  it("higher exit-rate shocks never improve an early-sale result", () => {
    for (const row of g.values) for (let j = 1; j < row.length; j++) expect(row[j]).toBeLessThanOrEqual(row[j - 1] + 1e-9);
  });
});
