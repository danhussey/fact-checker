import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { debug } from "@/lib/debug";

const claimsSchema = z.object({
  claims: z.array(z.string()).describe("Array of fact-checkable claims. Empty if none found."),
});

function buildSystemPrompt(checkedClaims: string[]): string {
  const checkedSection = checkedClaims.length > 0
    ? `\nALREADY CHECKED - skip these and similar:\n${checkedClaims.map(c => `- "${c}"`).join("\n")}\n`
    : "";

  return `Extract fact-checkable claims from transcripts.

EXTRACT:
- Statistics and numbers
- Comparisons with specifics
- Policy/government claims
- Historical claims

DO NOT extract:
- Opinions ("I think", "we should")
- Predictions
- Vague statements
${checkedSection}
CRITICAL RULES:
1. Make each claim COMPLETE and SELF-CONTAINED
2. Use context to fill in missing subjects/objects
3. If text says "they get twice as much" - figure out WHO from context and include it
4. BAD: "twice as much as white Australians" (who gets twice?)
5. GOOD: "Indigenous Australians receive twice as much funding as white Australians per capita"

Preserve ALL numbers. Return 0-2 complete claims.`;
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

    const claims = result.object.claims.filter(
      (c) => typeof c === "string" && c.trim().length > 10
    );

    debug.claims.response(claims);

    return Response.json({ claims });
  } catch (error) {
    debug.claims.skip(`error: ${error}`);
    return Response.json({ claims: [] });
  }
}
