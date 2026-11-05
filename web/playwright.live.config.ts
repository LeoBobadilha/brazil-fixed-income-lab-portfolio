import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", outputDir: "test-results/live", timeout: 60_000, workers: 2,
  reporter: [["list"]],
  use: { baseURL: "https://leobobadilha.github.io/brazil-fixed-income-lab/" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
