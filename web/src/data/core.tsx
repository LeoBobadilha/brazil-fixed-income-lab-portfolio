import { createContext, ReactNode, useContext, useMemo } from "react";
import { useData } from "./load";
import type { Latest, LatestRow, Manifest, Security } from "./types";
import type { Tokens } from "../theme";
import type { Assumptions } from "../engine/scenario";
import { ErrorBox, Loading } from "../ui/kit";

interface Core {
  manifest: Manifest;
  securities: Security[];
  byId: Map<string, Security>;
  latest: Latest;
  latestById: Map<string, LatestRow>;
  assumptions: Assumptions;
}

const Ctx = createContext<Core | null>(null);

export function CoreProvider({ children }: { children: ReactNode }) {
  const m = useData<Manifest>("manifest.json");
  const s = useData<Security[]>("securities.json");
  const l = useData<Latest>("latest.json");
  const a = useData<Assumptions>("assumptions.json");
  const value = useMemo<Core | null>(() => {
    if (!m.data || !s.data || !l.data || !a.data) return null;
    return {
      manifest: m.data, securities: s.data, byId: new Map(s.data.map((x) => [x.id, x])), latest: l.data,
      latestById: new Map(l.data.rows.map((r) => [r.id, r])), assumptions: a.data,
    };
  }, [m.data, s.data, l.data, a.data]);
  const err = m.error || s.error || l.error || a.error;
  if (err) return <div className="mx-auto max-w-page p-6"><ErrorBox message={err} /></div>;
  if (!value) return <Loading />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCore(): Core {
  const c = useContext(Ctx);
  if (!c) throw new Error("CoreProvider missing");
  return c;
}

export function secName(s: Security): string {
  return s.name_en;
}

export function shortName(s: Security): string {
  const en: Record<string, string> = { LTN: "Prefixado", NTNF: "Prefixado coupon", LFT: "Selic", NTNBP: "IPCA+", NTNB: "IPCA+ coupon", RENDA: "Renda+", EDUCA: "Educa+", NTNC: "IGP-M+ coupon" };
  return `${en[s.code]} ${s.year}`;
}

export function familyColor(t: Tokens, s: Pick<Security, "family" | "code">): string {
  if (s.code === "RENDA" || s.code === "EDUCA") return t.ntnb1;
  return s.family === "nominal" ? t.nominal : s.family === "real" ? t.real : t.floating;
}

export const FAMILY_LABEL: Record<string, string> = {
  nominal: "Nominal (fixed-rate)",
  real: "Real (IPCA+)",
  floating: "Floating (Selic)",
};
