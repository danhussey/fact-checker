import { test, expect } from "@playwright/test";

test.describe("Topical Deep Research", () => {
  test("displays topic chips in empty state", async ({ page }) => {
    await page.goto("/");

    // Wait for the page to load
    await expect(page.getByText("Ready to fact-check")).toBeVisible();

    // Check that topic chips are visible
    await expect(page.getByText("Or explore researched topics")).toBeVisible();

    // Check for at least one topic chip
    await expect(page.getByRole("link", { name: /ICE Shooting Debate/i })).toBeVisible();
  });

  test("topic chip shows claim count", async ({ page }) => {
    await page.goto("/");

    // Check that the topic chip shows the claim count
    const topicChip = page.getByRole("link", { name: /ICE Shooting Debate/i });
    await expect(topicChip).toBeVisible();

    // The chip should contain "claims" text
    await expect(topicChip.getByText(/claims/i)).toBeVisible();
  });

  test("clicking topic chip navigates to detail page", async ({ page }) => {
    await page.goto("/");

    // Click on a topic chip
    const topicChip = page.getByRole("link", { name: /ICE Shooting Debate/i });
    await topicChip.click();

    // Should navigate to the topic detail page
    await expect(page).toHaveURL(/\/topics\/ice-shooting-debate/);

    // The detail page should show the topic title
    await expect(page.getByRole("heading", { name: /ICE Shooting Debate/i })).toBeVisible();
  });

  test("topic detail page shows claims with verdicts", async ({ page }) => {
    // Navigate directly to a topic page
    await page.goto("/topics/ice-shooting-debate");

    // Check for the topic title
    await expect(page.getByRole("heading", { name: /ICE Shooting Debate/i })).toBeVisible();

    // Check for summary text
    await expect(page.getByText(/Analysis of claims/i)).toBeVisible();

    // Check that claims are displayed
    await expect(page.getByText(/claims analyzed/i)).toBeVisible();

    // Check for a claim card (should have at least one verdict badge)
    const claimCards = page.locator("[class*='rounded-2xl bg-surface']");
    await expect(claimCards.first()).toBeVisible();
  });

  test("topic detail page has back link to main page", async ({ page }) => {
    await page.goto("/topics/ice-shooting-debate");

    // Find and click the back link
    const backLink = page.getByRole("link", { name: /Back to fact-checker/i });
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should navigate back to main page
    await expect(page).toHaveURL("/");
  });

  test("claim card expands to show evidence", async ({ page }) => {
    await page.goto("/topics/ice-shooting-debate");

    // Wait for claims to load
    await expect(page.getByText(/claims analyzed/i)).toBeVisible();

    // Find a claim card button and click it
    const claimButton = page.locator("button[class*='w-full px-5 py-4']").first();
    await claimButton.click();

    // Check for evidence sections (either supporting or contradicting)
    const evidenceSection = page.getByText(/Supporting Evidence|Contradicting Evidence/i).first();
    await expect(evidenceSection).toBeVisible();
  });

  test("carbon tax topic page loads correctly", async ({ page }) => {
    await page.goto("/topics/climate-carbon-tax");

    // Check for the topic title
    await expect(page.getByRole("heading", { name: /Carbon Tax/i })).toBeVisible();

    // Check that it's categorized as economics
    await expect(page.getByText("economics")).toBeVisible();
  });

  test("invalid topic slug returns 404", async ({ page }) => {
    const response = await page.goto("/topics/nonexistent-topic");

    // Should return 404
    expect(response?.status()).toBe(404);
  });

  test("topic chip categories have distinct colors", async ({ page }) => {
    await page.goto("/");

    // Get all topic chips
    const politicsChip = page.getByRole("link", { name: /ICE Shooting Debate/i });
    const economicsChip = page.getByRole("link", { name: /Carbon Tax/i });

    // Both chips should be visible
    await expect(politicsChip).toBeVisible();
    await expect(economicsChip).toBeVisible();

    // Check that they have different background colors via class
    const politicsClasses = await politicsChip.getAttribute("class");
    const economicsClasses = await economicsChip.getAttribute("class");

    // Politics should have blue, economics should have amber
    expect(politicsClasses).toContain("blue");
    expect(economicsClasses).toContain("amber");
  });
});

test.describe("Topic Loading", () => {
  test("getTopicListings returns valid data", async ({ page }) => {
    await page.goto("/");

    // Check that topics are loaded (we should see at least 2 topics)
    const topicLinks = page.locator("a[href^='/topics/']");
    const count = await topicLinks.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
