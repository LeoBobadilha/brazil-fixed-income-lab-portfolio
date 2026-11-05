// Brazilian national business-day calendar (ANBIMA convention), mirroring
// src/calendar_br.py. du(start, end) counts business days in [start, end).
import closures from "../../../config/calendars/td_settlement_closures.json";
import { Day, fromYMD, toYMD, weekday } from "./dates";

const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
const START = fromYMD(FIRST_YEAR, 1, 1);
const END = fromYMD(LAST_YEAR + 1, 1, 1);
export const CONSCIENCIA_NEGRA_LAW_DATE = fromYMD(2023, 12, 22);
const FUTURE_RULE_FROM_YEAR = 2026;

export function easterSunday(year: number): Day {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromYMD(year, month, day);
}

export function nationalHolidays(year: number, withNov20 = true): Day[] {
  const e = easterSunday(year);
  const days = [
    fromYMD(year, 1, 1), e - 48, e - 47, e - 2, fromYMD(year, 4, 21), fromYMD(year, 5, 1), e + 60,
    fromYMD(year, 9, 7), fromYMD(year, 10, 12), fromYMD(year, 11, 2), fromYMD(year, 11, 15), fromYMD(year, 12, 25),
  ];
  if (year >= 2024 && withNov20) days.push(fromYMD(year, 11, 20));
  return days;
}

/** cum[i] = business days in [START, START + i). */
function buildCumulative(holidays: Set<Day>): Int32Array {
  const n = END - START + 1;
  const cum = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const d = START + i;
    const bus = weekday(d) < 5 && !holidays.has(d);
    cum[i + 1] = cum[i] + (bus ? 1 : 0);
  }
  return cum;
}

function holidaySet(withNov20: boolean): Set<Day> {
  const s = new Set<Day>();
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) for (const d of nationalHolidays(y, withNov20)) s.add(d);
  return s;
}

let CUR: Int32Array | null = null;
let OLD: Int32Array | null = null;
let SETTLE_HOL: Set<Day> | null = null;

function cum(asof?: Day): Int32Array {
  const withNew = asof === undefined || asof >= CONSCIENCIA_NEGRA_LAW_DATE;
  if (withNew) return (CUR ??= buildCumulative(holidaySet(true)));
  return (OLD ??= buildCumulative(holidaySet(false)));
}

function idx(d: Day): number {
  if (d < START || d > END) throw new RangeError(`date outside calendar range: ${d}`);
  return d - START;
}

/** Business days in [start, end) on the calendar in force on `asof` (default: current). */
export function businessDays(start: Day, end: Day, asof?: Day): number {
  const c = cum(asof);
  return c[idx(end)] - c[idx(start)];
}

export function isBusinessDay(d: Day, asof?: Day): boolean {
  const c = cum(asof);
  return c[idx(d) + 1] - c[idx(d)] === 1;
}

/** Roll forward to a business day, then move n business days (numpy busday_offset roll='forward'). */
export function addBusinessDays(d: Day, n: number, asof?: Day): Day {
  let x = d;
  while (!isBusinessDay(x, asof)) x++;
  let k = n;
  while (k > 0) {
    x++;
    if (isBusinessDay(x, asof)) k--;
  }
  return x;
}

function settlementHolidays(): Set<Day> {
  if (SETTLE_HOL) return SETTLE_HOL;
  const s = new Set<Day>();
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) for (const d of nationalHolidays(y, true)) {
    const [yy, mm, dd] = toYMD(d);
    if (!(mm === 11 && dd === 20 && yy < 2024)) s.add(d);
  }
  for (const iso of closures.inferred) {
    const [y, m, d] = iso.split("-").map(Number);
    s.add(fromYMD(y, m, d));
  }
  for (let y = FUTURE_RULE_FROM_YEAR; y <= LAST_YEAR; y++) {
    s.add(fromYMD(y, 12, 24));
    s.add(fromYMD(y, 12, 31));
  }
  return (SETTLE_HOL = s);
}

/** Tesouro Direto settlement date (numpy busday_offset roll='backward' on the settlement calendar). */
export function settlementDate(base: Day, lag: number): Day {
  if (lag === 0) return base;
  const hol = settlementHolidays();
  const ok = (d: Day) => weekday(d) < 5 && !hol.has(d);
  let x = base;
  while (!ok(x)) x--;
  let k = lag;
  while (k > 0) {
    x++;
    if (ok(x)) k--;
  }
  return x;
}
