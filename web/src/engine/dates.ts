// Calendar dates as integer day numbers (days since 1970-01-01, UTC) so that
// arithmetic never depends on the viewer's time zone.

export type Day = number;

export function fromYMD(y: number, m: number, d: number): Day {
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function parseISO(s: string): Day {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return fromYMD(y, m, d);
}

export function toYMD(day: Day): [number, number, number] {
  const dt = new Date(day * 86_400_000);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

export function toISO(day: Day): string {
  const [y, m, d] = toYMD(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function weekday(day: Day): number {
  // 0 = Monday ... 6 = Sunday (1970-01-01 was a Thursday)
  return (((day + 3) % 7) + 7) % 7;
}

/** dateutil.relativedelta(months=n) semantics: clamp the day to the month end. */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = toYMD(day);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fromYMD(ny, nm, Math.min(d, last));
}

/** Days since 2000-01-01, the encoding used by the published history files. */
export const EPOCH_2000 = fromYMD(2000, 1, 1);
