import { createPerplexity } from "@ai-sdk/perplexity";
import { generateObject } from "ai";
import { z } from "zod";
import { debug } from "@/lib/debug";

const perplexity = createPerplexity({
  apiKey: process.env.PERPLEXITY_API_KEY,
});

const factCheckSchema = z.object({
  verdict: z.enum(["true", "misleading", "unverified", "false", "contested", "opinion"]),
  confidence: z.number().min(1).max(4),
  whatsTrue: z.array(z.string()).max(2),
  whatsMisleading: z.array(z.string()).max(2),
  missingContext: z.array(z.string()).max(2),
  sources: z.array(z.object({
    name: z.string(),
    url: z.string().optional(),
  })).max(3),
});

const systemPrompt = `You fact-check claims using web search. Report what the data says.

VERDICT:
- "true" - Data supports the claim
- "false" - Data contradicts the claim
- "misleading" - Numbers are wrong or misrepresented
- "unverified" - Cannot find reliable data on this
- "contested" - Studies show conflicting results
- "opinion" - This is subjective, not factual

CONFIDENCE: 4=multiple sources agree, 3=good sources, 2=limited data, 1=weak/unclear

YOUR JOB:
1. Find the ACTUAL NUMBERS from real sources
2. Compare them to the claimed numbers
3. Report what the data shows - don't editorialize or "balance"
4. If the claim says "5x" and data shows "2x", say that directly

FORMAT:
- whatsTrue: Facts that support the claim (with numbers)
- whatsMisleading: Where the numbers are wrong (show correct numbers)
- missingContext: Key facts that change interpretation

Be direct. State the numbers. Don't hedge or add unnecessary balance.
If a claim is wrong, say it's wrong and give the correct figure.
Sources must have real URLs.`;

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

    const result = await generateObject({
      model: perplexity("sonar-pro"),
      schema: factCheckSchema,
      system: systemPrompt,
      prompt: `Fact-check this claim: "${claim}"`,
    });

    debug.factCheck.done(claim, result.object.verdict);

    return Response.json(result.object);
  } catch (error) {
    debug.factCheck.error("unknown", error);

    return Response.json(
      { error: "Failed to process fact-check request" },
      { status: 500 }
    );
  }
}
