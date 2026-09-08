import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // This scenario has its own server configuration with the topic flag disabled.
  testIgnore: /source-chips-prod-flag\.spec\.ts/,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3001",
  },
  webServer: {
    command: "NEXT_PUBLIC_ENABLE_TEXT_INPUT=true PORT=3001 npm run dev -- --webpack",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
