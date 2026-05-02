import { test, expect } from "@playwright/test";
import {
  claimSimilarityScore,
  getExtractionDelayMs,
  isDisputeCue,
  isExplicitVerifyCue,
} from "../src/lib/claimProcessing";
import { claimFactsDiffer, measurementsDiffer } from "../src/lib/claimComparison";
import { directFactClaimFallback } from "../src/lib/directClaimFallback";
import { normalizeSourceUrl } from "../src/lib/sourceUrls";

test.describe("Claim Processing Helpers", () => {
  test("detects near-duplicate claims", () => {
    const score = claimSimilarityScore(
      "Indigenous Australians receive twice as much funding as white Australians per capita",
      "They receive 2x funding per capita"
    );
    expect(score).toBeGreaterThan(0.7);

    const unrelated = claimSimilarityScore("Cats are mammals", "The sky is blue");
    expect(unrelated).toBeLessThan(0.4);
  });

  test("does not collapse claims with different measurement units", () => {
    const score = claimSimilarityScore(
      "The Eiffel Tower is twenty five minutes tall",
      "The Eiffel Tower is 25 meters tall"
    );
    expect(score).toBe(0);
    expect(
      measurementsDiffer(
        "The Eiffel Tower is twenty five minutes tall",
        "The Eiffel Tower is 25 meters tall"
      )
    ).toBeTruthy();
  });

  test("does not collapse claims when factual anchors change", () => {
    expect(
      claimFactsDiffer("Apple Tower is 300 feet tall", "Samsung Tower is 300 feet tall")
    ).toBeTruthy();
    expect(
      claimFactsDiffer("Apple Tower is 300 feet tall", "Apple Tower is 400 feet tall")
    ).toBeTruthy();
    expect(
      claimFactsDiffer('The policy was called "Project Blue"', 'The policy was called "Project Red"')
    ).toBeTruthy();
    expect(
      claimSimilarityScore("Apple Tower is 300 feet tall", "Apple Tower is 300 ft tall")
    ).toBeGreaterThan(0.7);
  });

  test("flags explicit verify and dispute cues", () => {
    expect(isExplicitVerifyCue("fact check that")).toBeTruthy();
    expect(isExplicitVerifyCue("fact-checkers are busy")).toBeFalsy();
    expect(isDisputeCue("that's wrong")).toBeTruthy();
    expect(isDisputeCue("I think so")).toBeFalsy();
  });

  test("adjusts extraction delay for incomplete phrases", () => {
    const punctuated = getExtractionDelayMs("Unemployment is 5%.", false);
    const trailingNumber = getExtractionDelayMs("Unemployment is 5", false);
    expect(trailingNumber).toBeGreaterThan(punctuated);
  });

  test("falls back for direct numeric fact claims", () => {
    expect(directFactClaimFallback("the apple tower is 300 feet tall")).toBe(
      "the apple tower is 300 feet tall"
    );
    expect(directFactClaimFallback("I wonder how tall the apple tower is")).toBeNull();
    expect(directFactClaimFallback("that seems pretty tall")).toBeNull();
  });

  test("normalizes source urls and drops placeholders", () => {
    expect(normalizeSourceUrl("N/A")).toBeUndefined();
    expect(normalizeSourceUrl("General Search")).toBeUndefined();
    expect(normalizeSourceUrl("www.example.com/source")).toBe("https://www.example.com/source");
  });
});
