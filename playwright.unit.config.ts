import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /(?:claim-processing|claim-queue|extraction-scheduler|claim-extraction|transcript-segments|grounded-fact-check).*\.spec\.ts/,
  timeout: 15000,
  fullyParallel: true,
});
