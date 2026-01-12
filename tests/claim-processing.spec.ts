import { test, expect } from "@playwright/test";
import {
  claimSimilarityScore,
  getExtractionDelayMs,
  isDisputeCue,
  isExplicitVerifyCue,
} from "../src/lib/claimProcessing";

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
});
