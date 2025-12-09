import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { debug } from "@/lib/debug";
import crypto from "crypto";

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

const systemPrompt = `You are a brutally honest fact-checker. Verify claims against data.

VERDICT SCALE:
- "true" - Factually accurate
- "mostly true" - Accurate, minor details off
- "half true" - Partially accurate, partially wrong
- "mostly false" - More wrong than right
- "false" - Factually wrong
- "unverified" - Cannot find reliable data

CRITICAL RULES:
1. ANSWER THE ACTUAL CLAIM. If data supports it, it's TRUE.
2. NO political balance. You're not an editorial board.
3. If numbers support the claim, it's TRUE. Period.
4. Put caveats in "context", not your verdict.

RESPONSE FORMAT - BE CONCISE:
- whatsTrue: Short bullets (max 15 words each). LEAD WITH NUMBERS/STATS.
- whatsWrong: Short bullets. LEAD WITH NUMBERS/STATS.
- context: Brief additional facts only.

EXAMPLE BULLET FORMAT:
✓ "$44k vs $22k per capita (AIHW 2015-16)"
✓ "Employment: 46.6% vs 59.8% (ABS 2021)"
✗ "Claim says 2x but adjusted ratio is 1.5:1"

Keep each bullet under 15 words. Numbers first, source in parentheses.

CONFIDENCE: 4=solid data, 3=good sources, 2=limited data, 1=unclear

Be direct. No essays. Just facts and numbers.`;

function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

// Sanitize input: strip control characters (except newlines/tabs)
function sanitizeInput(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export async function POST(request: Request) {
  const ip = hashIP(getClientIP(request));

  try {
    const body = await request.json();
    let claim = body.claim || body.prompt;
    const context = body.context || "";

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

    // Sanitize input
    claim = sanitizeInput(claim);

    console.log("[api:fact-check]", { ip, claimLen: claim.length, hasContext: !!context });
    debug.factCheck.start(claim);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    // Build prompt with optional conversation context
    let prompt = `Fact-check this claim. Remember: if the data supports the claim, it's TRUE regardless of how you feel about it.\n\nClaim: "${claim}"`;

    if (context && context.trim()) {
      prompt += `\n\nCONVERSATION CONTEXT (what was said before the claim):\n"${context.slice(-8000)}"`;
    }

    try {
      const result = await generateObject({
        model: xai("grok-3-fast"),
        schema: factCheckSchema,
        system: systemPrompt,
        prompt,
        abortSignal: controller.signal,
      });

      clearTimeout(timeout);
      console.log("[usage:fact-check]", { model: "grok-3-fast", ...result.usage });
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
