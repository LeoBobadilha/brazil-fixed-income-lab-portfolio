import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["junit", { outputFile: "reports/e2e-junit.xml" }]],
  use: { baseURL: "http://localhost:4791/brazil-fixed-income-lab/", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4791/brazil-fixed-income-lab/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
