import type { Verdict, StructuredFactCheck } from "./types";

/**
 * Compact share data encoded into URL-safe base64.
 * Uses short keys to minimize URL length.
 */
interface SharePayload {
  c: string;        // claim
  v: string;        // verdict
  f: number;        // confidence (1-4)
  t: string[];      // whatsTrue
  w: string[];      // whatsWrong
  x: string[];      // context
  s: string[];      // source names
}

const VERDICTS: Verdict[] = [
  "true", "mostly true", "half true", "mostly false", "false", "unverified",
];

export interface ShareData {
  claim: string;
  verdict: Verdict;
  confidence: 1 | 2 | 3 | 4;
  whatsTrue: string[];
  whatsWrong: string[];
  context: string[];
  sourceNames: string[];
}

export function encodeShareData(
  claim: string,
  result: StructuredFactCheck,
): string {
  const payload: SharePayload = {
    c: claim,
    v: result.verdict,
    f: result.confidence,
    t: result.whatsTrue.slice(0, 2),
    w: result.whatsWrong.slice(0, 2),
    x: result.context.slice(0, 2),
    s: result.sources.slice(0, 3).map((s) => s.name),
  };

  const json = JSON.stringify(payload);
  // Use base64url encoding (URL-safe, no padding)
  const encoded = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return encoded;
}

export function decodeShareData(encoded: string): ShareData | null {
  try {
    // Restore standard base64
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }

    const json = decodeURIComponent(escape(atob(base64)));
    const payload: SharePayload = JSON.parse(json);

    // Validate verdict
    const verdict = VERDICTS.includes(payload.v as Verdict)
      ? (payload.v as Verdict)
      : "unverified";

    // Validate confidence
    const confidence = ([1, 2, 3, 4] as const).includes(payload.f as 1 | 2 | 3 | 4)
      ? (payload.f as 1 | 2 | 3 | 4)
      : 1;

    return {
      claim: String(payload.c || ""),
      verdict,
      confidence,
      whatsTrue: Array.isArray(payload.t) ? payload.t.map(String) : [],
      whatsWrong: Array.isArray(payload.w) ? payload.w.map(String) : [],
      context: Array.isArray(payload.x) ? payload.x.map(String) : [],
      sourceNames: Array.isArray(payload.s) ? payload.s.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(claim: string, result: StructuredFactCheck): string {
  const encoded = encodeShareData(claim, result);
  // Use relative path; the component will resolve against window.location.origin
  return `/fact/${encoded}`;
}
