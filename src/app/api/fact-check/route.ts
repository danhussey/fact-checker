import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { debug } from "@/lib/debug";

const factCheckSchema = z.object({
  verdict: z.enum(["true", "mostly true", "half true", "mostly false", "false", "unverified"]),
  confidence: z.number().min(1).max(4),
  whatsTrue: z.array(z.string()).max(2),
  whatsWrong: z.array(z.string()).max(2),
  context: z.array(z.string()).max(2),
  sources: z.array(z.object({
    name: z.string(),
    url: z.string().optional(),
  })).max(3),
});

const systemPrompt = `You are a brutally honest fact-checker. Your job is to verify claims against data.

VERDICT SCALE (pick the most accurate):
- "true" - The claim is factually accurate
- "mostly true" - Accurate but minor details off
- "half true" - Partially accurate, partially wrong
- "mostly false" - More wrong than right
- "false" - The claim is factually wrong
- "unverified" - Cannot find reliable data

CRITICAL RULES:
1. ANSWER THE ACTUAL CLAIM. If someone claims "X is lower than Y" and data shows X IS lower than Y, that's TRUE - even if you think the framing is unfair.
2. DO NOT add political balance. You are not an editorial board.
3. DO NOT mark something "misleading" because you disagree with the implications. Verify the FACTUAL claim.
4. If the numbers support the claim, it's TRUE. Period.
5. Put caveats in "context", not in your verdict.

EXAMPLE:
Claim: "Group A earns less than Group B on average"
Data shows: Group A median income $40k, Group B median income $70k
Verdict: TRUE (because the claim IS factually accurate)
Context: Can include reasons WHY (education, age, location, etc.)

DO NOT mark this "misleading" just because you want to add context. The claim itself is either true or false.

FORMAT:
- whatsTrue: Evidence supporting the claim
- whatsWrong: Evidence contradicting the claim (empty if claim is true)
- context: Additional relevant facts (NOT a place to hedge your verdict)

CONFIDENCE: 4=solid data, 3=good sources, 2=limited data, 1=unclear

Be direct. No hedging. No political correctness. Just facts.`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const claim = body.claim || body.prompt;

    if (!claim || typeof claim !== "string") {
      return Response.json(
        { error: "No claim provided" },
        { status: 400 }
      );
    }

    if (claim.length > 2000) {
      return Response.json(
        { error: "Claim too long. Maximum 2000 characters." },
        { status: 400 }
      );
    }

    debug.factCheck.start(claim);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const result = await generateObject({
        model: xai("grok-3-fast"),
        schema: factCheckSchema,
        system: systemPrompt,
        prompt: `Fact-check this claim. Remember: if the data supports the claim, it's TRUE regardless of how you feel about it.\n\nClaim: "${claim}"`,
        abortSignal: controller.signal,
      });

      clearTimeout(timeout);
      debug.factCheck.done(claim, result.object);

      return Response.json(result.object);
    } catch (abortError) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        debug.factCheck.error(claim, "Request timed out after 45s");
        return Response.json(
          {
            verdict: "unverified",
            confidence: 1,
            whatsTrue: [],
            whatsWrong: [],
            context: ["Request timed out - try again"],
            sources: [],
          }
        );
      }
      throw abortError;
    }
  } catch (error) {
    debug.factCheck.error("unknown", error);

    return Response.json(
      { error: "Failed to process fact-check request" },
      { status: 500 }
    );
  }
}
