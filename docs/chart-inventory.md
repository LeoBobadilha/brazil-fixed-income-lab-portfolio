# Chart inventory

Every chart and analytical table on the site, with its data source, its meaning, its explanation
coverage and its contextual questions. The explanation coverage is checked by a browser test:
`every chart on every page has an explanation`. Q&A scoping is checked by
`web/src/content/knowledge.test.ts`.

**Column key.**

- **Explanation:** ✔ means the full five-part explanation (what it shows, how to read it, what
  the data shows, why it matters, limitations); a note means a short guidance note.
- **Responsive:** "yes" means the "What the data shows" sentence is recomputed from the current
  filters, dates or simulation inputs.
- **Ask id:** the chart identifier used for scoping the Q&A; "—" means no Ask button.

**Sources:**

- **TT:** Tesouro Transparente (Tesouro Direto prices and rates, federal debt stock);
- **BCB:** Banco Central do Brasil (SGS series, Focus survey);
- **IBGE:** IPCA index;
- **Engine:** this project's pricing and scenario engines.

## Market overview

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| Yield curve | TT | Purchase yields by duration on the selected date, against a comparison curve | ✔ | yes (family, type, bucket, date) | `overview.curve` |
| What changed | TT, Engine | Average and extreme yield changes between two dates, and the duration price effect | ✔ | yes (date, period) | `overview.changed` |
| Bond universe (table) | TT, Engine | Rates, price, change, duration, DV01 and percentile for every bond on offer | ✔ | yes (filters) | — |
| Benchmark history | TT, Engine | Constant-duration yield, slope, volatility or breakeven over time | ✔ | yes (series, range) | `overview.benchmark` |
| Largest 21-day moves (table) | TT, Engine | The biggest one-month moves of the benchmark | ✔ | yes (series) | `overview.moves` |
| Data quality | Engine | Freshness status and reconciliation summary | note | — | — |

## Bond explorer

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| Rate history | TT | Purchase and sale rates; the buy/sell spread | ✔ | yes (bond, range) | `explorer.rates` |
| Price history | TT | Sale price: realised mark-to-market | ✔ | yes (bond, range) | `explorer.price` |
| Price–yield relationship | TT, Engine | Observed points against today's cash-flow price curve; convexity | ✔ | yes (bond) | `explorer.price-yield` |
| Duration over time | Engine | Modified duration through the bond's life | ✔ | yes (bond) | `explorer.duration` |
| Historical rate distribution | TT | Where today's rate sits in the bond's history | ✔ | yes (bond) | `explorer.distribution` |
| Rate volatility | TT, Engine | Rolling annualised volatility of daily rate changes | ✔ | yes (bond, range) | `explorer.volatility` |
| Cash flows per year | Engine | Contractual payments per year | ✔ | yes (bond) | `explorer.cashflows` |
| Similar-duration securities (table) | TT | Peers with similar rate risk | ✔ | yes (bond) | — |
| Data coverage | TT | Days quoted and offered | note | — | — |

All Explorer Ask contexts carry the selected product, so questions are specific to it. For
example, VNA questions appear only for indexed bonds, pull-to-par only for fixed-rate bonds, and
Renda+ questions only for Renda+.

## Mark-to-Market Lab

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| 1. Observed mark-to-market after the reference date | TT | What actually happened to a purchase made on the reference date | ✔ | yes (bond, date) | `lab.observed` |
| 2. Price sensitivity on the reference date | Engine | Exact repricing against duration and convexity estimates | ✔ | yes | `lab.sensitivity` |
| Scenario comparison | Engine | Holding-period scenarios after costs and taxes | ✔ | yes (all inputs) | `lab.scenario` |
| Shock × horizon map (and optional 3D surface) | Engine | Net return for every shock and horizon | ✔ | yes | `lab.heatmap` |

## Comparison

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| Net value along the horizon | Engine | Final values of up to three alternatives under the same assumptions | ✔ | yes | `compare.path` |
| Side-by-side table | Engine | Value, real return, liquidity, inflation protection, risk and tax per alternative | page notice | yes | — |

## Renda+

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| Securities on offer (table) | TT | Cost per R$ 1 of monthly income by conversion year | ✔ | yes | `renda.lineup` |
| Renda+ versus conventional IPCA+ | TT | Real yields of Renda+ and zero-coupon IPCA+ by year | ✔ | yes | `renda.vs-ipca` |
| Accumulation simulator, breakdown and tax by purchase age | Engine | Income bought by monthly contributions, net of lot-by-lot income tax and custody | ✔ | yes (all inputs) | `renda.accumulation` |
| Payment calendar | Engine | Annual gross income, real or nominal | ✔ | yes | `renda.calendar` |
| Early sale: net real return | Engine | Return if sold before conversion, by horizon and yield change | ✔ | yes | `renda.early` |

## Macro and sovereign

| Chart | Source | Financial meaning | Explanation | Responsive | Ask id |
|---|---|---|---|---|---|
| Selic target and inflation | BCB | Policy rate against 12-month IPCA | ✔ | yes (range) | `macro.policy` |
| Real rates: policy vs. market | BCB, TT, Engine | Ex-post real policy rate against the 10-year market real yield | ✔ | yes (range) | `macro.real` |
| Focus expectations (table) | BCB | Median forecasts, range and respondents | ✔ | yes | `macro.focus` |
| Expected IPCA, following year | BCB | Inflation expectations over time | ✔ | yes (range) | `macro.focus-ipca` |
| Expected Selic, end of following year | BCB | Policy-rate expectations over time | ✔ | yes (range) | `macro.focus-selic` |
| Public debt | BCB | Gross (DBGG) and net (DLSP) debt, % of GDP; different perimeters | ✔ | yes | `macro.debt` |
| Primary balance, 12 months | BCB | Revenue minus non-interest spending | ✔ | yes | `macro.primary` |
| Nominal balance, 12 months | BCB | Balance including interest; the gap to the primary balance is the interest bill | ✔ | yes | `macro.nominal` |
| Composition by indexer | TT | Fixed-rate, Selic, inflation and FX shares of federal debt | ✔ | yes | `macro.dpf` |
| Maturity profile | TT | Debt reaching final maturity by period | ✔ | yes | `macro.maturity` |
| Time to final maturity | TT, Engine | Stock-weighted time to final maturity | ✔ | yes | `macro.term` |
| Debt maturing within 12 months | TT, Engine | Refinancing-risk share | ✔ | yes | `macro.short-term` |

## Research

| Chart | Source | Financial meaning | Evidence type | Explanation | Ask id |
|---|---|---|---|---|---|
| Is there a best time of the month to buy IPCA+? | TT, Engine | Day-of-month windows of rate changes | Statistical test, Holm-adjusted, with out-of-sample re-test (not supported) | ✔ | `research.calendar` |
| Original project's metric | TT | The legacy look-ahead metric | Biased; kept for transparency | ✔ | `research.legacy` |
| Yields relative to their own history | TT, Engine | Constant-duration yields with historical percentiles | Descriptive | ✔ | `research.percentile` |
| Current percentile (table) | Engine | Today's percentile by series | Descriptive | ✔ | — |
| Real-yield regimes | Engine | What followed each yield band | Descriptive (small effective sample) | ✔ | `research.regimes` |
| Largest price drawdowns | TT | Peak-to-trough falls | Observed history | ✔ | `research.drawdowns` |
| Daily changes by duration | Engine | Distribution of daily moves | Descriptive | ✔ | `research.daily` |
| Real curve slope (20y − 2y) | Engine | Steepening and flattening episodes | Descriptive | ✔ | `research.slope` |

## Methodology

| Chart | Source | Meaning | Explanation | Ask id |
|---|---|---|---|---|
| Which date means what | Manifest, build record | The five dates kept apart | inline | — |
| Sources, freshness and licences | Manifest | Freshness of each input | ✔ | `methodology.sources` |
| What kind of evidence each check provides | Reconciliation | Independent prediction vs consistency check | inline | — |
| Reconciliation with official prices | Engine | Share of official prices reproduced | ✔ | `methodology.reconciliation` |
| Exact prices by year | Engine | Accuracy over time | ✔ | `methodology.by-year` |
| Tesouro Selic spread precision | Engine | Why LFT is not exact after 2020 | ✔ | — |
| Independent vs consensus VNA | IBGE, BCB, Engine | Independent check of indexation | ✔ | — |
| Largest residual differences | Engine | Worst misses, kept visible | ✔ | — |
| Snapshot quality checks | Pipeline | Publication gate | ✔ | — |
| Automated tests | CI | Test results of the deployed build | ✔ | — |
