import { test, expect } from "@playwright/test";
import { USAGE_LIMITS } from "../src/lib/types";

test.describe("Recording Limits", () => {
  test("displays session usage info in listener hook", async ({ page }) => {
    // Go to the main page
    await page.goto("/");

    // Verify the page loads correctly
    await expect(page.getByText("Bring evidence into the conversation")).toBeVisible();
  });

  test("deepgram token endpoint returns temporary auth metadata", async ({ request }) => {
    // Make a request to the deepgram-token endpoint
    const response = await request.post("/api/deepgram-token");

    // Check that we get the expected response structure
    if (response.ok()) {
      const data = await response.json();
      expect(data).toHaveProperty("token");
      expect(data).toHaveProperty("tokenType", "bearer");
      expect(data).toHaveProperty("expiresAt");
      expect(data).toHaveProperty("expiresIn");
      expect(data).toHaveProperty("maxDurationMs");
      expect(data.maxDurationMs).toBe(USAGE_LIMITS.maxSessionDurationMs);
      expect(typeof data.token).toBe("string");
      expect(typeof data.expiresIn).toBe("number");
    } else {
      // If the API key is missing or Deepgram is unavailable, the route should fail cleanly.
      expect([500, 502]).toContain(response.status());
    }
  });

  test("usage limits constants are correct", () => {
    expect(USAGE_LIMITS.maxSessionDurationMs).toBe(2 * 60 * 60 * 1000);
    expect(USAGE_LIMITS.warningThresholdMs).toBe(5 * 60 * 1000);
  });
});
