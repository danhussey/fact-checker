import { test, expect, type Page } from "@playwright/test";

const mockFactCheckResult = {
  verdict: "true",
  confidence: 4,
  whatsTrue: ["Speed of light: 299,792 km/s (NIST)"],
  whatsWrong: [],
  context: ["Exact value in vacuum is 299,792.458 km/s"],
  sources: [{ name: "NIST" }, { name: "NASA" }],
};

const TEXT_INPUT_KEY = "fact-checker:show-text-input";

async function seedTextInputSetting(page: Page) {
  await page.addInitScript((textInputKey: string) => {
    localStorage.setItem(textInputKey, "true");
  }, TEXT_INPUT_KEY);
}

test.describe("Source Chips with Topic Flag Disabled", () => {
  test("shows claim source chips when NEXT_PUBLIC_SHOW_RESEARCH_TOPICS=false", async ({
    page,
  }) => {
    await page.route("/api/fact-check", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFactCheckResult),
      });
    });

    await seedTextInputSetting(page);
    await page.goto("/");

    // Confirm topic listing section is actually disabled by env flag.
    await expect(page.getByText("Or explore researched topics")).toHaveCount(0);

    await page.getByTestId("claim-input").fill("The speed of light is approximately 300,000 km per second");
    await page.getByTestId("claim-submit").click();

    const claimText = page.getByText(/speed of light/i);
    await expect(claimText).toBeVisible({ timeout: 10000 });
    await claimText.click();

    const card = page
      .locator("div.rounded-2xl.bg-surface")
      .filter({ has: page.getByText(/speed of light/i) })
      .first();

    await expect(card.locator("span", { hasText: /^NIST$/ })).toBeVisible();
    await expect(card.locator("span", { hasText: /^NASA$/ })).toBeVisible();
  });

  test("renders placeholder source urls as plain chips", async ({ page }) => {
    await page.route("/api/fact-check", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...mockFactCheckResult,
          context: ["No data on the claim found in reliable sources."],
          sources: [{ name: "General Search", url: "N/A" }],
        }),
      });
    });

    await seedTextInputSetting(page);
    await page.goto("/");

    await page.getByTestId("claim-input").fill("The Apple Tower is 300 feet tall");
    await page.getByTestId("claim-submit").click();

    const claimText = page.getByText(/Apple Tower/i);
    await expect(claimText).toBeVisible({ timeout: 10000 });
    await claimText.click();

    const card = page
      .locator("div.rounded-2xl.bg-surface")
      .filter({ has: page.getByText(/Apple Tower/i) })
      .first();

    await expect(card.locator("span", { hasText: /^General Search$/ })).toBeVisible();
    await expect(card.locator("a", { hasText: /General Search/ })).toHaveCount(0);
    await expect(card.locator("a[href='/N/A']")).toHaveCount(0);
  });
});
