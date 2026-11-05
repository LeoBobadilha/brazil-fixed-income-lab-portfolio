
export const PERIODS: { key: string; label: string }[] = [
  { key: "1d", label: "1 day" },
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "ytd", label: "Year to date" },
  { key: "1y", label: "12 months" },
];

export const BUCKETS: { key: string; label: string; lo: number; hi: number }[] = [
  { key: "all", label: "All", lo: 0, hi: 1e9 },
  { key: "short", label: "Up to 5y", lo: 0, hi: 5 },
  { key: "mid", label: "5–15y", lo: 5, hi: 15 },
  { key: "long", label: "Over 15y", lo: 15, hi: 1e9 },
];

export const BENCH_LABEL: Record<string, string> = {
  real_d2y: "Real yield, 2y duration",
  real_d5y: "Real yield, 5y duration",
  real_d10y: "Real yield, 10y duration",
  real_d15y: "Real yield, 15y duration",
  real_d20y: "Real yield, 20y duration",
  nom_d1y: "Nominal yield, 1y duration",
  nom_d2y: "Nominal yield, 2y duration",
  nom_d3y: "Nominal yield, 3y duration",
  nom_d5y: "Nominal yield, 5y duration",
  breakeven_2y: "Breakeven inflation, 2y",
  breakeven_5y: "Breakeven inflation, 5y",
  selic_target: "Selic target",
  real_slope_20_2: "Real slope 20y − 2y",
  nom_slope_5_1: "Nominal slope 5y − 1y",
  real_vol_10y_bp: "10y real-yield volatility",
  nom_vol_2y_bp: "2y nominal-yield volatility",
};

export const RANGES: { key: string; label: string; years: number | null }[] = [
  { key: "1y", label: "1y", years: 1 },
  { key: "3y", label: "3y", years: 3 },
  { key: "5y", label: "5y", years: 5 },
  { key: "10y", label: "10y", years: 10 },
  { key: "all", label: "All", years: null },
];

export function rangeStart(dates: string[], years: number | null): number {
  if (years == null || !dates.length) return 0;
  const last = dates[dates.length - 1];
  const y = Number(last.slice(0, 4)) - years;
  const cut = `${y}${last.slice(4)}`;
  const i = dates.findIndex((d) => d >= cut);
  return i < 0 ? 0 : i;
}

/** Largest moves over `window` observations (non-overlapping greedy selection). */
export function largestMoves(dates: string[], values: (number | null)[], window: number, k = 8) {
  const moves: { start: string; end: string; change: number; i: number }[] = [];
  for (let i = window; i < values.length; i++) {
    const a = values[i - window], b = values[i];
    if (a == null || b == null) continue;
    moves.push({ start: dates[i - window], end: dates[i], change: (b - a) * 100, i });
  }
  moves.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  const picked: typeof moves = [];
  for (const m of moves) {
    if (picked.every((p) => Math.abs(p.i - m.i) > window)) picked.push(m);
    if (picked.length >= k) break;
  }
  return picked;
}
