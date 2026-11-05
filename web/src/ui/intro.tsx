import { useState } from "react";
import { Link } from "react-router-dom";

const KEY = "bfil-intro-dismissed";

/** First-visit orientation: what the site provides and how to use the main simulator. */
export function Intro() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ }
  };
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="intro-h" data-testid="intro">
      <div className="flex items-start justify-between gap-3">
        <h2 id="intro-h" className="text-[15px] font-semibold text-ink">How to use this site</h2>
        <button type="button" onClick={close} className="rounded-md border border-edge px-2 py-0.5 text-[12px] text-ink2" aria-label="Dismiss the introduction">Dismiss</button>
      </div>
      <ul className="mt-2 grid gap-2 text-[14px] leading-relaxed text-ink2 md:grid-cols-3">
        <li><span className="font-semibold text-ink">Explore the market.</span> This page shows today's yield curves and what moved. Open any bond in the <Link className="underline" to="/bond">Bond Explorer</Link> for its full history.</li>
        <li><span className="font-semibold text-ink">Test a scenario.</span> In the <Link className="underline" to="/lab">Mark-to-Market Lab</Link>, pick a bond and a reference date, then change the yield shock and horizon to see the effect after costs and taxes.</li>
        <li><span className="font-semibold text-ink">Check the evidence.</span> Every chart has an explanation and an "Ask about this chart" panel; the <Link className="underline" to="/methodology">Methodology</Link> page shows how prices were validated against official data.</li>
      </ul>
    </section>
  );
}
