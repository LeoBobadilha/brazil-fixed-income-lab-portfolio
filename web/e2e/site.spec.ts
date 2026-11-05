import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/bond", "/lab", "/compare", "/renda", "/macro", "/research", "/methodology"];

for (const path of PAGES) {
  test(`page ${path} renders without errors or horizontal overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`#${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test(`page ${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(`#${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const res = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
    const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

test("deep link to Renda+ 2065 shows the correct security mapping", async ({ page }) => {
  await page.goto("#/bond/RENDA-20841215");
  await expect(page.locator("h1")).toHaveText("Tesouro Renda+ 2065");
  await expect(page.getByText(/first instalment 15 Jan 2065/)).toBeVisible();
});

test("navigation works and the site is English-only", async ({ page, isMobile }) => {
  await page.goto("#/");
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await expect(page.getByRole("button", { name: /português|portuguese|^PT$/i })).toHaveCount(0);
  if (isMobile) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Methodology" }).first().click();
  await expect(page).toHaveURL(/#\/methodology/);
  await expect(page.locator("h1")).toHaveText("How the numbers are produced and checked");
});

test("overview family filter scopes the bond table", async ({ page }) => {
  await page.goto("#/");
  await page.getByRole("radio", { name: "Nominal (fixed-rate)" }).click();
  const table = page.getByRole("table", { name: "Bond universe" });
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const names = await table.locator("tbody tr td:first-child").allInnerTexts();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toContain("Prefixado");
});

test("mark-to-market lab reacts to the rate shock and offers the 3D surface", async ({ page }) => {
  await page.goto("#/lab");
  const net = page.getByText("Net value", { exact: true }).locator("..");
  await expect(net).toBeVisible();
  const before = await net.innerText();
  await page.getByRole("table", { name: "Scenarios" }).getByText("+200 bp").first().click();
  await expect(net).not.toHaveText(before);
  await expect(page.getByTestId("heatmap")).toBeVisible();
  const btn = page.getByRole("button", { name: /3D surface/ });
  if (await btn.isEnabled()) {
    await btn.click();
    await expect(page.getByRole("img", { name: "3D surface of the scenario map" }).or(page.getByText(/WebGL unavailable/))).toBeVisible();
    await page.getByRole("button", { name: "Close 3D" }).click();
  }
});

test("theme toggle switches palette", async ({ page }) => {
  await page.goto("#/");
  await page.getByRole("button", { name: "Toggle light/dark theme" }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(["light", "dark"]).toContain(theme);
});

test("overview 'What changed' is scoped to the selected observation date", async ({ page }) => {
  await page.goto("#/");
  const scope = page.getByTestId("changed-scope");
  await expect(scope).toBeVisible();
  const latestText = await scope.innerText();
  const sel = page.locator("#f-date");
  await expect.poll(() => sel.locator("option").count()).toBeGreaterThan(41);
  const options = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const older = options[40];
  await sel.selectOption(older);
  await expect(scope).not.toHaveText(latestText);
  // The panel names the selected date as its end point, never the latest date.
  const [y, m, d] = older.split("-");
  void m;
  await expect(scope).toContainText(new RegExp(`to ${Number(d)} [A-Za-z]+ ${y}`));
  await expect(page.getByTestId("changed-body")).toBeVisible();
  // A negative move is never labelled a rise (and vice versa).
  const extremes = await page.getByTestId("changed-extremes").innerText();
  expect(extremes).not.toMatch(/Largest rise: [^(]*\(-/);
  expect(extremes).not.toMatch(/Largest fall: [^(]*\(\+/);
});

test("every page explains its charts and offers the curated Q&A", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(`#${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator('[data-testid^="explain-"]').first(), path).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask about this chart" }).first(), path).toBeVisible();
    await expect(page.getByText("Understand this chart").first(), path).toBeVisible();
  }
});

test("Ask panel answers from curated content scoped to the chart, and declines off-topic questions", async ({ page }) => {
  await page.goto("#/");
  // Wait until the curve data has loaded, so the answer can include it.
  await expect(page.getByTestId("explain-overview.curve-now")).toBeVisible();
  await page.getByTestId("ask-overview.curve").click();
  const panel = page.getByTestId("ask-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("not generated by AI");
  await panel.getByRole("button", { name: "What does this yield curve mean?" }).click();
  const answer = panel.getByTestId("ask-answer");
  await expect(answer).toContainText("The yield curve plots");
  // The data sentence uses the plotted curve: its date matches the explanation on the page.
  await expect(answer).toContainText(/On \d{1,2} [A-Za-z]+ \d{4}, the Real \(IPCA\+\) curve ran from IPCA \+/);
  await panel.getByLabel("Your question").fill("what is the weather in Paris");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(answer).toContainText("No curated answer matches");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("chart explanations follow the selected filters", async ({ page }) => {
  await page.goto("#/");
  const now = page.getByTestId("explain-overview.curve-now");
  await expect(now).toContainText("IPCA +");
  await page.getByRole("radio", { name: "Nominal (fixed-rate)" }).click();
  await expect(now).not.toContainText("IPCA +");
  await expect(now).toContainText(/yields ranged from \d/);

  await page.goto("#/bond/NTNBP-20350515");
  const rates = page.getByTestId("explain-explorer.rates-now");
  await expect(rates).toBeVisible();
  const all = await rates.innerText();
  await page.getByRole("radio", { name: "1y" }).click();
  await expect(rates).not.toHaveText(all);
});

test("Ask dialog traps focus, closes with Escape and returns focus to its button", async ({ page }) => {
  await page.goto("#/bond/NTNBP-20350515");
  const trigger = page.getByTestId("ask-explorer.rates");
  await trigger.click();
  const panel = page.getByTestId("ask-panel");
  await expect(panel).toBeFocused();
  await expect(panel).toHaveAttribute("aria-modal", "true");
  // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
  const focusables = panel.locator("button, input");
  const n = await focusables.count();
  await focusables.nth(n - 1).focus();
  await page.keyboard.press("Tab");
  await expect(focusables.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(focusables.nth(n - 1)).toBeFocused();
  for (let i = 0; i < n + 2; i++) {
    await page.keyboard.press("Tab");
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Ask suggestions follow the selected instrument", async ({ page }) => {
  await page.goto("#/bond/NTNBP-20350515");
  await page.getByTestId("ask-explorer.rates").click();
  const panel = page.getByTestId("ask-panel");
  await expect(panel.getByRole("button", { name: "Why is the sale rate higher than the purchase rate?" })).toBeVisible();
  await expect(panel.getByText(/Renda\+/)).toHaveCount(0);
  // A Renda+ question typed on an IPCA+ chart is declined as out of scope.
  await panel.getByLabel("Your question").fill("Why is the maturity of Renda+ listed 19 years after its name?");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(panel.getByTestId("ask-out-of-scope")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("#/bond/RENDA-20841215");
  await page.getByTestId("ask-explorer.rates").click();
  await expect(page.getByTestId("ask-panel").getByRole("button", { name: "Why is the maturity of Renda+ listed 19 years after its name?" })).toBeVisible();
});

test("Renda+ net income taxes each purchase at its own bracket", async ({ page }) => {
  await page.goto("#/renda");
  const lots = page.getByTestId("renda-tax-lots");
  await page.locator("#r-sec").selectOption({ label: "Renda+ 2065" });
  await expect(page.getByTestId("renda-tax-now")).toContainText("taxed at 15%");
  await expect(lots.locator("tbody tr")).toHaveCount(1);
  // Renda+ 2030 with contributions up to conversion: the newest purchases are taxed above 15%.
  await page.locator("#r-sec").selectOption({ label: "Renda+ 2030" });
  await expect(page.getByTestId("renda-tax-now")).toContainText(/effective \d+\.\d% of its gain/);
  await expect(lots.locator("tbody tr")).toHaveCount(4);
  await expect(lots).toContainText("22.5%");
  await expect(page.getByTestId("renda-breakdown")).not.toContainText("15% of the gain");
});

test("Overview comparison labels follow the selected observation date", async ({ page }) => {
  await page.goto("#/");
  const sel = page.locator("#f-date");
  await expect.poll(() => sel.locator("option").count()).toBeGreaterThan(41);
  const latestLabel = await page.locator("#f-per option[value='1m']").innerText();
  const options = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  for (const i of [40, 200]) {
    await sel.selectOption(options[i]);
    const label = await page.locator("#f-per option[value='1m']").innerText();
    expect(label).not.toBe(latestLabel);
    const scope = await page.getByTestId("changed-scope").innerText();
    // The option names the same comparison date that the panel uses.
    const m = label.match(/\((.+)\)/)![1];
    if (m !== "no earlier curve") expect(scope).toContain(`From ${m}`);
  }
});

test("every chart on every page has an explanation", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(`#${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const missing = await page.locator("section").evaluateAll((secs) => secs
      .filter((s) => s.querySelector('[role="img"]') && !s.textContent?.includes("Understand this chart"))
      .map((s) => s.querySelector("h2,h3")?.textContent ?? "?"));
    expect(missing, path).toEqual([]);
  }
});
