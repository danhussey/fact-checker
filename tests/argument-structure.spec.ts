import { test, expect } from "@playwright/test";

// Mock data for controlled testing
const mockFactCheckResult = {
  verdict: "true",
  confidence: 4,
  whatsTrue: ["Speed of light: 299,792 km/s (NIST)", "Rounds to 300,000 km/s accurately"],
  whatsWrong: [],
  context: ["Exact value in vacuum is 299,792.458 km/s"],
  sources: [{ name: "NIST" }, { name: "NASA" }],
  argument: {
    claim: "The speed of light is approximately 300,000 km per second.",
    grounds: [
      "Measured speed is 299,792 km/s per NIST data.",
      "Claim rounds to 300,000 km/s, within 0.07% error.",
      "Widely accepted approximation in scientific literature.",
    ],
    warrant: "Close approximation to measured value justifies the claim as accurate.",
    backing: "Scientific consensus accepts rounded figures for general use.",
    qualifier: "certain",
    rebuttals: [
      "Claim could be undermined if exact value is required.",
      "Context of medium (not vacuum) could affect accuracy.",
    ],
  },
};

test.describe("Argument Structure - API Tests", () => {
  test("fact-check API returns Toulmin structure", async ({ request }) => {
    const response = await request.post("/api/fact-check", {
      data: { claim: "The Earth is approximately 4.5 billion years old" },
    });

    expect(response.ok()).toBe(true);
    const result = await response.json();

    // Validate Toulmin structure
    expect(result.argument).toBeDefined();
    expect(result.argument.claim).toBeTruthy();
    expect(Array.isArray(result.argument.grounds)).toBe(true);
    expect(result.argument.warrant).toBeTruthy();
    expect(["certain", "probable", "possible", "uncertain"]).toContain(result.argument.qualifier);

    console.log("\n=== API Response ===");
    console.log("Verdict:", result.verdict);
    console.log("Qualifier:", result.argument.qualifier);
    console.log("Grounds:", result.argument.grounds);
  });
});

test.describe("Argument Structure - E2E with Real Components", () => {
  test("renders FactCheckCard with mocked Toulmin structure", async ({ page }) => {
    const testClaim = "The speed of light is approximately 300,000 km per second";

    // Mock the fact-check API to return controlled Toulmin structure
    await page.route("/api/fact-check", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFactCheckResult),
      });
    });

    await page.goto("/");

    // Use the text input to submit a claim
    await page.getByTestId("claim-input").fill(testClaim);
    await page.getByTestId("claim-submit").click();

    // Wait for the fact-check card to appear
    await expect(page.locator("text=speed of light")).toBeVisible({ timeout: 10000 });

    // Expand the card to see details
    await page.locator("text=speed of light").click();

    // Verify What's True section appears
    await expect(page.locator("text=What's True")).toBeVisible();

    // Verify Argument Structure section appears
    await expect(page.locator("text=Argument Structure")).toBeVisible();

    // Expand the argument breakdown
    await page.locator("text=Argument Structure").click();

    // Verify Toulmin components are rendered
    await expect(page.locator("text=Grounds (Evidence)")).toBeVisible();
    await expect(page.locator("text=Warrant (Logic)")).toBeVisible();
    await expect(page.locator("text=Rebuttals")).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: "tests/e2e-mocked.png", fullPage: true });
  });

  test("full E2E with live API - renders real Toulmin structure", async ({ page }) => {
    const testClaim = "Water boils at 100 degrees Celsius at sea level";

    await page.goto("/");

    // Use the text input to submit a claim (hits real API)
    await page.getByTestId("claim-input").fill(testClaim);
    await page.getByTestId("claim-submit").click();

    // Wait for loading to complete (real API call)
    await expect(page.locator("text=Water boils")).toBeVisible({ timeout: 30000 });

    // Wait for result to load (not loading anymore)
    await page.waitForFunction(() => {
      const card = document.querySelector('[class*="rounded-2xl"]');
      return card && !card.textContent?.includes("Loading");
    }, { timeout: 30000 });

    // Expand the card
    await page.locator("text=Water boils").click();

    // Check for Argument Structure
    await expect(page.locator("text=Argument Structure")).toBeVisible({ timeout: 5000 });

    // Expand and verify
    await page.locator("text=Argument Structure").click();
    await expect(page.locator("text=Grounds (Evidence)")).toBeVisible();
    await expect(page.locator("text=Warrant (Logic)")).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: "tests/e2e-live.png", fullPage: true });

    console.log("\n=== Live E2E Test Passed ===");
    console.log("Real FactCheckCard rendered with Toulmin structure from live API");
  });
});
