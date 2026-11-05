# Chart explanations and the contextual Q&A

## Explanation architecture

Each chart card (`ChartCard` in `web/src/ui/kit.tsx`) can carry an `explain` object
(`Explanation` in `web/src/ui/explain.tsx`) with five fields:

| Field | Content | Shown |
|---|---|---|
| `shows` | What the chart plots and the source | Inside "Understand this chart" |
| `read` | How to read it | Inside "Understand this chart" |
| `now` | What the current data indicates | Always visible, as "What the data shows" |
| `why` | Why it matters | Inside "Understand this chart" |
| `limits` | Limitations and what it does not show | Inside "Understand this chart" |

The `now` sentence is built from the same arrays the chart plots, after filters, ranges and dates
are applied, so it changes with the selection. `<Term k="…">` links a word to the glossary
(`web/src/content/glossary.ts`, 23 terms).

**Coverage.** Every chart and analytical table on all eight pages has an
explanation or guidance note: 56 entries in total, listed with their sources, meaning and Ask identifiers in
[chart-inventory.md](chart-inventory.md). The browser test `every chart on every page has an
explanation` fails if a chart is added without one.

## Contextual Q&A ("Ask about this chart")

- **Content:** `web/src/content/knowledge.ts`. About 28 curated entries, each with a question,
  keywords, the charts it applies to (exact chart ids, page prefixes such as `lab.`, or `*`), an
  answer function and sources.
- **Scope (eligibility, not ranking):** each entry declares the pages, charts and, where relevant,
  products it applies to; pages pass the selected product. Only eligible entries are suggested or
  matched, including exact questions. A Renda+ question on an IPCA+ chart is declined as out of
  scope, bond concepts do not appear on macro, research or methodology charts, and a generic
  "What does this chart show?" answers from the chart's own explanation.
- **Matching:** free text is normalised (synonyms, light stemming, stop words) and scored against
  each eligible entry's keywords. Generic single words cannot decide a match. Below the threshold
  the panel declines and offers questions about the current chart.
- **Numbers, by provenance:** every number in an answer is one of:
  - an official constant registered in `OFFICIAL` with its source (for example the income-tax
    table or the 240 Renda+ instalments);
  - a fixed teaching example the entry declares;
  - a fact the entry declares in `uses`, supplied by the page and registered in `FACT_KINDS` as
    observed, derived, scenario, date or label.

  Tests fail on any number of unknown provenance, or on an answer that changes when undeclared
  facts are added. When a fact is missing, the sentence that needs it is left out.
- **Labelling:** the panel states that answers are curated, matched by keywords and not generated
  by AI.
- **Tests:** `knowledge.test.ts` checks that every chart with an Ask button has at least three
  scoped questions, that every number in an answer comes from facts or fixed text, that facts can
  be missing, that off-topic questions are declined, and that no answer reads as a forecast. The
  e2e tests open the panel, ask a suggested question, ask an off-topic one, and close it with
  Escape.

## Educational content sources

Explanations and answers paraphrase these sources; no text is copied:

- Tesouro Nacional, *Metodologia de Cálculo dos Títulos Públicos Federais* (pricing, VNA,
  truncation);
- Tesouro Direto product pages and worked examples, including *Cálculo da Rentabilidade –
  Tesouro RendA+*;
- B3, *Tarifas de Tesouro Direto* (custody, Selic exemption, Renda+ and Educa+ rules);
- Tesouro Direto rules and the Renda+ and Educa+ early-redemption tables;
- Receita Federal and B3 guidance on income tax and IOF on fixed income;
- Banco Central do Brasil (SGS series definitions, Focus survey, NFSP sign convention);
- IBGE (IPCA).

General concepts (duration, convexity, DV01, yield curve, mark-to-market) follow standard
fixed-income textbook definitions.

## Performance

Production build, gzip sizes:

- First load of the Market page: about 321 kB in total:
  - entry chunk 17.5 kB;
  - React 81.4 kB;
  - ECharts 215.6 kB;
  - page chunk 6.6 kB.
- Three.js (137 kB) loads only when the 3D surface is opened.
- Explanations and the knowledge base add a few kB per page chunk.
- No model or inference runtime is downloaded.
