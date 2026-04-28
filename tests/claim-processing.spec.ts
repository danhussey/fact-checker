import { test, expect } from "@playwright/test";
import {
  claimSimilarityScore,
  getExtractionDelayMs,
  isDisputeCue,
  isExplicitVerifyCue,
} from "../src/lib/claimProcessing";
import { directFactClaimFallback } from "../src/lib/directClaimFallback";

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
});
