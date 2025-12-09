import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { debug } from "@/lib/debug";

// Stop words to ignore in similarity comparison
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
  "speaker", "claims", "states", "says", "said", "according", "suggests",
  "mentioned", "refers", "described", "noted", "indicates", "asserts"
]);

function normalizeForComparison(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")  // Remove punctuation
    .replace(/\s+/g, " ")       // Normalize whitespace
    .trim();
}

function extractContentWords(text: string): Set<string> {
  return new Set(
    text.split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

const claimsSchema = z.object({
  claims: z.array(z.string()).describe("Array of fact-checkable claims. Empty if none found."),
});

function buildSystemPrompt(checkedClaims: string[]): string {
  const checkedSection = checkedClaims.length > 0
    ? `

**CRITICAL: DUPLICATE PREVENTION**
These claims have ALREADY been fact-checked. DO NOT extract them again, even if rephrased:
${checkedClaims.map(c => `- "${c}"`).join("\n")}

If the transcript repeats or rephrases any of these claims, return EMPTY array.
"Indigenous Australians get twice as much" = SAME AS = "They receive 2x funding" = DUPLICATE!
`
    : "";

  return `Extract NEW fact-checkable claims from transcripts.

EXPLICIT FACT-CHECK REQUESTS (HIGHEST PRIORITY):
If someone says "fact check that", "is that true", "check if", "verify that", etc:
- Extract the claim they want checked from context
- IGNORE the duplicate list - user explicitly wants this checked
- Mark with prefix "FORCE:" so we know to bypass dedup

EXTRACT:
- Statistics and numbers
- Comparisons with specifics
- Policy/government claims
- Historical claims

HEDGING LANGUAGE - STILL EXTRACT THE CLAIM:
- "I think X" → extract X as a claim
- "I've heard that X" → extract X as a claim
- "Apparently X" → extract X as a claim
- "Maybe X" → extract X as a claim
Strip the hedging, keep the factual assertion.

SKIP only (unless explicitly requested):
- Pure opinions with no factual claim ("we should do better")
- Future predictions ("it will happen")
- Truly vague statements (no specifics at all)
- ANYTHING similar to already-checked claims
${checkedSection}
RULES:
1. Make claims COMPLETE and SELF-CONTAINED
2. Use context to fill in WHO/WHAT
3. BAD: "twice as much as white Australians" (missing subject)
4. GOOD: "Indigenous Australians receive twice as much funding as white Australians per capita"

Return 0-2 NEW claims only. If nothing NEW, return empty array.
For explicit requests, prefix with "FORCE:" to bypass duplicate check.`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support both old format (just text) and new format (with context)
    const newText = body.newText || body.text || "";
    const recentContext = body.recentContext || "";
    const checkedClaims: string[] = body.checkedClaims || [];

    debug.claims.request(newText, recentContext, checkedClaims);

    if (!newText || typeof newText !== "string") {
      debug.claims.skip("no text");
      return Response.json({ claims: [] });
    }

    // Skip very short text
    if (newText.trim().length < 10) {
      debug.claims.skip("text too short");
      return Response.json({ claims: [] });
    }

    // Build prompt with context - combine them so the model sees full conversation
    let prompt = "";
    if (recentContext && recentContext.trim()) {
      // Combine context + new text into one flowing transcript
      prompt = `TRANSCRIPT (analyze the WHOLE thing, especially the end):\n"${recentContext} ${newText}"\n\nFocus on claims in the recent/final part, but use earlier context to make claims complete.`;
    } else {
      prompt = `TRANSCRIPT:\n"${newText}"`;
    }

    const result = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: claimsSchema,
      system: buildSystemPrompt(checkedClaims),
      prompt,
    });

    console.log("[usage:extract-claims]", { model: "gpt-4o-mini", ...result.usage });

    // Filter valid claims
    let claims = result.object.claims.filter(
      (c) => typeof c === "string" && c.trim().length > 10
    );

    // Separate forced claims (explicit user requests) from regular claims
    const forcedClaims: string[] = [];
    const regularClaims: string[] = [];

    for (const claim of claims) {
      if (claim.startsWith("FORCE:")) {
        // Strip prefix and add to forced list (bypass dedup)
        forcedClaims.push(claim.replace(/^FORCE:\s*/, ""));
      } else {
        regularClaims.push(claim);
      }
    }

    // Post-filter: remove regular claims too similar to already-checked ones
    let filteredRegular = regularClaims;
    if (checkedClaims.length > 0) {
      filteredRegular = regularClaims.filter(claim => {
        const claimLower = normalizeForComparison(claim);
        // Check for obvious duplicates
        const isDuplicate = checkedClaims.some(checked => {
          const checkedLower = normalizeForComparison(checked);
          // Exact or near-exact match
          if (claimLower.includes(checkedLower) || checkedLower.includes(claimLower)) {
            return true;
          }
          // Word overlap check (>50% shared content words = duplicate)
          const claimWords = extractContentWords(claimLower);
          const checkedWords = extractContentWords(checkedLower);
          if (claimWords.size === 0 || checkedWords.size === 0) return false;
          const overlap = [...claimWords].filter(w => checkedWords.has(w)).length;
          const similarity = overlap / Math.min(claimWords.size, checkedWords.size);
          return similarity > 0.5;
        });
        if (isDuplicate) {
          debug.claims.skip(`duplicate: "${claim.slice(0, 40)}..."`);
        }
        return !isDuplicate;
      });
    }

    // Combine forced claims (always included) with filtered regular claims
    claims = [...forcedClaims, ...filteredRegular];

    debug.claims.response(claims);

    return Response.json({ claims });
  } catch (error) {
    debug.claims.skip(`error: ${error}`);
    return Response.json({ claims: [] });
  }
}
