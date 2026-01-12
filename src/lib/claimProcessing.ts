"use client";

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "again", "further", "then", "once", "here",
  "there", "when", "where", "why", "how", "all", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
  "because", "until", "while", "although", "though", "after",
  "that", "which", "who", "whom", "this", "these", "those", "what",
  "says", "said", "according", "suggests", "mentioned", "refers",
  "described", "noted", "indicates", "asserts",
]);

const DISPUTE_PATTERNS = [
  /\b(i disagree|that's wrong|that is wrong|you're wrong|not true|isn't true)\b/i,
  /\b(incorrect|false|that's false|that is false)\b/i,
  /\b(no,?\s+that's|no,?\s+that is)\b/i,
];

const VERIFY_PATTERNS = [
  /\b(fact[- ]?check|verify|check if)\b/i,
  /\b(is that true|is this true|is it true|is that correct)\b/i,
];

const CONTINUATION_WORDS = new Set([
  "of", "that", "because", "and", "or", "but", "with", "to", "for",
  "from", "as", "per", "than",
]);

const QUICK_DELAY_MS = 120;
const BASE_DELAY_MS = 220;
const NUMBER_DELAY_MS = 450;
const CONTINUATION_DELAY_MS = 650;

export function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .trim()
    .replace(/\bgigabytes?\b/gi, "gb")
    .replace(/\bmegabytes?\b/gi, "mb")
    .replace(/\bterabytes?\b/gi, "tb")
    .replace(/\bkilobytes?\b/gi, "kb")
    .replace(/\bmillion\b/gi, "m")
    .replace(/\bbillion\b/gi, "b")
    .replace(/\bthousand\b/gi, "k")
    .replace(/\bdollars?\b/gi, "$")
    .replace(/\bpounds?\b/gi, "£")
    .replace(/\beuros?\b/gi, "€")
    .replace(/\bpercent\b/gi, "%")
    .replace(/\bper\s*cent\b/gi, "%")
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:'"]/g, "");
}

function contentTokens(text: string): Set<string> {
  return new Set(
    text.split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  );
}

export function claimSimilarityScore(a: string, b: string): number {
  const normalizedA = normalizeClaim(a);
  const normalizedB = normalizeClaim(b);

  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.95;

  const aTokens = contentTokens(normalizedA);
  const bTokens = contentTokens(normalizedB);

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.min(aTokens.size, bTokens.size);
}

export function isDisputeCue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return DISPUTE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isExplicitVerifyCue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return VERIFY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function getExtractionDelayMs(text: string, hasExplicitVerify: boolean): number {
  if (hasExplicitVerify) return 0;

  const trimmed = text.trim();
  if (!trimmed) return BASE_DELAY_MS;

  if (/[.!?]$/.test(trimmed)) return QUICK_DELAY_MS;

  const lower = trimmed.toLowerCase();
  const lastWord = lower.split(/\s+/).pop() || "";
  if (CONTINUATION_WORDS.has(lastWord)) return CONTINUATION_DELAY_MS;

  if (/\d$/.test(trimmed)) return NUMBER_DELAY_MS;

  return BASE_DELAY_MS;
}
