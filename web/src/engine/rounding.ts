// Tesouro Nacional truncation/rounding, mirroring src/pricing/rounding.py.
const GUARD = 1e-12;

export function trunc(x: number, decimals: number): number {
  const scale = 10 ** decimals;
  const s = x * scale;
  const g = s + Math.sign(s) * Math.abs(s) * GUARD;
  return Math.trunc(g) / scale;
}

export function roundHalfUp(x: number, decimals: number): number {
  const scale = 10 ** decimals;
  const s = Math.abs(x) * scale;
  return (Math.sign(x) * Math.floor(s + 0.5 + s * GUARD)) / scale;
}

/** Python's round() for a float to an integer: ties go to the even neighbour. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
