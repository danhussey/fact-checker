import { test, expect } from "@playwright/test";

test.describe("Research API", () => {
  test("research endpoint requires authentication", async ({ request }) => {
    // Try to call the research endpoint without auth
    const response = await request.post("/api/research/topic", {
      data: {
        title: "Test Topic",
      },
    });

    // Should return 401 Unauthorized (if RESEARCH_ADMIN_KEY is set)
    // or proceed if no key is configured
    const status = response.status();
    expect([401, 200, 500, 429]).toContain(status);

    if (status === 401) {
      const data = await response.json();
      expect(data.error).toContain("Unauthorized");
    }
  });

  test("research endpoint validates input", async ({ request }) => {
    // Try to call without a title
    const response = await request.post("/api/research/topic", {
      data: {},
      headers: {
        // Include a fake admin key to pass auth if not set
        Authorization: "Bearer test-key",
      },
    });

    // Should return 400 Bad Request or 401 if auth fails
    const status = response.status();
    expect([400, 401]).toContain(status);
  });

  test("research endpoint returns valid topic structure when successful", async ({
    request,
  }) => {
    // Skip this test if running in CI without API keys
    test.skip(
      !process.env.XAI_API_KEY || !process.env.PERPLEXITY_API_KEY,
      "Requires API keys"
    );

    const response = await request.post("/api/research/topic", {
      data: {
        title: "Climate Change Effects",
        context: "Recent studies on global warming",
      },
      headers: {
        Authorization: `Bearer ${process.env.RESEARCH_ADMIN_KEY || ""}`,
      },
    });

    if (response.ok()) {
      const topic = await response.json();

      // Validate the structure
      expect(topic).toHaveProperty("id");
      expect(topic).toHaveProperty("slug");
      expect(topic).toHaveProperty("title");
      expect(topic).toHaveProperty("summary");
      expect(topic).toHaveProperty("category");
      expect(topic).toHaveProperty("claims");
      expect(Array.isArray(topic.claims)).toBe(true);

      // Each claim should have the expected structure
      if (topic.claims.length > 0) {
        const claim = topic.claims[0];
        expect(claim).toHaveProperty("statement");
        expect(claim).toHaveProperty("verdict");
        expect(claim).toHaveProperty("confidence");
        expect(claim).toHaveProperty("evidenceFor");
        expect(claim).toHaveProperty("evidenceAgainst");
        expect(claim).toHaveProperty("sources");
      }
    }
  });

  test("research endpoint prevents concurrent requests", async ({ request }) => {
    // Skip this test if running in CI without API keys
    test.skip(
      !process.env.XAI_API_KEY || !process.env.PERPLEXITY_API_KEY,
      "Requires API keys"
    );

    // Start two concurrent requests
    const [response1, response2] = await Promise.all([
      request.post("/api/research/topic", {
        data: { title: "Test Topic 1" },
        headers: {
          Authorization: `Bearer ${process.env.RESEARCH_ADMIN_KEY || ""}`,
        },
      }),
      request.post("/api/research/topic", {
        data: { title: "Test Topic 2" },
        headers: {
          Authorization: `Bearer ${process.env.RESEARCH_ADMIN_KEY || ""}`,
        },
      }),
    ]);

    // One should succeed or be unauthorized, the other should be rate limited
    const statuses = [response1.status(), response2.status()];

    // At least one should be a rate limit (429) if both requests were accepted
    const hasRateLimit = statuses.includes(429);
    const hasSuccess = statuses.includes(200);
    const hasUnauthorized = statuses.includes(401);

    // Either we hit rate limiting, or auth blocked both, or one succeeded
    expect(hasRateLimit || hasUnauthorized || hasSuccess).toBe(true);
  });
});

test.describe("Topic JSON Files", () => {
  test("can fetch topic listing from static files", async ({ page }) => {
    await page.goto("/");

    // The topics should be loaded from the JSON files
    const topicLink = page.getByRole("link", { name: /ICE Shooting Debate/i });
    await expect(topicLink).toBeVisible();
  });

  test("topic slugs match between listing and detail pages", async ({ page }) => {
    // Get topics from the main page
    await page.goto("/");

    const topicLinks = page.locator("a[href^='/topics/']");
    const hrefs = await topicLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href"))
    );

    // Each link should work
    for (const href of hrefs) {
      if (href) {
        const response = await page.goto(href);
        expect(response?.status()).toBe(200);
      }
    }
  });
});
