// Scenario grid shared by the 2D heatmap, the table and the optional 3D surface,
// so all three views show exactly the same numbers.
import { Assumptions, ScenarioInput, ScenarioResult, runScenario } from "./scenario";

export type GridMetric = "netReturnPaPct" | "netReturnPct" | "netValue" | "realNetReturnPaPct";

export interface ScenarioGrid {
  shocks: number[];
  horizons: number[];
  metric: GridMetric;
  values: number[][]; // [horizonIndex][shockIndex]
  held: boolean[]; // per horizon: horizon reaches maturity (shock irrelevant)
}

export function horizonsFor(maxYears: number): number[] {
  const base = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 25, 30, 40];
  const out = base.filter((h) => h < maxYears - 0.05);
  out.push(Math.round(maxYears * 100) / 100);
  return out;
}

export const SHOCKS = Array.from({ length: 25 }, (_, i) => -300 + i * 25);

export function scenarioGrid(base: ScenarioInput, a: Assumptions, metric: GridMetric, horizons: number[], shocks = SHOCKS): ScenarioGrid {
  const values: number[][] = [];
  const held: boolean[] = [];
  for (const h of horizons) {
    const rowv: number[] = [];
    let hh = false;
    for (const s of shocks) {
      const r: ScenarioResult = runScenario({ ...base, horizonYears: h, shockBp: s }, a);
      hh = r.heldToMaturity;
      rowv.push((r[metric] as number | null) ?? NaN);
    }
    values.push(rowv);
    held.push(hh);
  }
  return { shocks, horizons, metric, values, held };
}

/** Vertex heights for the 3D surface (identical to grid values; tested for 2D/3D parity). */
export function surfaceHeights(g: ScenarioGrid): Float32Array {
  const out = new Float32Array(g.horizons.length * g.shocks.length);
  g.values.forEach((rowv, i) => rowv.forEach((v, j) => { out[i * g.shocks.length + j] = v; }));
  return out;
}
