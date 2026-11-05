import { useEffect, useState } from "react";
import { EPOCH_2000, toISO } from "../engine/dates";
import type { DecodedHistory, History } from "./types";

const cache = new Map<string, Promise<unknown>>();

export function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`;
}

export function loadJSON<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    const p = fetch(dataUrl(file)).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return cache.get(file) as Promise<T>;
}

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean }

/** Load one dataset; keeps the previous value while a new file loads (no layout jump). */
export function useData<T>(file: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: !!file });
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loadJSON<T>(file).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: Error) => alive && setState((s) => ({ data: s.data, error: e.message, loading: false })),
    );
    return () => { alive = false; };
  }, [file]);
  return state;
}

const scale = (a: (number | null)[], k: number) => a.map((v) => (v == null ? null : v / k));

export function decodeHistory(h: History): DecodedHistory {
  return {
    id: h.id,
    dates: h.d.map((x) => toISO(EPOCH_2000 + x)),
    buyRate: scale(h.br, 100), sellRate: scale(h.sr, 100), buyPrice: scale(h.bp, 100), sellPrice: scale(h.sp, 100),
    macaulay: scale(h.mac, 1000), modified: scale(h.mod, 1000), convexity: scale(h.cvx, 10), dv01: scale(h.dv01, 10000),
  };
}

export function useHistory(id: string | null) {
  const raw = useData<History>(id ? `history/${id}.json` : null);
  const [decoded, setDecoded] = useState<DecodedHistory | null>(null);
  useEffect(() => { if (raw.data) setDecoded(decodeHistory(raw.data)); }, [raw.data]);
  return { data: decoded, loading: raw.loading, error: raw.error };
}

export function benchmarkDates(d: number[]): string[] {
  return d.map((x) => toISO(EPOCH_2000 + x));
}

const vnaIndex = new WeakMap<object, Map<string, number>>();

/** Price-implied VNA on exactly `iso` (no interpolation, no future data); null when unavailable. */
export function vnaOn(v: import("./types").VnaHistory, indexer: "ipca" | "selic", iso: string): number | null {
  let idx = vnaIndex.get(v);
  if (!idx) {
    idx = new Map(v.d.map((x, i) => [toISO(EPOCH_2000 + x), i]));
    vnaIndex.set(v, idx);
  }
  const i = idx.get(iso);
  return i == null ? null : v[indexer][i] ?? null;
}
