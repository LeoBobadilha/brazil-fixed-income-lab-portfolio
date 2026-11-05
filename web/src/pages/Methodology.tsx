import { useCore } from "../data/core";
import { useData } from "../data/load";
import type { BuildInfo, QualityCheck, Reconciliation } from "../data/types";
import { useFmt } from "../format";
import { ChartCard, DataTable, Loading, Notice, PageHeader } from "../ui/kit";

interface Tests { generated_at: string; suites: { name: string; tests: number; failures: number; errors: number; skipped: number }[] }

const SOURCE_LABEL: Record<string, string> = {
  tesouro_direto_prices: "Tesouro Direto prices and rates (Tesouro Transparente)",
  "sgs.selic_target": "Selic target (BCB SGS)", "sgs.selic_effective": "Effective Selic (BCB SGS)",
  "sgs.selic_daily": "Daily Selic factor (BCB SGS)", "sgs.cdi_annual": "CDI, annualised (BCB SGS)",
  "sgs.ipca_monthly": "IPCA monthly change (BCB SGS)", "sgs.ipca_12m": "IPCA 12-month change (BCB SGS)",
  "sgs.gross_debt_gdp": "General government gross debt, % GDP (BCB SGS)", "sgs.net_debt_gdp": "Public sector net debt, % GDP (BCB SGS)",
  "sgs.primary_balance_12m": "Primary balance, 12 months (BCB SGS)", "sgs.nominal_balance_12m": "Nominal balance, 12 months (BCB SGS)",
  ipca_index: "IPCA index numbers (IBGE SIDRA)", focus_annual: "Focus market expectations (BCB Olinda)",
  dpf_stock: "Federal public debt stock (Tesouro Transparente)",
};
const sourceLabel = (k: string) => SOURCE_LABEL[k] ?? k;
const TRIGGER: Record<string, string> = { code: "code change", data: "data refresh", manual: "manual run" };

const PRODUCT_NAME: Record<string, string> = { LTN: "Tesouro Prefixado (LTN)", NTNF: "Tesouro Prefixado with semiannual coupons (NTN-F)", LFT: "Tesouro Selic (LFT)", NTNBP: "Tesouro IPCA+ (NTN-B Principal)", NTNB: "Tesouro IPCA+ with semiannual coupons (NTN-B)", RENDA: "Tesouro Renda+ (NTN-B1)", EDUCA: "Tesouro Educa+ (NTN-B1)" };

export default function Methodology() {
  const { manifest, assumptions } = useCore();
  const rec = useData<Reconciliation>("reconciliation.json");
  const q = useData<QualityCheck[]>("quality.json");
  const tests = useData<Tests>("tests.json");
  const build = useData<BuildInfo>("build.json");
  const f = useFmt();
  const fresh = manifest.source_freshness ?? {};
  const thr = manifest.freshness_thresholds;
  const td = manifest.sources.tesouro_direto_prices;
  const dateCards: [string, string, string][] = [
    ["Market observation", f.date(manifest.data_as_of), "The trading day that the latest official Tesouro Direto prices and rates refer to."],
    ["Source publication", td?.source_published_at ? f.date(td.source_published_at.slice(0, 10)) : "–", "When Tesouro Transparente last updated the price file; it publishes after the trading day."],
    ["Last successful fetch", td?.last_success_at ? f.date(td.last_success_at.slice(0, 10)) : "–", "When this project last downloaded the price file without error."],
    ["Snapshot build", f.date(manifest.generated_at.slice(0, 10)), `When the validated datasets were generated (snapshot ${manifest.snapshot_id}).`],
    ["Site deployment", build.data ? f.date(build.data.built_at.slice(0, 10)) : "Local build",
      build.data ? `Built from commit ${build.data.commit.slice(0, 7)} after a ${TRIGGER[build.data.trigger] ?? build.data.trigger}.` : "This copy was not produced by the deployment workflow, so it has no deployment record."],
  ];

  const exact = (code: string) => rec.data?.by_product.find((r) => r.product_code === code)?.exact_pct;
  const mfacts: Record<string, string> = { dataAsOf: f.date(manifest.data_as_of), status: manifest.status };
  if (exact("LTN") != null) mfacts.exactLTN = f.pct(exact("LTN")! * 100, 2);
  if (exact("NTNB") != null) mfacts.exactNTNB = f.pct(exact("NTNB")! * 100, 2);
  const mask = (chart: string, scope: string) => ({ page: "methodology", chart: `methodology.${chart}`, scope, facts: mfacts });
  const staleList = Object.entries(manifest.source_freshness ?? {}).filter(([, v]) => v.stale).map(([k]) => k);
  const years = rec.data ? Object.keys(rec.data.by_year.LTN ?? {}).sort() : [];
  const shownYears = years.filter((y) => Number(y) >= 2005);

  return (
    <div className="space-y-5">
      <PageHeader kicker="Methodology & data quality" title="How the numbers are produced and checked">
        {"Official sources, Tesouro Nacional pricing conventions, reconciliation with every historical official price, and the model's known limits."}
      </PageHeader>

      <section className="card p-5" aria-labelledby="dates" data-testid="dates-panel">
        <h2 id="dates" className="text-[15px] font-semibold text-ink">Which date means what</h2>
        <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-5">
          {dateCards.map(([k, v, d]) => (
            <div key={k} className="rounded-lg border border-edge p-3">
              <dt className="kicker">{k}</dt>
              <dd className="mt-1 text-[15px] font-semibold text-ink">{v}</dd>
              <dd className="mt-1 text-[12px] leading-relaxed text-muted">{d}</dd>
            </div>
          ))}
        </dl>
        {build.data && <p className="mt-3 text-[12px] text-muted">Deployment record: workflow run {build.data.run_id}, commit <code>{build.data.commit.slice(0, 12)}</code>.</p>}
      </section>

      <ChartCard title="Sources, freshness and licences" subtitle={`Snapshot ${manifest.snapshot_id} · overall status: ${manifest.status}`}
        ask={mask("sources", `Snapshot ${manifest.snapshot_id}`)}
        explain={{
          shows: "Every dataset the site uses, the date of its latest observation, whether it is fresh, when it was last downloaded successfully and when the source published it.",
          read: "A tick means the source is within its freshness threshold; a warning means it is older than allowed or the last download failed, in which case the last validated data stays online.",
          now: staleList.length ? `${staleList.length} source(s) currently flagged: ${staleList.map(sourceLabel).join(", ")}.` : "Every source is within its freshness threshold.",
          why: "Knowing how recent each input is tells you how current each chart is.",
          limits: "Monthly series are published with a one- to two-month lag, so fresh does not mean today.",
        }}
        note={`A source is stale when its latest observation is older than its cadence allows${thr ? ` (daily quotes: ${thr.quotes_max_business_days} business days; other daily series: ${thr.daily_max_business_days} business days; weekly: ${thr.weekly_max_calendar_days} days; monthly: ${thr.monthly_max_calendar_days} days after month-end)` : ""}. The same thresholds drive the status badge in the header. If a source fails, the last validated snapshot stays online and is marked stale. Derived databases follow ODbL 1.0, as required by the sources.`}>
        <DataTable caption="Sources" rowKey={([k]) => k} rows={Object.entries(manifest.sources)} maxHeight={460} columns={[
          { key: "k", label: "Dataset", render: ([k]) => sourceLabel(k) },
          { key: "o", label: "Latest observation", render: ([k]) => (fresh[k]?.reference_date ? f.date(fresh[k].reference_date!) : "–") },
          { key: "s", label: "Freshness", render: ([k, v]) => {
            const st = fresh[k];
            const failed = v.status != null && v.status !== "ok";
            const label = failed ? `fetch failed${v.failed_at ? ` on ${f.date(v.failed_at.slice(0, 10))}` : ""}` : st?.stale ? (st.stale_reason ?? "stale") : "fresh";
            return <span style={{ color: failed || st?.stale ? "var(--status-warning)" : "var(--good-text)" }}>{failed || st?.stale ? `⚠ ${label}` : `✔ ${label}`}</span>;
          } },
          { key: "f", label: "Last successful fetch", render: ([, v]) => (v.last_success_at ? f.date(v.last_success_at.slice(0, 10)) : "–") },
          { key: "p", label: "Source publication", render: ([, v]) => (v.source_published_at ? f.date(v.source_published_at.slice(0, 10)) : "–") },
        ]} />
        <ul className="mt-3 space-y-1 text-[12px] text-muted">
          {Object.entries(manifest.licences).map(([k, v]) => <li key={k}><a className="underline hover:text-ink" href={v.landing}>{v.publisher}</a> · {v.licence}</li>)}
        </ul>
      </ChartCard>

      <section className="card p-5" aria-labelledby="conv">
        <h2 id="conv" className="text-[15px] font-semibold text-ink">{"Pricing conventions"}</h2>
        <div className="prose-lab text-[14px]">
          <p>{"Price = future cash flows discounted at the annual rate on a 252-business-day basis: PU = Σ Fᵢ / (1 + rate)^(duᵢ/252). For indexed bonds the cotação (% of nominal value) multiplies the projected VNA (IPCA) or the Selic VNA."}</p>
          <ul>
            <li>{"Official truncation: rate 6 dp; du/252 14 dp; discounted flows rounded to 10 dp (9 for NTN-F); cotação truncated to 4; PU to 6 (displayed with 2 on Tesouro Direto); VNA to 6."}</li>
            <li>{"ANBIMA national-holiday calendar in force on the pricing date: the 20 November holiday (Lei 14.759/2023) only enters prices computed from 22/12/2023, including for future dates."}</li>
            <li>{"Settlement identified in the official data: buy D+1; sell D+1 until 10/09/2021 and D+0 from 13/09/2021; 'PU Base' D+0. D+1 settlement skips 50 non-settlement days (24/31 Dec, São Paulo holidays in 2013–2021, 2014 World Cup days), inferred and documented."}</li>
            <li>{"Renda+ and Educa+ (NTN-B1): the Tesouro Transparente 'maturity' is the final instalment. Commercial year = maturity year − 19 (Renda+) or − 4 (Educa+). Instalments Ta = trunc₆(100/n), the last adjusted so they sum to 100."}</li>
            <li>{"Security identifier: product + maturity date (e.g. RENDA-20841215 = Renda+ 2065). The same commercial name does not mean the same instrument."}</li>
            <li>{"Sensitivity: Macaulay and modified duration, convexity and DV01 on unrounded flows on a du/252 basis. For Tesouro Selic the rate is the spread over Selic."}</li>
          </ul>
        </div>
      </section>

      {!rec.data ? <Loading /> : (
        <>
          {rec.data.validation_categories && (
            <section className="card p-5" aria-labelledby="valcat" data-testid="validation-categories">
              <h2 id="valcat" className="text-[15px] font-semibold text-ink">What kind of evidence each check provides</h2>
              <p className="mt-1 text-[13px] text-muted">Not every reconciliation is an independent prediction. Each category states how independent its evidence is.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rec.data.validation_categories.map((c) => (
                  <article key={c.id} className="rounded-lg border border-edge p-3">
                    <h3 className="text-[14px] font-semibold text-ink">{c.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink2">{c.what}</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted"><span className="font-semibold">Independence: </span>{c.independence}</p>
                    {c.id === "nominal_history" && rec.data!.independent_nominal && (
                      <p className="mt-2 text-[12px] text-muted">{Object.entries(rec.data!.independent_nominal).map(([k, v]) => `${k}: ${f.pct(v.within_1c_pct * 100, 2)} of ${f.num(v.rows, 0)} prices within R$ 0.01`).join(" · ")}</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          <ChartCard basis="statistical" title="Reconciliation with official prices"
            subtitle="Every historical buy, sell and base price recomputed by the engine"
            ask={mask("reconciliation", "Reconciliation with official prices")}
            explain={{
              shows: "For each product, the share of every published historical price that the pricing engine reproduces exactly, within R$ 0.01 and within R$ 0.02, and the largest difference.",
              read: "Exact means the engine's price equals Tesouro's published price to the cent. Read it with the evidence categories above: fixed-rate bonds are an independent prediction from the published rate, while IPCA-linked bonds test consistency with a VNA inferred from the same day's prices.",
              now: `Fixed-rate LTN: ${f.pct((rec.data.by_product.find((r) => r.product_code === "LTN")?.exact_pct ?? 0) * 100, 2)} exact; IPCA+ NTN-B: ${f.pct((rec.data.by_product.find((r) => r.product_code === "NTNB")?.exact_pct ?? 0) * 100, 2)} exact.`,
              why: "A mark-to-market simulator is only as reliable as its pricing. Reproducing official prices shows that the engine follows Tesouro's conventions (business-day counts, truncation, VNA).",
              limits: "High agreement does not validate scenario assumptions (future yields, inflation, taxes). Tesouro Selic after 2020 cannot match to the cent because the published spread is rounded to 2 decimals.",
            }}
            note="For IPCA-linked bonds Tesouro does not publish its daily projected VNA. For each date the test checks whether a single VNA reproduces every IPCA-linked price of that day to the cent (very different cash-flow structures). An independent VNA built only from the IBGE index confirms the value.">
            <DataTable caption="Reconciliation by product" rowKey={(r) => r.product_code} rows={rec.data.by_product} columns={[
              { key: "p", label: "Product", render: (r) => PRODUCT_NAME[r.product_code] ?? r.product_code },
              { key: "n", label: "Prices", num: true, render: (r) => f.num(r.rows, 0) },
              { key: "e", label: "Exact", num: true, render: (r) => f.pct(r.exact_pct * 100, 2) },
              { key: "1", label: "±R$ 0.01", num: true, render: (r) => f.pct(r.within_1c_pct * 100, 2) },
              { key: "2", label: "±R$ 0.02", num: true, render: (r) => f.pct(r.within_2c_pct * 100, 2) },
              { key: "m", label: "Max error", num: true, render: (r) => f.brl(r.max_abs_error) },
              { key: "d", label: "Period", render: (r) => `${r.first.slice(0, 4)}–${r.last.slice(0, 4)}` }]} />
          </ChartCard>

          <ChartCard basis="statistical" title="Exact prices by year" subtitle="Share of official prices reproduced to the cent"
            ask={mask("by-year", "Exact prices by year")}
            explain={{
              shows: "For each product and year, the percentage of official prices that the engine reproduces exactly to the cent.",
              read: "Dark cells are years with at least 99% exact; light cells 90–99%; red cells below 90%.",
              why: "It shows whether accuracy is stable over time or breaks down in specific periods, such as after a change in rules or data format.",
              limits: "Tesouro Selic after 2020 is red by construction: its published spread is rounded to 2 decimals. Years with few observations can look worse than they are.",
            }}>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={("Exact prices by year")}>
              <table className="data min-w-[900px]">
                <thead><tr><th scope="col">{"Product"}</th>{shownYears.map((y) => <th key={y} scope="col" className="num">{y.slice(2)}</th>)}</tr></thead>
                <tbody>{Object.entries(rec.data.by_year).map(([p, ys]) => (
                  <tr key={p}><th scope="row" className="!normal-case">{p}</th>{shownYears.map((y) => {
                    const v = ys[y];
                    const bg = v == null ? "transparent" : v >= 0.99 ? "color-mix(in srgb, var(--div-pos) 35%, transparent)" : v >= 0.9 ? "color-mix(in srgb, var(--div-pos) 15%, transparent)" : "color-mix(in srgb, var(--div-neg) 30%, transparent)";
                    return <td key={y} className="num" style={{ background: bg }}>{v == null ? "" : f.num(v * 100, 0)}</td>;
                  })}</tr>))}</tbody>
              </table>
            </div>
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard basis="statistical" title="Tesouro Selic spread precision"
              subtitle="Spread implied by the official price (independent VNA) minus published spread, in bp"
              note="Since 2020 the difference stays within ±0.5 bp: the 2-decimal published spread is a rounding of a more precise rate. That is why LFT is not reproduced to the cent after 2020 (typical error R$ 0.50 on ~R$ 20k)."
              explain={{
                shows: "The spread over Selic implied by each official Tesouro Selic price (using an independent Selic VNA) minus the published spread, by year.",
                read: "Values within ±0.5 bp are exactly what rounding a precise spread to 2 decimals produces.",
                why: "It explains a known limitation instead of hiding it: the published data cannot support cent-level accuracy for this product.",
                limits: "Explains the residual; it does not remove it.",
              }}>
              <DataTable caption="LFT" rowKey={([y]) => y} rows={Object.entries(rec.data.lft_spread_precision_bp_by_year)} maxHeight={300} columns={[
                { key: "y", label: "Year", render: ([y]) => y },
                { key: "1", label: "p1", num: true, render: ([, v]) => f.num(v["1%"], 2) },
                { key: "5", label: "median", num: true, render: ([, v]) => f.num(v["50%"], 2) },
                { key: "9", label: "p99", num: true, render: ([, v]) => f.num(v["99%"], 2) },
                { key: "n", label: "n", num: true, render: ([, v]) => f.num(v.count, 0) }]} />
            </ChartCard>
            <ChartCard basis="statistical" title="Independent vs consensus VNA" subtitle="Difference in bp (5th, 50th, 95th percentiles)"
              note="IPCA: the independent VNA uses the month's realised IPCA as the projection (Tesouro uses the ANBIMA projection, which is not open data), hence a few bp of difference."
              explain={{
                shows: "The difference between a VNA built only from IBGE (IPCA) or BCB (Selic) data and the VNA implied by official prices, in basis points.",
                read: "Values near zero mean two independent routes reach the same updated nominal value.",
                why: "It is independent evidence that the indexation inputs are right, not just consistent.",
                limits: "The IPCA route uses realised inflation for the current month as a proxy for the ANBIMA projection, which explains the few-bp differences.",
              }}>
              <DataTable caption="VNA" rowKey={([k]) => k} rows={Object.entries(rec.data.independent_vna_diff_bp)} columns={[
                { key: "k", label: "Indexer", render: ([k]) => k.toUpperCase() },
                { key: "5", label: "p5", num: true, render: ([, v]) => f.num(v["5%"], 2) }, { key: "50", label: "p50", num: true, render: ([, v]) => f.num(v["50%"], 2) },
                { key: "95", label: "p95", num: true, render: ([, v]) => f.num(v["95%"], 2) }, { key: "n", label: "n", num: true, render: ([, v]) => f.num(v.count, 0) }]} />
            </ChartCard>
          </div>

          <ChartCard basis="statistical" title="Largest residual differences" subtitle="Concentrated on a few days and securities near maturity; kept visible rather than hidden"
            explain={{
              shows: "The individual official prices that the engine misses by the largest amounts, with the model price and the difference.",
              read: "Look for clusters by date or security: isolated misses near maturity are typical of rounding in the official data.",
              why: "Showing the worst cases lets readers judge the accuracy claim themselves.",
              limits: "A small number of residuals are not explained; they are documented, not corrected by fitting.",
            }}>
            <DataTable caption="Residuals" rowKey={(r) => `${r.id}${r.date}${r.side}`} rows={rec.data.largest_errors.slice(0, 12)} columns={[
              { key: "i", label: "Security", render: (r) => <code className="text-[12px]">{r.id}</code> }, { key: "d", label: "Date", render: (r) => f.date(r.date) },
              { key: "s", label: "Side", render: (r) => r.side }, { key: "o", label: "Official", num: true, render: (r) => f.brl(r.official) },
              { key: "m", label: "Model", num: true, render: (r) => f.brl(r.model) }, { key: "e", label: "Difference", num: true, render: (r) => f.brl(r.error) }]} />
          </ChartCard>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Snapshot quality checks" subtitle="Blocking failures prevent publication"
          explain={{
            shows: "Every automatic check run on the latest snapshot before publication, with its result.",
            read: "A cross is a blocking failure: the snapshot would not have been published. A warning is published but flagged.",
            now: q.data ? `${q.data.filter((c) => c.passed).length} of ${q.data.length} checks passed.` : undefined,
            why: "Checks such as duplicate keys, out-of-range rates and shrinking history stop a bad download from reaching the site.",
            limits: "Checks catch structural problems; they cannot detect a plausible but wrong official value.",
          }}>
          {q.data ? <DataTable caption="Checks" rowKey={(c) => c.name} rows={q.data} maxHeight={360} columns={[
            { key: "s", label: "", render: (c) => <span style={{ color: c.passed ? "var(--good-text)" : c.severity === "error" ? "var(--status-critical)" : "var(--status-warning)" }} aria-label={c.passed ? "pass" : "fail"}>{c.passed ? "✔" : c.severity === "error" ? "✖" : "⚠"}</span> },
            { key: "n", label: "Check", render: (c) => <code className="text-[12px]">{c.name}</code> },
            { key: "d", label: "Detail", render: (c) => c.detail }]} /> : <Loading />}
        </ChartCard>
        <ChartCard title="Automated tests" subtitle={tests.data ? `Run of ${f.date(tests.data.generated_at.slice(0, 10))}` : undefined}
          note="Includes official Tesouro worked examples (frozen values), hand-computed cost and tax cases, Python/TypeScript parity, scenario consistency, a security audit and browser tests."
          explain={{
            shows: "The results of the automated test suites run for the deployed build, by suite.",
            read: "Failures must be zero for a deployment to happen; skipped tests are properties that do not apply to some bonds.",
            now: tests.data ? `${tests.data.suites.reduce((n, s) => n + s.tests, 0)} tests in ${tests.data.suites.length} suites.` : "Test results are published only with deployed builds.",
            why: "It shows that the published numbers passed the same checks described on this page.",
            limits: "Tests cover documented rules and examples; they cannot prove the absence of errors in cases nobody anticipated.",
          }}>
          {tests.data ? <DataTable caption="Tests" rowKey={(s) => s.name} rows={tests.data.suites} columns={[
            { key: "n", label: "Suite", render: (s) => s.name }, { key: "t", label: "Tests", num: true, render: (s) => String(s.tests) },
            { key: "f", label: "Failures", num: true, render: (s) => String(s.failures + s.errors) }, { key: "k", label: "Skipped", num: true, render: (s) => String(s.skipped) }]} />
            : <p className="text-[13px] text-muted">{"Test summary unavailable for this snapshot."}</p>}
        </ChartCard>
      </div>

      <section className="card p-5" aria-labelledby="lim">
        <h2 id="lim" className="text-[15px] font-semibold text-ink">{"Assumptions, observed vs simulated, and limitations"}</h2>
        <div className="prose-lab text-[14px]">
          <ul>
            <li>{"Observed: official Tesouro Direto prices and rates (morning quote). Theoretical: immediate cash-flow repricing. Scenario: explicit horizon, shock, inflation, Selic, reinvestment, cost and tax assumptions."}</li>
            <li>{`Costs and taxes: version ${assumptions.version}, reference ${f.date(assumptions.reference_date)}. B3 custody 0.20% p.a., accrued daily from settlement and collected at each coupon, sale and maturity (Tesouro Selic exempt up to R$ 10k). Renda+ and Educa+: no custody while held; 0.10% on monthly receipts above 6 (Renda+) or 4 (Educa+) minimum wages; an early sale pays 0.50/0.20/0.10% p.a. on the amount sold, by holding period. Regressive IR 22.5/20/17.5/15%; IOF below 30 days. Whether custody reduces the IR base is not confirmed by an official source, so by default it does not; the alternative is shown as a sensitivity.`}</li>
            <li>{"Visitors are not assumed to be Brazilian tax residents; non-resident and cross-border taxation is not calculated."}</li>
            <li>{"Tesouro IGPM+ (NTN-C) is shown with observed data only: there is a single security and no second one to validate the VNA."}</li>
            <li>{"DPF maturity: weighted time to final maturity, different from the official average maturity that weights all cash flows."}</li>
            <li>{"Reproducibility: python -m src.pipeline rebuilds everything from the official sources; tests run on GitHub Actions on every change."}</li>
          </ul>
        </div>
      </section>
      <Notice>{"Technical portfolio project built with AI coding assistance; every financial conclusion is checked against official data and worked examples."}</Notice>
      <span className="sr-only">{("End of page")}</span>
    </div>
  );
}
