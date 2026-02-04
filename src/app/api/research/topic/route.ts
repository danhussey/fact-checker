import { xai } from "@ai-sdk/xai";
import { perplexity } from "@ai-sdk/perplexity";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import crypto from "crypto";
import type { ResearchTopic, ResearchClaim, Evidence } from "@/lib/types";

// Schema for claims extraction
const claimsExtractionSchema = z.object({
  claims: z.array(z.object({
    statement: z.string().describe("The factual claim to verify"),
    category: z.enum(["factual", "statistical", "historical", "scientific"]),
  })).max(6),
});

// Schema for claim verification
const claimVerificationSchema = z.object({
  verdict: z.enum(["true", "mostly true", "half true", "mostly false", "false", "unverified"]),
  confidence: z.number().min(1).max(4),
  evidenceFor: z.array(z.object({
    point: z.string(),
    source: z.string().optional(),
  })).max(3),
  evidenceAgainst: z.array(z.object({
    point: z.string(),
    source: z.string().optional(),
  })).max(3),
  sources: z.array(z.object({
    name: z.string(),
    url: z.string().optional(),
    reliability: z.string().optional(),
  })).max(4),
});

// Simple in-memory lock for rate limiting (1 research job at a time)
let isResearching = false;
let lastResearchStart = 0;
const MAX_RESEARCH_DURATION = 5 * 60 * 1000; // 5 minutes max

function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function sanitizeInput(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export async function POST(request: Request) {
  const ip = hashIP(getClientIP(request));

  // Check for API key auth (simple admin check)
  const authHeader = request.headers.get("authorization");
  const adminKey = process.env.RESEARCH_ADMIN_KEY;

  if (adminKey && authHeader !== `Bearer ${adminKey}`) {
    console.log("[api:research/topic] Unauthorized", { ip });
    return Response.json(
      { error: "Unauthorized. Admin API key required." },
      { status: 401 }
    );
  }

  // Check if another research job is running
  const now = Date.now();
  if (isResearching && now - lastResearchStart < MAX_RESEARCH_DURATION) {
    return Response.json(
      { error: "Another research job is in progress. Please wait." },
      { status: 429 }
    );
  }

  // Reset stale lock
  if (isResearching && now - lastResearchStart >= MAX_RESEARCH_DURATION) {
    isResearching = false;
  }

  try {
    const body = await request.json();
    let title = body.title;
    let context = body.context || "";

    if (!title || typeof title !== "string") {
      return Response.json(
        { error: "Topic title is required" },
        { status: 400 }
      );
    }

    if (title.length > 200) {
      return Response.json(
        { error: "Title too long. Maximum 200 characters." },
        { status: 400 }
      );
    }

    title = sanitizeInput(title);
    context = sanitizeInput(context);

    console.log("[api:research/topic] Starting research", { ip, title });

    isResearching = true;
    lastResearchStart = now;

    try {
      // Step 1: Search for relevant information using Perplexity
      console.log("[api:research/topic] Step 1: Searching for sources");
      const searchResult = await generateText({
        model: perplexity("sonar-pro"),
        prompt: `Research the following topic thoroughly and provide a comprehensive summary with multiple perspectives:

Topic: ${title}
${context ? `Additional context: ${context}` : ""}

Please include:
1. Key facts and statistics from reliable sources
2. Different viewpoints and arguments on this topic
3. Recent developments or news
4. Sources for your information

Be thorough and cite your sources.`,
      });

      const researchContent = searchResult.text;
      console.log("[api:research/topic] Search complete, content length:", researchContent.length);

      // Step 2: Extract verifiable claims using Grok
      console.log("[api:research/topic] Step 2: Extracting claims");
      const claimsResult = await generateObject({
        model: xai("grok-3-fast"),
        schema: claimsExtractionSchema,
        system: `You are an expert at identifying verifiable factual claims. Extract clear, specific claims that can be fact-checked. Focus on:
- Statistical claims with numbers
- Historical facts
- Scientific assertions
- Policy outcomes

Avoid opinions, predictions, or vague statements.`,
        prompt: `From the following research content about "${title}", extract the most important verifiable factual claims:

${researchContent}

Extract up to 6 specific, verifiable claims.`,
      });

      const extractedClaims = claimsResult.object.claims;
      console.log("[api:research/topic] Extracted claims:", extractedClaims.length);

      // Step 3: Verify each claim using Grok with search capability
      console.log("[api:research/topic] Step 3: Verifying claims");
      const verifiedClaims: ResearchClaim[] = [];

      for (const extractedClaim of extractedClaims) {
        try {
          const verifyResult = await generateObject({
            model: xai("grok-3-fast"),
            schema: claimVerificationSchema,
            system: `You are a rigorous fact-checker. Evaluate claims with evidence for and against.

VERDICT SCALE:
- "true" - Factually accurate, well-supported
- "mostly true" - Accurate, minor issues
- "half true" - Partially accurate, partially wrong
- "mostly false" - More wrong than right
- "false" - Factually wrong
- "unverified" - Cannot find reliable data

CONFIDENCE: 4=solid data, 3=good sources, 2=limited data, 1=unclear

Be balanced. Include evidence on BOTH sides when it exists.`,
            prompt: `Verify this claim: "${extractedClaim.statement}"

Context from research:
${researchContent.slice(0, 4000)}

Provide:
1. Your verdict and confidence
2. Evidence supporting the claim
3. Evidence against/contradicting the claim
4. Sources used`,
          });

          verifiedClaims.push({
            statement: extractedClaim.statement,
            verdict: verifyResult.object.verdict,
            confidence: verifyResult.object.confidence as 1 | 2 | 3 | 4,
            evidenceFor: verifyResult.object.evidenceFor as Evidence[],
            evidenceAgainst: verifyResult.object.evidenceAgainst as Evidence[],
            sources: verifyResult.object.sources,
          });

          console.log("[api:research/topic] Verified claim:", extractedClaim.statement.slice(0, 50));
        } catch (claimError) {
          console.error("[api:research/topic] Failed to verify claim:", claimError);
          // Continue with other claims
        }
      }

      // Step 4: Generate summary
      console.log("[api:research/topic] Step 4: Generating summary");
      const summaryResult = await generateText({
        model: xai("grok-3-fast"),
        prompt: `Write a brief 2-3 sentence summary of the topic "${title}" based on the following verified claims:

${verifiedClaims.map(c => `- ${c.statement} (${c.verdict})`).join("\n")}

Be neutral and factual.`,
      });

      // Determine category based on claims
      const category = determineCategory(title, verifiedClaims);

      const topic: ResearchTopic = {
        id: `topic-${crypto.randomUUID().slice(0, 8)}`,
        slug: generateSlug(title),
        title,
        summary: summaryResult.text,
        category,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        claims: verifiedClaims,
      };

      console.log("[api:research/topic] Research complete", {
        ip,
        title,
        claimsCount: verifiedClaims.length,
      });

      return Response.json(topic);
    } finally {
      isResearching = false;
    }
  } catch (error) {
    isResearching = false;
    console.error("[api:research/topic] Error:", error);
    return Response.json(
      { error: "Failed to research topic" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function determineCategory(title: string, claims: ResearchClaim[]): ResearchTopic["category"] {
  const titleLower = title.toLowerCase();

  if (titleLower.includes("politic") || titleLower.includes("election") ||
      titleLower.includes("government") || titleLower.includes("policy") ||
      titleLower.includes("ice") || titleLower.includes("immigration")) {
    return "politics";
  }

  if (titleLower.includes("climate") || titleLower.includes("carbon") ||
      titleLower.includes("tax") || titleLower.includes("econom") ||
      titleLower.includes("inflation") || titleLower.includes("market")) {
    return "economics";
  }

  if (titleLower.includes("health") || titleLower.includes("covid") ||
      titleLower.includes("vaccine") || titleLower.includes("medical") ||
      titleLower.includes("disease")) {
    return "health";
  }

  if (titleLower.includes("science") || titleLower.includes("research") ||
      titleLower.includes("study") || titleLower.includes("data")) {
    return "science";
  }

  return "social";
}
