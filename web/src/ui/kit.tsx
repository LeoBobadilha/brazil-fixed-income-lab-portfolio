import { ReactNode, useId, useState } from "react";
import type { AskContext } from "../content/knowledge";
import { AskButton, Explain, type Explanation } from "./explain";

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="kicker">{kicker}</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
      {children && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink2">{children}</div>}
    </header>
  );
}

export type Basis = "observed" | "theoretical" | "scenario" | "statistical" | "expectation";
const BASIS: Record<Basis, string> = {
  observed: "Observed",
  theoretical: "Theoretical repricing",
  scenario: "Hypothetical scenario",
  statistical: "Historical statistic",
  expectation: "Market expectation",
};
const BASIS_ICON: Record<Basis, string> = { observed: "●", theoretical: "◆", scenario: "▲", statistical: "∑", expectation: "◌" };

export function BasisTag({ basis }: { basis: Basis }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] font-medium text-ink2" title={BASIS[basis]}>
      <span aria-hidden>{BASIS_ICON[basis]}</span>{BASIS[basis]}
    </span>
  );
}

export interface Column<R> { key: string; label: string | string; num?: boolean; render: (r: R) => ReactNode }

export function DataTable<R>({ columns, rows, caption, maxHeight = 360, rowKey, onRowClick, selected }: {
  columns: Column<R>[]; rows: R[]; caption: string; maxHeight?: number; rowKey: (r: R) => string;
  onRowClick?: (r: R) => void; selected?: string | null;
}) {
  return (
    <div className="overflow-auto rounded-lg" style={{ maxHeight }} tabIndex={0} role="region" aria-label={(caption)}>
      <table className="data">
        <caption className="sr-only">{(caption)}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? "num" : ""}>{typeof c.label === "string" ? c.label : (c.label)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} aria-selected={selected === k} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={onRowClick ? "cursor-pointer" : ""} tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r); } } : undefined}>
                {columns.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Card holding a chart, with a table view that carries every value (tooltips never gate). */
/** Plain-text form of an explanation's "shows" and "now" parts, for the Q&A panel. */
function explanationText(e?: Explanation): string | undefined {
  if (!e) return undefined;
  const parts = [e.shows, e.now].filter((x): x is string => typeof x === "string" && x.length > 0);
  return parts.length ? parts.join(" ") : undefined;
}

export function ChartCard({ title, subtitle, basis, note, table, children, actions, className = "", explain, ask }: {
  title: string; subtitle?: string | ReactNode; basis?: Basis; note?: string | ReactNode; table?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string;
  explain?: Explanation; ask?: Omit<AskContext, "title"> & { title?: string };
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`} aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {basis && <BasisTag basis={basis} />}
          {actions}
          {ask && <AskButton ctx={{ ...ask, title: ask.title ?? title, explanation: ask.explanation ?? explanationText(explain) }} />}
          {table && (
            <button type="button" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}
              className="rounded-md border border-edge px-2 py-0.5 text-[12px] text-ink2 hover:bg-surface2">
              {showTable ? "Chart" : "Table"}
            </button>
          )}
        </div>
      </div>
      {showTable && table ? table : children}
      {note && <div className="mt-3 text-[12px] leading-relaxed text-muted">{note}</div>}
      {explain && <Explain e={explain} testId={ask ? `explain-${ask.chart}` : undefined} />}
    </section>
  );
}


export function Stat({ label, value, sub, delta, deltaGood }: { label: string; value: ReactNode; sub?: ReactNode; delta?: string | null; deltaGood?: boolean | null }) {
  return (
    <div className="card p-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {(delta || sub) && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
          {delta && <span className="tnum" style={{ color: deltaGood == null ? "var(--text-secondary)" : deltaGood ? "var(--delta-up)" : "var(--status-critical)" }}>
            {deltaGood == null ? "" : deltaGood ? "▲ " : "▼ "}{delta}</span>}
          {sub && <span className="text-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}

export function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string | string }[]; onChange: (v: V) => void }) {
  return (
    <div role="radiogroup" aria-label={(label)} className="inline-flex flex-wrap rounded-lg border border-edge bg-surface2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[13px] ${value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink2 hover:text-ink"}`}>
          {typeof o.label === "string" ? o.label : (o.label)}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink2">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function Slider({ id, label, value, min, max, step, onChange, display }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string }) {
  return (
    <Field label={label} htmlFor={id} hint={<span className="tnum text-ink">{display}</span>}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={display} />
    </Field>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "stale"; children: ReactNode }) {
  const icon = kind === "info" ? "ℹ" : "⚠";
  const color = kind === "info" ? "var(--accent)" : "var(--status-warning)";
  return (
    <div role={kind === "info" ? "note" : "status"} className="card flex gap-3 p-3 text-[13px] text-ink2" style={{ borderColor: color }}>
      <span aria-hidden style={{ color }}>{icon}</span><div>{children}</div>
    </div>
  );
}

export function Loading() {
  return <div className="p-8 text-center text-muted" role="status">{"Loading data…"}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <Notice kind="warn">{"Could not load data: "}{message}</Notice>;
}

export function Swatch({ color, shape = "line" }: { color: string; shape?: "line" | "dot" | "rect" }) {
  if (shape === "dot") return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
  if (shape === "rect") return <span aria-hidden className="inline-block h-2.5 w-3 rounded-sm" style={{ background: color }} />;
  return <span aria-hidden className="inline-block h-[3px] w-3.5 rounded-sm" style={{ background: color }} />;
}
