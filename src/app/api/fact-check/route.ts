import { createPerplexity } from "@ai-sdk/perplexity";
import { generateObject } from "ai";
import { z } from "zod";

const perplexity = createPerplexity({
  apiKey: process.env.PERPLEXITY_API_KEY,
});

const factCheckSchema = z.object({
  verdict: z.enum(["true", "misleading", "unverified", "false", "contested", "opinion"]),
  confidence: z.number().min(1).max(4),
  whatsTrue: z.array(z.string()).max(3),
  whatsMisleading: z.array(z.string()).max(3),
  missingContext: z.array(z.string()).max(3),
  sources: z.array(z.object({
    name: z.string(),
    url: z.string().optional(),
  })).max(4),
});

const systemPrompt = `You are a fact-checker. Analyze claims and return a structured assessment.

VERDICT OPTIONS (choose one):
- "true" - The claim is accurate as stated
- "misleading" - Contains some truth but misrepresents or oversimplifies
- "unverified" - Cannot find reliable sources to verify
- "false" - Directly contradicted by evidence
- "contested" - Experts genuinely disagree on this topic
- "opinion" - This is a subjective opinion, not a factual claim

CONFIDENCE (1-4):
- 4 = Very high confidence, multiple reliable sources agree
- 3 = High confidence, good evidence available
- 2 = Moderate confidence, limited or mixed evidence
- 1 = Low confidence, difficult to verify

RULES:
- Keep each bullet point SHORT (under 15 words)
- Maximum 3 bullet points per section
- Only include sections that are relevant (empty arrays are fine)
- Source names should be short (e.g., "FBI", "CDC", "Reuters")
- Be direct and concise - this is for quick reference during debates`;

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

    const result = await generateObject({
      model: perplexity("sonar-pro"),
      schema: factCheckSchema,
      system: systemPrompt,
      prompt: `Fact-check this claim: "${claim}"`,
    });

    return Response.json(result.object);
  } catch (error) {
    console.error("Fact-check error:", error);

    return Response.json(
      { error: "Failed to process fact-check request" },
      { status: 500 }
    );
  }
}
