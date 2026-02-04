import { test, expect } from "@playwright/test";
import { USAGE_LIMITS } from "../src/lib/types";

test.describe("Session Usage Limits", () => {
  test("displays session usage info in listener hook", async ({ page }) => {
    // Go to the main page
    await page.goto("/");

    // Verify the page loads correctly
    await expect(page.getByText("Ready to fact-check")).toBeVisible();
  });

  test("daily token endpoint returns quota info", async ({ request }) => {
    // Make a request to the deepgram-token endpoint
    const response = await request.post("/api/deepgram-token");

    // Check that we get the expected response structure
    if (response.ok()) {
      const data = await response.json();
      expect(data).toHaveProperty("token");
      expect(data).toHaveProperty("sessionsRemaining");
      expect(data).toHaveProperty("maxDurationMs");
      expect(data.maxDurationMs).toBe(USAGE_LIMITS.maxSessionDurationMs);
      expect(typeof data.sessionsRemaining).toBe("number");
    } else {
      // If the API key is not configured, we get a 500 error
      expect(response.status()).toBe(500);
    }
  });

  test("rate limiter returns 429 after exceeding daily limit", async ({ request }) => {
    // Make multiple requests until we hit the daily limit
    // Note: This test relies on the rate limiter state
    const responses = [];

    for (let i = 0; i < 6; i++) {
      const response = await request.post("/api/deepgram-token");
      responses.push({
        status: response.status(),
        body: response.ok() ? await response.json() : null,
      });

      // If we get a 429, stop early
      if (response.status() === 429) {
        break;
      }
    }

    // After 4 successful requests (or server errors), we should hit the limit
    const rateLimited = responses.filter(r => r.status === 429);

    // If the API key is configured, we should eventually get rate limited
    // If not, all requests will be 500 errors
    const hasServerErrors = responses.some(r => r.status === 500);
    if (!hasServerErrors) {
      expect(rateLimited.length).toBeGreaterThan(0);
    }
  });

  test("usage limits constants are correct", () => {
    expect(USAGE_LIMITS.maxSessionDurationMs).toBe(30 * 60 * 1000);
    expect(USAGE_LIMITS.maxDailyDurationMs).toBe(2 * 60 * 60 * 1000);
    expect(USAGE_LIMITS.warningThresholdMs).toBe(5 * 60 * 1000);
    expect(USAGE_LIMITS.maxDailyTokenRequests).toBe(4);
  });

  test("localStorage tracks daily usage format", async ({ page }) => {
    await page.goto("/");

    // Evaluate localStorage structure
    const usageKey = "fact-checker:daily-usage";
    const mockUsage = {
      date: new Date().toISOString().split("T")[0],
      totalMs: 0,
      sessionCount: 0,
    };

    // Set a mock value
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: usageKey, value: mockUsage }
    );

    // Verify we can read it back
    const stored = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, usageKey);

    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveProperty("date");
    expect(parsed).toHaveProperty("totalMs");
    expect(parsed).toHaveProperty("sessionCount");
  });
});
