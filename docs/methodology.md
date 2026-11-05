# Methodology

## 1. Data sources

| Dataset | Publisher | Endpoint | Licence | Refresh |
|---|---|---|---|---|
| Tesouro Direto rates and prices | Tesouro Nacional (Tesouro Transparente CKAN) | `precotaxatesourodireto.csv` | ODbL 1.0 | business days |
| Federal public debt stock (DPF) | Tesouro Nacional (Tesouro Transparente CKAN) | `estoquedpf.csv` | ODbL 1.0 | monthly |
| Selic target, Selic, CDI, IPCA, fiscal series | Banco Central do Brasil, SGS API | `api.bcb.gov.br/dados/serie/bcdata.sgs.{id}` | ODbL 1.0 | daily / monthly |
| Focus market expectations | Banco Central do Brasil, Olinda OData | `ExpectativasMercadoAnuais` | ODbL 1.0 | weekly |
| IPCA number index | IBGE SIDRA | table 1737, variable 2266 | public, attribution | monthly |

SGS series: 432 (Selic target), 1178 (Selic, annualised 252), 11 (Selic daily), 4389 (CDI,
annualised 252), 433 (IPCA m/m), 13522 (IPCA 12 months), 13762 (gross general government debt,
% GDP, 2008 methodology), 4513 (net public sector debt, % GDP), 5793 and 5727 (primary and
nominal NFSP, 12 months, % GDP; positive = deficit). Titles were checked against the BCB
open-data catalogue.

The SGS Selic target (432) is carried forward to the next Copom meeting, so it contains future
dates. The pipeline discards any observation after the run date, and a blocking check enforces
this.

## 2. Pipeline and snapshot control

```
official sources → extract (timeouts, retry with backoff, SHA-256, manifest)
                 → normalise (types, security IDs, schema guard)
                 → validate (blocking / warning checks)
                 → price + reconcile + risk (official conventions)
                 → DuckDB (built in a temp file, swapped atomically)
                 → JSON datasets (built in a temp folder, swapped atomically)
```

- A failed source keeps its previous raw file. The manifest marks it `stale`, and the website shows
  a stale banner.
- Blocking checks include duplicate keys, out-of-range rates, quotes after maturity, history
  shrinking by more than 0.5%, a regressing latest date, future macro dates, and reconciliation
  falling below its per-product threshold. If any fail, the new snapshot is not published and the
  last validated one stays online.
- SGS and Focus are fetched incrementally (the last 60 days are re-fetched and merged). The
  Tesouro files are complete histories and are fetched in full. Every stage is idempotent.

### Freshness and the five dates

The site keeps five dates apart. The Methodology page shows each one:

| Date | Meaning | Where it comes from |
|---|---|---|
| Market observation | The trading day that the latest prices and rates refer to | `manifest.data_as_of` |
| Source publication | When the source last updated its file | `manifest.sources[*].source_published_at` |
| Last successful fetch | When this project last downloaded the source without error | `manifest.sources[*].last_success_at` |
| Snapshot build | When the validated datasets were generated | `manifest.generated_at` |
| Site deployment | When the live site was built, and from which commit | `data/build.json`, written by `deploy.yml` |

A source is **stale** when its latest observation is older than its cadence allows. The thresholds
are defined once in `config/sources.toml` (`[freshness]`) and are used by both the pipeline and
the website:

- daily quotes: 4 business days;
- other daily series: 5 business days;
- weekly series: 14 calendar days;
- monthly series: 75 calendar days, counted from the end of the observed month.

A failed fetch records `failed_at` and the error. The next successful fetch clears both, so an
old error is never shown next to a fresh success. Per-source freshness is published in
`manifest.source_freshness`.

## 3. Security identifiers

`<code>-<YYYYMMDD>` uses the official final maturity date (for example `NTNBP-20350515`). Product
names are shared by many securities, so the maturity is always part of the key.

NTN-B1 (Renda+, Educa+): the dataset maturity is the **final** amortisation date. The commercial
year is the conversion year: Renda+ = maturity year − 19, Educa+ = maturity year − 4. For example,
`RENDA-20841215` is Tesouro Renda+ 2065, which pays 240 monthly instalments from 15/01/2065 to
15/12/2084.

## 4. Pricing conventions (Tesouro Nacional)

Sources: Tesouro Nacional, *Metodologia de Cálculo dos Títulos Públicos Federais Ofertados nos
Leilões Primários*; Tesouro Direto, *Cálculo da Rentabilidade – Tesouro RendA+* and *Tesouro Educa+*.

| Product | Instrument | Price |
|---|---|---|
| Tesouro Prefixado | LTN | PU = 1000 / (1+r)^(du/252) |
| Tesouro Prefixado com Juros Semestrais | NTN-F | PU = Σ 48.80885/(1+r)^(du_i/252) + 1000/(1+r)^(du_n/252) |
| Tesouro Selic | LFT | PU = VNA × 100/(1+spread)^(du/252) / 100 |
| Tesouro IPCA+ | NTN-B Principal | PU = VNA × 100/(1+r)^(du/252) / 100 |
| Tesouro IPCA+ com Juros Semestrais | NTN-B | PU = VNA × [Σ 2.956301/(1+r)^(du_i/252) + 100/(1+r)^(du_n/252)] / 100 |
| Tesouro Renda+ / Educa+ | NTN-B1 | PU = VNA × Σ Ta_i/(1+r)^(du_i/252) / 100 with 240 / 60 monthly Ta |

Rounding rules:

- the rate is truncated to 6 decimal places (in %);
- du/252 is truncated to 14 places;
- each discounted flow is rounded to 10 places (9 for NTN-F);
- the cotação (price as a percentage of nominal value) is truncated to 4 places;
- the PU is truncated to 6 places, and Tesouro Direto displays it truncated to 2;
- VNA is truncated to 6 places;
- for NTN-B1, Ta = trunc₆(100/n) and the final instalment is 100 − (n−1)·Ta.

`du` counts business days from settlement (inclusive) to payment (exclusive) on the national
(ANBIMA) calendar in force on the pricing date. Lei 14.759/2023 created the 20 November holiday
from 2024. Prices computed before 22/12/2023 ignore it, including for later payment dates. The
official NTN-B1 examples (2022/2023) confirm this.

**VNA (IPCA):** 1000 × I(previous month) / I(June 2000 = 1614.62), projected between the 15ths with
(1 + IPCA projection)^(calendar days elapsed / calendar days in the period). **VNA (LFT):** 1000 ×
accumulated daily Selic factors since 01/07/2000, projected one business day with the Copom target
for D+1 settlement.

### Settlement conventions found in the official data

| Side | Settlement |
|---|---|
| Purchase price | D+1, whole history |
| Sale price | D+1 until 10/09/2021; **D+0 from 13/09/2021** |
| "PU Base" | D+0 at the sale rate |

D+1 settlement skips 50 days that are not national holidays but on which Tesouro Direto did not
settle: 24 and 31 December, São Paulo holidays in 2013–2021, and 2014 World Cup days. They were
inferred from the official prices and are listed with provenance in
`config/calendars/td_settlement_closures.json`, together with the script that derives them.

## 5. Reconciliation with official prices

Every historical official price (486,545 security/date/side observations for the modelled products) is recomputed.

- **LTN / NTN-F:** priced directly from the published rate.
- **IPCA-linked (NTN-B, NTN-B Principal, Renda+, Educa+):** Tesouro does not publish its daily
  projected VNA. For each date and side, each official price defines a VNA interval
  `[PU/c, (PU+0.01)/c)`. If all intervals intersect, a single VNA reproduces every IPCA-linked price
  of that day to the cent. This is a strong test of the cotação engine, because the bonds have very
  different cash-flow structures. A second, independent VNA is built from IBGE index numbers alone.
- **LFT:** the same interval test, plus an independent VNA from BCB Selic rates.

These checks do not all provide the same kind of evidence. `reconciliation.json` lists them in
`validation_categories`, and the Methodology page shows them:

| Category | What it checks | How independent |
|---|---|---|
| Official worked examples | Tesouro's published examples, including 300 business-day counts | Fully independent: expected values come from the official documents and are frozen in `tests/fixtures` |
| Fixed-rate history | Every LTN and NTN-F price recomputed from the published rate | Independent prediction: only the rate and the calendar are used |
| IPCA-linked history | One VNA per date and side reproducing every IPCA-linked price | Consistency, not prediction: the VNA is inferred from the same day's prices |
| Independent VNA | A VNA built only from IBGE or BCB data, compared with the implied VNA | Independent inputs, but a proxy for the IPCA projection |
| Known discrepancies | LFT spread rounding, residuals near maturity, NTN-C | Documented, not corrected by fitting |

Hand-computed reference cases (`tests/fixtures/reference_cases.json`, generated by
`scripts/make_reference_cases.py`) test the scenario engine's costs and taxes independently of
the engine itself. They cover Selic custody exemption, custody and tax at NTN-B coupons, a Renda+
instalment, the Renda+ early-sale tier, and IOF on a short sale.

Key results (snapshot 2026-10-30):

- LTN, NTN-F, NTN-B Principal, Renda+ and Educa+: ≥ 99.5% of official prices exactly reproduced.
- NTN-B: 98.8% exactly, 99.7% within R$ 0.01.
- A single VNA is consistent with all IPCA-linked prices on 98.3% of date/side combinations.
- **LFT:** exact until 2019, then not. Using the independent Selic VNA, the spread implied by the
  official price differs from the published 2-decimal spread by at most ±0.5 bp from 2020. This is
  what rounding the published rate would produce. The published spread is therefore not precise
  enough for cent-level LFT reconciliation after 2020; model error is around R$ 0.5 (median) on a
  R$ 20,000 price.
- **Independent VNA vs consensus:** Selic within ±0.4 bp (5–95%); IPCA within about −5 to +7 bp,
  which is the projection error of using the realised monthly IPCA instead of the ANBIMA projection.

Residual mismatches (≤ 1.2% of rows per product) are listed in `largest_errors`. They concentrate
in a few days and in individual securities near maturity.

NTN-C (IGP-M) has a single Tesouro Direto security and no second bond for a cross-sectional VNA
test, so it is shown as observed data only.

## 6. Rate sensitivity

The analytics use unrounded prices: P(y) = Σ CF_i (1+y)^(−t_i), with t_i = du_i/252.

- Macaulay D = Σ t_i·PV_i / P
- modified D* = D/(1+y) = −P′/P
- convexity C = Σ t_i(t_i+1)·PV_i / ((1+y)²P) = P″/P
- DV01 = D*·P·10⁻⁴

Tests verify these against finite differences. The measures are computed at the purchase rate on
the base date. For LFT the rate is the spread over Selic, so its duration measures spread
sensitivity, not exposure to the Selic level.

## 7. Scenarios (Mark-to-Market Lab, Comparison, Renda+)

The website separates three things:

1. **Observed:** historical official prices and rates.
2. **Theoretical repricing:** the same bond today under an immediate rate shock. Exact repricing is
   shown next to the duration and duration+convexity approximations.
3. **Hypothetical holding period:** entry at the observed purchase price, exit at the observed
   sale rate plus a user shock after a horizon. The scenario assumes IPCA or Selic paths,
   reinvestment of coupons and amortisations, and costs and taxes per the versioned assumptions.
   A scenario is not a forecast.

Costs and taxes come from `config/assumptions/br_costs_taxes_v2026-11.json` (version
2026-11.3), which records its sources, reference date and a changelog:

- **B3 custody, 0.20% a year** on the position value. It accrues daily from the purchase settlement (D+1),
  pro rata, and is collected at each coupon (deducted from the coupon), at an early sale and at
  maturity. Tesouro Selic is exempt on the first R$ 10,000 per investor; the fee applies only to the
  excess. The engine accrues custody by trapezoid integration of the position value over a
  quarterly grid plus every event date. Each collection period starts just after a payment
  (ex-payment value) and ends just before the next one (cum-payment value).
- **Renda+ and Educa+:**
  - no custody while held;
  - 0.10% on the part of each monthly payment above 6 minimum wages (Renda+) or 4 (Educa+);
  - the minimum wage starts at R$ 1,621 (2026) and grows with the IPCA assumption;
  - an early sale before conversion pays a rate a year, times years held, on the amount sold:
    - Renda+: 0.50% (0–10 years), 0.20% (10–20 years), 0.10% (20 years or more);
    - Educa+: the same rates for 0–7, 7–14 and 14+ years.
- **Income tax:** the regressive table, 22.5/20/17.5/15%, applied to each coupon and to the gain
  at sale or maturity. **Holding periods run from the settlement date of the purchase (D+1) to the
  payment date, or to the settlement date of the sale (D+0 since 13/09/2021)** (RFB Nota Cosit
  144/2018, published by STN and B3 in communication 070/2018). NTN-B1 instalments return cost
  basis pro rata.
- **Renda+ accumulation (several purchases):** each monthly contribution is a separate lot with its
  own settlement date and nominal cost. Each instalment is taxed lot by lot, at the rate for that
  lot's age on the payment date, on the lot's payment minus the share of its cost returned by the
  instalment. Purchases made in the two years before conversion therefore pay 17.5–22.5% on the
  early instalments. How the cost is split across instalments is not stated officially; the pro
  rata split is an assumption, and the result is labelled an estimate. A purchase within 30 days
  of a payment is outside the model (IOF), and the simulator never creates one.
- **IOF:** on gains from redemptions within 30 days (not on coupons).

No official source confirms whether custody reduces the income-tax base, so **by default it does
not**. The Lab shows the alternative treatment as a sensitivity. Every cost is computed once and
itemised. Non-resident and cross-border treatment is not applied.

**Historical reference date.** The Lab can start a scenario on any past date that has a purchase
price, purchase rate, sale rate and (for indexed bonds) a VNA from `vna_history.json`. All three
layers start from that date, and only information available on that date is used. The default
inflation and Selic assumptions are the Focus median and Selic target known then, so there is
no look-ahead. The observed layer then shows what actually happened after that date.

**CSV export** follows RFC 4180: CRLF line endings, quoted fields where needed, a UTF-8 BOM,
ISO dates, and a long `field,value,unit` layout. It records the security id, reference date,
snapshot id and assumptions version. A frozen fixture is parsed by pandas in
`tests/test_csv_export.py`.

## 8. Research statistics

- **Constant-duration curves:** linear interpolation of purchase rates on Macaulay duration within
  a product family, with no extrapolation.
- **Percentiles:** reported only with at least 250 observations, with the observation count and
  start date.
- **Calendar effects:** one cross-sectional average change per date, Welch and permutation tests,
  Holm correction, and an out-of-sample re-test of any "best window".
- **Regime tables:** report the effective number of independent observations for overlapping
  windows.

The site uses descriptive language ("historically elevated real yield") and never labels a
security as undervalued.

## 9. Known limitations

- The ANBIMA IPCA projection is not open data, so the independent IPCA VNA uses the realised
  monthly IPCA as a proxy for validation.
- The LFT spread precision after 2020 is limited by the published data.
- The DPF maturity statistic is time to final maturity weighted by stock. It differs from the
  official average maturity, which weights all cash flows.
- Scenario taxation is a simplification: it assumes a Brazilian-resident individual, applies the
  regressive table per flow, and does not model loss offsetting or the income-tax treatment of
  custody (unconfirmed).
- The scenario value path between purchase and exit assumes the yield moves linearly from the
  purchase rate to the exit rate; custody accrued along that path depends on this assumption.
- Tesouro Direto publishes one morning quote per day. Intraday movements are not captured.
