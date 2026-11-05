import React, { ReactNode, useEffect, useId, useRef, useState } from "react";
import { GLOSSARY } from "../content/glossary";
import { answerQuestion, AskContext, suggestedQuestions } from "../content/knowledge";

export interface Explanation {
  shows: ReactNode; // what the chart shows: securities, period, source, axes, units
  read: ReactNode; // how to read it
  now?: ReactNode; // what the current data indicates (computed from the current state)
  why: ReactNode; // why it matters
  limits: ReactNode; // what cannot be concluded
}

/** Collapsible "Understand this chart" panel; the data summary stays visible when present. */
export function Explain({ e, testId }: { e: Explanation; testId?: string }) {
  return (
    <div className="mt-3 border-t border-edge pt-3" data-testid={testId}>
      {e.now && (
        <div className="mb-2 rounded-lg bg-surface2 px-3 py-2 text-[13px] leading-relaxed text-ink2" data-testid={testId ? `${testId}-now` : undefined}>
          <span className="font-semibold text-ink">What the data shows: </span>{e.now}
        </div>
      )}
      <details className="group text-[13px]">
        <summary className="cursor-pointer select-none text-ink2 hover:text-ink">Understand this chart</summary>
        <dl className="mt-2 grid gap-2 leading-relaxed">
          <div><dt className="font-semibold text-ink">What this chart shows</dt><dd className="text-ink2">{e.shows}</dd></div>
          <div><dt className="font-semibold text-ink">How to read it</dt><dd className="text-ink2">{e.read}</dd></div>
          <div><dt className="font-semibold text-ink">Why it matters</dt><dd className="text-ink2">{e.why}</dd></div>
          <div><dt className="font-semibold text-ink">Key limitations</dt><dd className="text-ink2">{e.limits}</dd></div>
        </dl>
      </details>
    </div>
  );
}

/** Inline glossary term: a button that reveals a plain-English definition. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const g = GLOSSARY[k];
  return (
    <span className="relative inline">
      <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-ink" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((v) => !v)} onBlur={() => setOpen(false)}>{children ?? g.term}</button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-full z-20 mt-1 block w-72 rounded-lg border border-edge bg-surface2 p-3 text-left text-[12px] font-normal leading-relaxed text-ink2 shadow-lg">
          <span className="block font-semibold text-ink">{g.term}</span>{g.definition}
        </span>
      )}
    </span>
  );
}

/** "Ask about this chart": curated, context-aware answers (no AI involved). */
export function AskButton({ ctx }: { ctx: AskContext }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // Return focus to the button that opened the dialog (WAI-ARIA dialog pattern).
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)} className="rounded-md border border-edge px-2 py-0.5 text-[12px] text-ink2 hover:bg-surface2"
        aria-haspopup="dialog" aria-expanded={open} data-testid={`ask-${ctx.chart}`}>Ask about this chart</button>
      {open && <AskPanel ctx={ctx} onClose={close} />}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function AskPanel({ ctx, onClose }: { ctx: AskContext; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const noteId = useId();
  const suggestions = suggestedQuestions(ctx);
  const result = asked ? answerQuestion(asked, ctx) : null;
  useEffect(() => {
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // keep the page behind the dialog still
    return () => { document.body.style.overflow = prev; };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    // Focus trap: Tab and Shift+Tab cycle within the dialog.
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  const ask = (text: string) => { setQ(text); setAsked(text); };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={noteId} tabIndex={-1}
        onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-edge bg-surface p-5 shadow-2xl outline-none" data-testid="ask-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="kicker">Ask about this chart</div>
            <h2 id={titleId} className="mt-1 text-[16px] font-semibold text-ink">{ctx.title}</h2>
            <p className="mt-1 text-[12px] text-muted">{ctx.scope}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-edge px-2 py-1 text-[12px] text-ink2" aria-label="Close">✕</button>
        </div>
        <p id={noteId} className="mt-3 rounded-lg bg-surface2 p-2 text-[12px] text-muted">
          Curated answers written for this site, matched to your question by keywords. They are not generated by AI. Numbers come from the published data snapshot and the current chart selection.
        </p>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setAsked(q.trim()); }}>
          <label htmlFor={`${titleId}-q`} className="sr-only">Your question</label>
          <input id={`${titleId}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What is modified duration?" autoComplete="off"
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-edge bg-surface2 px-3 text-[14px] text-ink" />
          <button type="submit" className="min-h-[40px] rounded-lg border border-edge px-3 text-[13px] text-ink2 hover:bg-surface2">Ask</button>
        </form>
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <li key={s}><button type="button" onClick={() => ask(s)} className="min-h-[32px] rounded-full border border-edge px-2.5 py-1 text-left text-[12px] text-ink2 hover:bg-surface2">{s}</button></li>
          ))}
        </ul>
        {result && (
          <section className="mt-5" aria-live="polite" data-testid="ask-answer">
            <h3 className="text-[14px] font-semibold text-ink">{result.question}</h3>
            {result.answer && <div className="prose-lab mt-1 text-[14px]">{result.answer}</div>}
            {result.sources.length > 0 && <p className="mt-2 text-[12px] text-muted">Sources: {result.sources.join("; ")}</p>}
            {result.matched === "out-of-scope" && <p className="mt-2 text-[13px] text-ink2" data-testid="ask-out-of-scope">That question is about another chart or product, so it is not answered here. Questions about this chart:</p>}
            {result.matched === "none" && <p className="mt-2 text-[13px] text-ink2" data-testid="ask-no-match">No curated answer matches this question. Try one of these questions about this chart:</p>}
            {result.suggestions.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {result.suggestions.map((s) => <li key={s}><button type="button" onClick={() => ask(s)} className="text-left text-[13px] text-ink underline decoration-dotted underline-offset-2">{s}</button></li>)}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
