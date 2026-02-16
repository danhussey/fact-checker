import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /source-chips-prod-flag\.spec\.ts/,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3002",
  },
  webServer: {
    command: "NEXT_PUBLIC_ENABLE_TEXT_INPUT=true NEXT_PUBLIC_SHOW_RESEARCH_TOPICS=false PORT=3002 npm run dev",
    url: "http://localhost:3002",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
