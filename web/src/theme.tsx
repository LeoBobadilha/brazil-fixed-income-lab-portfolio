import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface Tokens {
  mode: "dark" | "light";
  surface: string; surface2: string; plane: string; ink: string; ink2: string; muted: string; grid: string; baseline: string; border: string;
  accent: string; nominal: string; real: string; floating: string; inflation: string; ntnb1: string; debtGross: string; debtNet: string; red: string;
  divNeg: string; divMid: string; divPos: string; good: string; warning: string; critical: string; deltaUp: string;
}

const VARS: Record<Exclude<keyof Tokens, "mode">, string> = {
  surface: "--surface-1", surface2: "--surface-2", plane: "--plane", ink: "--text-primary", ink2: "--text-secondary", muted: "--text-muted",
  grid: "--gridline", baseline: "--baseline", border: "--border", accent: "--accent", nominal: "--series-nominal", real: "--series-real",
  floating: "--series-floating", inflation: "--series-inflation", ntnb1: "--series-ntnb1", debtGross: "--series-debt-gross",
  debtNet: "--series-debt-net", red: "--series-red", divNeg: "--div-neg", divMid: "--div-mid", divPos: "--div-pos",
  good: "--status-good", warning: "--status-warning", critical: "--status-critical", deltaUp: "--delta-up",
};

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Tokens;
  for (const [k, v] of Object.entries(VARS)) (out as unknown as Record<string, string>)[k] = cs.getPropertyValue(v).trim() || "#888";
  out.mode = cs.colorScheme.includes("light") ? "light" : "dark";
  return out;
}

interface ThemeCtx { tokens: Tokens; choice: "auto" | "dark" | "light"; setChoice: (c: "auto" | "dark" | "light") => void; reducedMotion: boolean }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<"auto" | "dark" | "light">(() => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" || t === "light" ? t : "auto";
  });
  const [tokens, setTokens] = useState<Tokens>(readTokens);
  const [reducedMotion, setRM] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const setChoice = useCallback((c: "auto" | "dark" | "light") => {
    setChoiceState(c);
    if (c === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = c;
    try { if (c === "auto") localStorage.removeItem("bfil-theme"); else localStorage.setItem("bfil-theme", c); } catch { /* ignore */ }
    setTokens(readTokens());
  }, []);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const rm = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const on = () => setTokens(readTokens());
    const onRm = () => setRM(rm?.matches ?? false);
    mq?.addEventListener?.("change", on);
    rm?.addEventListener?.("change", onRm);
    return () => { mq?.removeEventListener?.("change", on); rm?.removeEventListener?.("change", onRm); };
  }, []);
  const value = useMemo(() => ({ tokens, choice, setChoice, reducedMotion }), [tokens, choice, setChoice, reducedMotion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("ThemeProvider missing");
  return c;
}
