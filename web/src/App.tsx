import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CoreProvider, useCore } from "./data/core";
import { businessDays } from "./engine/calendar";
import { fromYMD, parseISO } from "./engine/dates";
import { useFmt } from "./format";
import { useTheme } from "./theme";
import { Loading, Notice } from "./ui/kit";

const Overview = lazy(() => import("./pages/Overview"));
const Explorer = lazy(() => import("./pages/Explorer"));
const Lab = lazy(() => import("./pages/Lab"));
const Compare = lazy(() => import("./pages/Compare"));
const Renda = lazy(() => import("./pages/Renda"));
const Macro = lazy(() => import("./pages/Macro"));
const Research = lazy(() => import("./pages/Research"));
const Methodology = lazy(() => import("./pages/Methodology"));

export const NAV: { to: string; label: string }[] = [
  { to: "/", label: "Market" },
  { to: "/bond", label: "Bond Explorer" },
  { to: "/lab", label: "Mark-to-Market Lab" },
  { to: "/compare", label: "Comparison" },
  { to: "/renda", label: "Renda+" },
  { to: "/macro", label: "Macro & Sovereign" },
  { to: "/research", label: "Research" },
  { to: "/methodology", label: "Methodology" },
];

function Header() {
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <header className="sticky top-0 z-30 border-b border-edge backdrop-blur" style={{ background: "color-mix(in srgb, var(--plane) 88%, transparent)" }}>
      <div className="mx-auto flex max-w-page items-center gap-4 px-4 py-3">
        <NavLink to="/" className="flex shrink-0 items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--surface-2)" />
            <path d="M6 22 C12 21 15 12 26 9" stroke="var(--series-real)" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M6 25 C13 24 17 18 26 16" stroke="var(--series-nominal)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </svg>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold text-ink">Brazil Fixed Income Lab</span>
            <span className="hidden text-[11px] text-muted sm:block">{"Treasury bonds, mark-to-market & macro research"}</span>
          </span>
        </NavLink>
        <nav aria-label={("Main")} className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-[13px] ${isActive ? "bg-surface2 text-ink" : "text-ink2 hover:text-ink"}`}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 xl:ml-2">
          <button type="button" onClick={() => setChoice(choice === "light" ? "dark" : "light")} className="rounded-md border border-edge px-2 py-1 text-[12px] text-ink2 hover:text-ink"
            aria-label={("Toggle light/dark theme")}>{choice === "light" ? "☾" : "☀"}</button>
          <button type="button" className="rounded-md border border-edge px-2 py-1 text-[12px] text-ink2 xl:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)}>
            {"Menu"}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label={("Main")} className="border-t border-edge xl:hidden">
          <ul className="mx-auto grid max-w-page grid-cols-2 gap-1 px-4 py-2 sm:grid-cols-4">
            {NAV.map((n) => (
              <li key={n.to}><NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => `block rounded-md px-2 py-2 text-[13px] ${isActive ? "bg-surface2 text-ink" : "text-ink2"}`}>{n.label}</NavLink></li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

function Freshness() {
  const { manifest } = useCore();
  const f = useFmt();
  // Staleness is also judged in the browser, so the banner appears even if the
  // scheduled refresh stops committing new snapshots.
  const now = new Date();
  const today = fromYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const lag = businessDays(parseISO(manifest.data_as_of), Math.max(today, parseISO(manifest.data_as_of)));
  if (manifest.status === "current" && lag <= 4) return null;
  return (
    <div className="mx-auto max-w-page px-4 pt-4">
      <Notice kind="stale">
        {"Data may be stale: "}
        {`last validated observation ${f.date(manifest.data_as_of)}`}
        {manifest.failed_sources.length > 0 && <> · {"sources that failed at the last refresh: "}{manifest.failed_sources.join(", ")}</>}
      </Notice>
    </div>
  );
}

function Footer() {
  const { manifest } = useCore();
  const f = useFmt();
  return (
    <footer className="mt-16 border-t border-edge">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-8 text-[12px] text-muted md:grid-cols-3">
        <div>
          <div className="font-semibold text-ink2">Brazil Fixed Income Lab</div>
          <p className="mt-1">{"Independent research on public data. Not investment advice. Scenarios are hypothetical, not forecasts."}</p>
        </div>
        <div>
          <div className="font-semibold text-ink2">{"Data"}</div>
          <p className="mt-1">{"Contains data from Tesouro Nacional (Tesouro Transparente), Banco Central do Brasil and IBGE. Derived databases under ODbL 1.0."}</p>
          <p className="mt-1 tnum">{"Data as of"}: {f.date(manifest.data_as_of)} · snapshot {manifest.snapshot_id}</p>
        </div>
        <div>
          <div className="font-semibold text-ink2">{"Code"}</div>
          <p className="mt-1"><a className="underline hover:text-ink" href="https://github.com/LeoBobadilha/brazil-fixed-income-lab-portfolio">Source code on GitHub</a> · MIT</p>
          <p className="mt-1">{"Built with Python, DuckDB, React and ECharts, with AI coding assistance."}</p>
        </div>
      </div>
    </footer>
  );
}

function Shell() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <Header />
      <CoreProvider>
        <Freshness />
        <main id="main" className="mx-auto max-w-page px-4 py-6">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/bond" element={<Explorer />} />
              <Route path="/bond/:id" element={<Explorer />} />
              <Route path="/lab" element={<Lab />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/renda" element={<Renda />} />
              <Route path="/macro" element={<Macro />} />
              <Route path="/research" element={<Research />} />
              <Route path="/methodology" element={<Methodology />} />
              <Route path="*" element={<Overview />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </CoreProvider>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ScrollTop />
      <Shell />
    </HashRouter>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}
