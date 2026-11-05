import { answerEntry, answerQuestion, eligible, FACT_KINDS, KNOWLEDGE_ENTRIES, OFFICIAL, suggestedQuestions, type AskContext } from "./knowledge";
import { GLOSSARY } from "./glossary";

const ctx = (chart: string, facts: Record<string, string> = {}, product?: string, explanation?: string): AskContext =>
  ({ page: chart.split(".")[0], chart, title: "Chart", scope: "scope", facts, product, explanation });
const Q = (id: string) => KNOWLEDGE_ENTRIES.find((e) => e.id === id)!.q;

// Every chart that has an Ask button, with the product a page passes (if any).
const CHARTS: [string, string?][] = [
  ["overview.curve"], ["overview.changed"], ["overview.benchmark"], ["overview.moves"],
  ["explorer.rates", "NTNBP"], ["explorer.price", "NTNBP"], ["explorer.price", "LTN"], ["explorer.price-yield", "NTNB"], ["explorer.duration", "LTN"],
  ["explorer.distribution", "NTNBP"], ["explorer.volatility", "NTNBP"], ["explorer.cashflows", "RENDA"],
  ["lab.observed", "NTNBP"], ["lab.sensitivity", "NTNBP"], ["lab.scenario", "RENDA"], ["lab.heatmap", "LTN"],
  ["compare.path"],
  ["renda.lineup", "RENDA"], ["renda.vs-ipca", "RENDA"], ["renda.accumulation", "RENDA"], ["renda.calendar", "RENDA"], ["renda.early", "RENDA"],
  ["macro.policy"], ["macro.real"], ["macro.focus"], ["macro.focus-ipca"], ["macro.focus-selic"], ["macro.debt"], ["macro.primary"],
  ["macro.nominal"], ["macro.dpf"], ["macro.maturity"], ["macro.term"], ["macro.short-term"],
  ["research.calendar"], ["research.legacy"], ["research.percentile"], ["research.regimes"], ["research.drawdowns"], ["research.daily"], ["research.slope"],
  ["methodology.sources"], ["methodology.reconciliation"], ["methodology.by-year"],
];

// Facts with distinctive values for every registered key.
const FULL: Record<string, string> = {
  bond: "Tesouro IPCA+ 2035", family: "Real (IPCA+)", series: "Real yield, 10y duration", conversion: "15 Jan 2065", date: "30 Oct 2026",
  dataAsOf: "30 Oct 2026", reference: "2 Jan 2025", modified: "7.77", convexity: "71.3", dv01: "R$ 0.317", percentile: "93rd",
  observations: "4,123", current: "7.53%", short: "IPCA + 7.61%", long: "IPCA + 6.93%", rateFrom: "IPCA + 6.23%", rateTo: "IPCA + 7.88%",
  rateChange: "+165 bp", from: "8 Mar 2010", to: "30 Oct 2026", priceFrom: "R$ 416.68", priceTo: "R$ 2,484.95", priceChange: "+496.4%",
  volNow: "83 bp", vnaIpca: "R$ 4,601.23", selic: "13.75%", ipca12: "4.58%", grossDebt: "78.4% of GDP", grossDebtDate: "Sep 2026",
  netDebt: "64.9% of GDP", primary: "-0.42% of GDP", nominal: "-7.91% of GDP", exPostReal: "8.77%", marketReal: "IPCA + 7.53% (30 Oct 2026)",
  selicShare: "46.2%", dpfMonth: "Sep 2026", maturingShare: "17.3%", avgMaturity: "4.37", focusIpca: "4.21%", focusSelic: "12.25%",
  focusYear: "2027", ipca: "4.13%", horizon: "3.00 years", shock: "+75 bp", reinvest: "13.25%", assumptionsVersion: "2026-11.2",
  gross: "R$ 4,816", net: "R$ 4,099", firstTaxRate: "19.6%", paymentsAbove15: "23", youngestLotDays: "77", months: "37",
  sample: "4,511 trading days", w1114: "-0.07 bp per day (p = 0.83)", oos: "21-25: 0.03 bp, p = 0.71", worstDrawdown: "Renda+ 2065, 41.3%",
  exactLTN: "99.82%", exactNTNB: "98.81%", status: "current", flowYears: "21", flowFirst: "2065", flowLast: "2084",
};
const numbers = (s: string) => s.match(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)*/g) ?? []; // digits inside words (DV01) are not numbers
// Place an entry in a context where it is eligible.
const home = (e: (typeof KNOWLEDGE_ENTRIES)[number]): AskContext => {
  const chart = e.scope.charts?.[0] ?? `${e.scope.pages?.[0] ?? "overview"}.x`;
  return ctx(chart, {}, e.scope.products?.[0]);
};

describe("Q&A scope is an eligibility filter", () => {
  it("offers at least three relevant questions on every chart with an Ask button", () => {
    for (const [c, p] of CHARTS) {
      const s = suggestedQuestions(ctx(c, {}, p));
      expect(s.length, c).toBeGreaterThanOrEqual(3);
      for (const q of s) expect(eligible(KNOWLEDGE_ENTRIES.find((e) => e.q === q)! as never, ctx(c, {}, p)), `${c}: ${q}`).toBe(true);
    }
  });

  it("puts chart-specific questions first", () => {
    expect(suggestedQuestions(ctx("overview.curve"))[0]).toBe(Q("yield-curve"));
    expect(suggestedQuestions(ctx("macro.dpf"))[0]).toBe(Q("debt-composition"));
    expect(suggestedQuestions(ctx("renda.accumulation", {}, "RENDA"))[0]).toBe(Q("renda-income"));
    expect(suggestedQuestions(ctx("explorer.rates", {}, "NTNBP")).slice(0, 2)).toEqual([Q("spread"), Q("rate-history")]);
  });

  it("keeps Renda+ questions off an IPCA+ 2035 chart, and offers them on Renda+", () => {
    const ipca = suggestedQuestions(ctx("explorer.rates", {}, "NTNBP"), 50);
    for (const id of ["renda-dates", "renda-payments", "renda-tax", "renda-custody", "renda-rates"]) expect(ipca).not.toContain(Q(id));
    const r = answerQuestion(Q("renda-dates"), ctx("explorer.rates", {}, "NTNBP"));
    expect(r.matched).toBe("out-of-scope");
    expect(r.answer).toBe("");
    expect(r.suggestions.length).toBeGreaterThan(0);
    const renda = suggestedQuestions(ctx("explorer.rates", {}, "RENDA"), 50);
    expect(renda).toContain(Q("renda-dates"));
    const page = suggestedQuestions(ctx("renda.lineup", {}, "RENDA"), 50);
    for (const id of ["renda-payments", "renda-tax", "renda-dates", "modified-duration"]) expect(page).toContain(Q(id));
  });

  it("does not offer bond concepts on macro, research or methodology charts", () => {
    for (const c of ["macro.debt", "macro.policy", "research.calendar", "methodology.reconciliation"]) {
      const s = suggestedQuestions(ctx(c), 50);
      for (const id of ["modified-duration", "dv01", "convexity", "mtm-loss"]) expect(s, `${c} ${id}`).not.toContain(Q(id));
      expect(answerQuestion(Q("dv01"), ctx(c)).matched, c).toBe("out-of-scope");
    }
  });

  it("does not offer macro or research questions on bond charts", () => {
    const s = suggestedQuestions(ctx("lab.scenario", {}, "NTNB"), 50);
    for (const id of ["gross-debt", "primary-balance", "significance", "drawdown", "reconciliation"]) expect(s).not.toContain(Q(id));
    expect(answerQuestion("what is the difference between gross and net debt", ctx("lab.scenario", {}, "NTNB")).matched).toBe("out-of-scope");
  });

  it("applies product rules: VNA only for indexed bonds, pull to par only for fixed-rate", () => {
    expect(suggestedQuestions(ctx("explorer.price", {}, "LTN"), 50)).not.toContain(Q("vna"));
    expect(suggestedQuestions(ctx("explorer.price", {}, "LTN"), 50)).toContain(Q("pull-to-par"));
    expect(suggestedQuestions(ctx("explorer.price", {}, "NTNBP"), 50)).toContain(Q("indexed-price"));
    expect(suggestedQuestions(ctx("explorer.price", {}, "NTNBP"), 50)).not.toContain(Q("pull-to-par"));
  });
});

describe("Q&A matching", () => {
  const cases: [string, string | undefined, string, string][] = [
    ["overview.curve", undefined, "what does the shape of the curve mean?", "yield-curve"],
    ["overview.benchmark", undefined, "why use an interpolated 10 year benchmark", "benchmark"],
    ["explorer.rates", "NTNBP", "why is the sell rate above the buy rate", "spread"],
    ["explorer.rates", "NTNBP", "how sensitive is this bond to interest rate changes", "modified-duration"],
    ["explorer.price", "NTNBP", "why did the price go up even though yields rose?", "indexed-price"],
    ["explorer.distribution", "NTNBP", "is a high percentile a good time to buy", "percentile"],
    ["lab.scenario", "NTNB", "how are taxes and fees charged", "costs-tax"],
    ["lab.heatmap", "NTNB", "how do I read the heatmap", "heatmap"],
    ["compare.path", undefined, "are these CDB rates real bank offers", "cdb"],
    ["renda.accumulation", "RENDA", "how much monthly income will I receive", "renda-income"],
    ["renda.accumulation", "RENDA", "is every payment taxed at 15%?", "renda-tax"],
    ["renda.lineup", "RENDA", "how many payments are there", "renda-payments"],
    ["renda.early", "RENDA", "what if I sell before conversion", "renda-early"],
    ["macro.debt", undefined, "what is the difference between gross and net debt", "gross-vs-net"],
    ["macro.primary", undefined, "what is a primary surplus", "primary-balance"],
    ["macro.nominal", undefined, "how is the nominal balance different, does it include interest", "nominal-balance"],
    ["macro.short-term", undefined, "why does refinancing of maturing debt matter", "debt-maturity"],
    ["research.calendar", undefined, "is there a best day of the month to buy", "significance"],
    ["research.drawdowns", undefined, "what is a drawdown", "drawdown"],
    ["methodology.reconciliation", undefined, "how accurate are the prices", "reconciliation"],
    ["methodology.reconciliation", undefined, "is this check independent or circular", "evidence-kinds"],
  ];
  for (const [chart, product, q, id] of cases) {
    it(`${chart}: "${q}"`, () => {
      const r = answerQuestion(q, ctx(chart, {}, product));
      expect(r.matched).toBe("keywords");
      expect(r.question).toBe(Q(id));
    });
  }

  it("answers exact questions only where they are eligible", () => {
    expect(answerQuestion(Q("yield-curve"), ctx("overview.curve")).matched).toBe("exact");
    expect(answerQuestion(Q("yield-curve"), ctx("macro.debt")).matched).toBe("out-of-scope");
  });

  it("declines ambiguous and unrelated questions with relevant suggestions", () => {
    for (const q of ["why?", "what about it", "what is the weather in Paris", "recommend a football team", "asdf qwerty"]) {
      const r = answerQuestion(q, ctx("lab.scenario", {}, "NTNB"));
      expect(r.matched, q).toBe("none");
      expect(r.answer).toBe("");
      expect(r.suggestions.length).toBeGreaterThan(0);
      for (const s of r.suggestions) expect(suggestedQuestions(ctx("lab.scenario", {}, "NTNB"), 50)).toContain(s);
    }
  });

  it("answers 'what does this chart show' from the chart's own explanation", () => {
    const r = answerQuestion("what does this chart show?", ctx("macro.debt", {}, undefined, "Gross and net debt, % of GDP. Latest gross 78.4%."));
    expect(r.matched).toBe("exact");
    expect(r.answer).toContain("Latest gross 78.4%.");
  });
});

describe("Q&A numbers and facts", () => {
  it("only uses registered fact keys", () => {
    for (const e of KNOWLEDGE_ENTRIES) for (const k of e.uses) expect(FACT_KINDS[k], `${e.id}: ${k}`).toBeDefined();
  });

  it("uses no fact it does not declare", () => {
    for (const e of KNOWLEDGE_ENTRIES) {
      const c = home(e);
      const declared = Object.fromEntries(e.uses.map((k) => [k, FULL[k]]));
      expect(answerEntry(e.id, { ...c, facts: FULL }), e.id).toBe(answerEntry(e.id, { ...c, facts: declared }));
    }
  });

  it("states every number as an official constant, a declared example or a declared fact", () => {
    const bad = new Set<string>();
    for (const e of KNOWLEDGE_ENTRIES) {
      if (e.id === "chart-summary") continue; // repeats the chart's own computed explanation
      const allowed = new Set<string>([...e.examples, ...e.official.flatMap((k) => OFFICIAL[k].tokens), ...e.uses.flatMap((k) => numbers(FULL[k] ?? ""))]);
      for (const facts of [{}, FULL]) {
        for (const n of numbers(answerEntry(e.id, { ...home(e), facts }))) if (!allowed.has(n)) bad.add(`${e.id}: "${n}"`);
      }
    }
    expect([...bad], "numbers without declared provenance").toEqual([]);
  });

  it("registers a source for every official constant", () => {
    for (const [k, v] of Object.entries(OFFICIAL)) {
      expect(v.source.length, k).toBeGreaterThan(5);
      expect(v.tokens.length, k).toBeGreaterThan(0);
    }
  });

  it("leaves out the data sentence when a fact is missing, never guessing", () => {
    for (const e of KNOWLEDGE_ENTRIES) {
      const a = answerEntry(e.id, { ...home(e), facts: {} });
      expect(a.length, e.id).toBeGreaterThan(60);
      expect(a, e.id).not.toMatch(/undefined|NaN|null|\$\{/);
    }
    const partial = answerQuestion(Q("modified-duration"), ctx("explorer.rates", { bond: "Tesouro IPCA+ 2035" }, "NTNBP"));
    expect(partial.answer).not.toContain("Tesouro IPCA+ 2035");
  });

  it("follows the selected instrument and scenario", () => {
    const a = answerQuestion(Q("modified-duration"), ctx("explorer.rates", { bond: "Tesouro IPCA+ 2035", modified: "7.77" }, "NTNBP")).answer;
    const b = answerQuestion(Q("modified-duration"), ctx("explorer.rates", { bond: "Tesouro Renda+ 2065", modified: "42.53" }, "RENDA")).answer;
    expect(a).toContain("For Tesouro IPCA+ 2035, modified duration is 7.77");
    expect(b).toContain("For Tesouro Renda+ 2065, modified duration is 42.53");
    const old = answerQuestion(Q("renda-tax"), ctx("renda.accumulation", { firstTaxRate: "15.0%", paymentsAbove15: "0" }, "RENDA")).answer;
    const late = answerQuestion(Q("renda-tax"), ctx("renda.accumulation", { firstTaxRate: "19.6%", paymentsAbove15: "23", youngestLotDays: "77" }, "RENDA")).answer;
    expect(old).toContain("all instalments are taxed at 15%");
    expect(late).toContain("effective 19.6%");
    expect(late).toContain("23 instalments");
  });

  it("never claims to be AI-generated or a forecast", () => {
    for (const e of KNOWLEDGE_ENTRIES) {
      const a = answerEntry(e.id, { ...home(e), facts: FULL }).toLowerCase();
      expect(a, e.id).not.toMatch(/as an ai|language model|i predict|will (rise|fall) to|guaranteed return/);
    }
  });

  it("does not describe every Renda+ payment as taxed at 15%", () => {
    const a = answerEntry("renda-income", ctx("renda.accumulation", FULL, "RENDA"));
    expect(a).not.toMatch(/15% income tax/);
    expect(answerEntry("renda-tax", ctx("renda.accumulation", {}, "RENDA"))).toContain("22.5% up to 180 days");
  });
});

describe("glossary", () => {
  it("has a definition for every key", () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      expect(v.term.length, k).toBeGreaterThan(1);
      expect(v.definition.length, k).toBeGreaterThan(40);
    }
  });
});
