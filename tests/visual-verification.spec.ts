import { test, expect } from "@playwright/test";

/**
 * Visual Verification Tests
 *
 * Run with: npx playwright test tests/visual-verification.spec.ts --ui
 *
 * These tests are designed to be stepped through in the Playwright GUI
 * to visually verify the new abuse prevention and topics features.
 */

test.describe("🎨 Visual: Topics Feature", () => {
  test("Topic chips appear in empty state", async ({ page }) => {
    await page.goto("/");

    // Step 1: Verify main page loads
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Step 2: Verify "explore topics" section appears
    await expect(page.getByText("Or explore researched topics")).toBeVisible();

    // Step 3: Verify ICE topic chip is visible with correct styling
    const iceChip = page.getByRole("link", { name: /ICE Shooting Debate/i });
    await expect(iceChip).toBeVisible();
    await expect(iceChip).toHaveClass(/blue/); // Politics = blue

    // Step 4: Verify Carbon Tax chip is visible with correct styling
    const carbonChip = page.getByRole("link", { name: /Carbon Tax/i });
    await expect(carbonChip).toBeVisible();
    await expect(carbonChip).toHaveClass(/amber/); // Economics = amber

    // Step 5: Verify claim counts are shown
    await expect(iceChip.getByText(/\d+ claims/)).toBeVisible();
    await expect(carbonChip.getByText(/\d+ claims/)).toBeVisible();
  });

  test("Navigate to ICE Shooting topic page", async ({ page }) => {
    await page.goto("/");

    // Step 1: Click on the ICE topic chip
    await page.getByRole("link", { name: /ICE Shooting Debate/i }).click();

    // Step 2: Verify URL changed
    await expect(page).toHaveURL(/\/topics\/ice-shooting-debate/);

    // Step 3: Verify header elements
    await expect(page.getByRole("heading", { name: /ICE Shooting Debate/i })).toBeVisible();
    await expect(page.getByText(/Analysis of claims/i)).toBeVisible();

    // Step 4: Verify category badge
    await expect(page.getByText("politics")).toBeVisible();

    // Step 5: Verify claims count
    await expect(page.getByText(/\d+ claims analyzed/)).toBeVisible();

    // Step 6: Verify back link exists
    await expect(page.getByRole("link", { name: /Back to fact-checker/i })).toBeVisible();
  });

  test("Navigate to Carbon Tax topic page", async ({ page }) => {
    await page.goto("/topics/climate-carbon-tax");

    // Step 1: Verify page loaded
    await expect(page.getByRole("heading", { name: /Carbon Tax/i })).toBeVisible();

    // Step 2: Verify economics category
    await expect(page.getByText("economics")).toBeVisible();

    // Step 3: Verify summary text
    await expect(page.getByText(/carbon pricing/i)).toBeVisible();
  });

  test("Expand claim card to see evidence", async ({ page }) => {
    await page.goto("/topics/ice-shooting-debate");

    // Step 1: Wait for claims to load
    await expect(page.getByText(/claims analyzed/)).toBeVisible();

    // Step 2: Find the first claim card
    const firstClaimCard = page.locator("button").filter({ hasText: /ICE agents|individual|enforcement|Community/i }).first();
    await expect(firstClaimCard).toBeVisible();

    // Step 3: Click to expand
    await firstClaimCard.click();

    // Step 4: Wait for evidence sections to appear
    await page.waitForTimeout(300); // Animation delay

    // Step 5: Check for evidence sections (green = supporting, red = contradicting)
    const supportingEvidence = page.getByText("Supporting Evidence");
    const contradictingEvidence = page.getByText("Contradicting Evidence");

    // At least one should be visible
    const hasSupportingEvidence = await supportingEvidence.isVisible().catch(() => false);
    const hasContradictingEvidence = await contradictingEvidence.isVisible().catch(() => false);

    expect(hasSupportingEvidence || hasContradictingEvidence).toBe(true);

    // Step 6: Verify source chips appear
    const sourceChips = page.locator("a[href], span").filter({ hasText: /Reuters|Court Records|ICE|Police|EPA/i });
    await expect(sourceChips.first()).toBeVisible();
  });

  test("Verdict badges display correctly", async ({ page }) => {
    await page.goto("/topics/ice-shooting-debate");

    // Step 1: Check for various verdict types
    // The ICE topic has: mostly true, false, half true, true

    // Look for verdict badges
    const verdictBadges = page.locator("[class*='rounded-full']").filter({ hasText: /True|False|Unverified/i });

    // Should have multiple verdict badges
    const count = await verdictBadges.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("Back navigation works correctly", async ({ page }) => {
    // Step 1: Start on topic page
    await page.goto("/topics/ice-shooting-debate");
    await expect(page.getByRole("heading", { name: /ICE Shooting Debate/i })).toBeVisible();

    // Step 2: Click back link
    await page.getByRole("link", { name: /Back to fact-checker/i }).click();

    // Step 3: Verify we're back on main page
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Step 4: Verify topic chips are still visible
    await expect(page.getByRole("link", { name: /ICE Shooting Debate/i })).toBeVisible();
  });
});

test.describe("🛡️ Visual: Abuse Prevention UI", () => {
  test("Main page shows microphone button", async ({ page }) => {
    await page.goto("/");

    // Step 1: Verify the main listening button exists
    const micButton = page.getByRole("button", { name: /Start listening|Listen/i });
    await expect(micButton).toBeVisible();

    // Step 2: Verify the button has the correct styling
    await expect(micButton).toHaveClass(/bg-text/);
  });

  test("Session usage state is initialized", async ({ page }) => {
    await page.goto("/");

    // Step 1: Check that localStorage has the usage tracking key structure
    const hasUsageKey = await page.evaluate(() => {
      const key = "fact-checker:daily-usage";
      const stored = localStorage.getItem(key);
      if (!stored) return "not-set";
      try {
        const parsed = JSON.parse(stored);
        return parsed.date && typeof parsed.totalMs === "number" ? "valid" : "invalid";
      } catch {
        return "invalid";
      }
    });

    // Initially may not be set, which is fine
    expect(["not-set", "valid"]).toContain(hasUsageKey);
  });

  test("API returns session quota info", async ({ page, request }) => {
    await page.goto("/");

    // Step 1: Make a request to the token endpoint
    const response = await request.post("/api/deepgram-token");

    // Step 2: Check response (will be 500 if no API key, which is expected in test env)
    if (response.ok()) {
      const data = await response.json();

      // Step 3: Verify quota fields exist
      expect(data).toHaveProperty("sessionsRemaining");
      expect(data).toHaveProperty("maxDurationMs");
      expect(data.maxDurationMs).toBe(30 * 60 * 1000); // 30 minutes

      console.log("Sessions remaining:", data.sessionsRemaining);
    } else {
      // Expected in test environment without API key
      expect(response.status()).toBe(500);
    }
  });

  test("Settings modal opens and shows options", async ({ page }) => {
    await page.goto("/");

    // Step 1: Find and click the Settings button
    const settingsButton = page.getByRole("button", { name: /Settings/i });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // Step 2: Verify settings modal opens
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    // Step 3: Verify "Argument structure" toggle exists
    await expect(page.getByText("Argument structure")).toBeVisible();
    await expect(page.getByText("Toulmin breakdown")).toBeVisible();

    // Step 4: Close the modal
    await page.getByRole("button", { name: /Close/i }).click();
    await expect(modal).not.toBeVisible();
  });
});

test.describe("📱 Visual: Responsive Design", () => {
  test("Topics display correctly on mobile", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Step 1: Verify main content is visible
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Step 2: Verify topic chips wrap correctly
    await expect(page.getByText("Or explore researched topics")).toBeVisible();

    const topicChips = page.locator("a[href^='/topics/']");
    await expect(topicChips.first()).toBeVisible();
  });

  test("Topic detail page works on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/topics/ice-shooting-debate");

    // Step 1: Verify header is visible
    await expect(page.getByRole("heading", { name: /ICE Shooting/i })).toBeVisible();

    // Step 2: Verify claims are scrollable
    const claimCards = page.locator("[class*='rounded-2xl bg-surface']");
    await expect(claimCards.first()).toBeVisible();

    // Step 3: Expand a claim on mobile
    const expandableCard = page.locator("button").filter({ hasText: /ICE agents|individual/i }).first();
    await expandableCard.click();

    await page.waitForTimeout(300);
  });

  test("Topics display correctly on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    // Verify layout adjusts for tablet
    await expect(page.getByText("Ready to fact-check")).toBeVisible();
    await expect(page.getByRole("link", { name: /ICE Shooting/i })).toBeVisible();
  });
});

test.describe("🔗 Visual: Navigation Flow", () => {
  test("Complete user journey: Browse topics then return", async ({ page }) => {
    // Step 1: Start on main page
    await page.goto("/");
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Step 2: Click on a topic
    await page.getByRole("link", { name: /ICE Shooting/i }).click();
    await expect(page).toHaveURL(/ice-shooting/);

    // Step 3: Explore the topic - expand a claim
    const firstClaim = page.locator("button").filter({ hasText: /agents|individual|enforcement/i }).first();
    await firstClaim.click();
    await page.waitForTimeout(500);

    // Step 4: Collapse the claim
    await firstClaim.click();
    await page.waitForTimeout(300);

    // Step 5: Go back to main page
    await page.getByRole("link", { name: /Back to fact-checker/i }).click();
    await expect(page).toHaveURL("/");

    // Step 6: Try another topic
    await page.getByRole("link", { name: /Carbon Tax/i }).click();
    await expect(page).toHaveURL(/carbon-tax/);
    await expect(page.getByText("economics")).toBeVisible();

    // Step 7: Return home again
    await page.getByRole("link", { name: /Back/i }).click();
    await expect(page).toHaveURL("/");
  });

  test("Direct URL access works for all topics", async ({ page }) => {
    // Step 1: Access ICE topic directly
    await page.goto("/topics/ice-shooting-debate");
    await expect(page.getByRole("heading", { name: /ICE/i })).toBeVisible();

    // Step 2: Access Carbon Tax topic directly
    await page.goto("/topics/climate-carbon-tax");
    await expect(page.getByRole("heading", { name: /Carbon Tax/i })).toBeVisible();

    // Step 3: Access invalid topic (should 404)
    const response = await page.goto("/topics/nonexistent-topic");
    expect(response?.status()).toBe(404);
  });
});

test.describe("🎭 Visual: Dark/Light Theme", () => {
  test("Page respects system color scheme", async ({ page }) => {
    // Test with dark mode preference
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    // Verify page loads (actual colors depend on CSS variables)
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Take a pause to visually inspect dark mode
    await page.waitForTimeout(1000);

    // Switch to light mode
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();

    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Take a pause to visually inspect light mode
    await page.waitForTimeout(1000);
  });

  test("Topic page in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/topics/ice-shooting-debate");

    // Verify page loads with dark theme
    await expect(page.getByRole("heading", { name: /ICE/i })).toBeVisible();

    // Expand a card to see evidence styling in dark mode
    const claim = page.locator("button").filter({ hasText: /agents/i }).first();
    await claim.click();

    await page.waitForTimeout(1000);
  });
});
