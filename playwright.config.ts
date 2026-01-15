import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3001",
  },
  webServer: {
    command: "NEXT_PUBLIC_ENABLE_TEXT_INPUT=true PORT=3001 npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
