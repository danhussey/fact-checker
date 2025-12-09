import { createPerplexity } from "@ai-sdk/perplexity";
import { generateText } from "ai";

const perplexity = createPerplexity({
  apiKey: process.env.PERPLEXITY_API_KEY,
});

const systemPrompt = `You are a claim extractor. Given a transcript of speech, identify any factual claims that could be fact-checked.

A fact-checkable claim is:
- A statement presented as fact (not opinion)
- Something that can be verified with evidence
- Specific enough to research

NOT fact-checkable:
- Pure opinions ("I think pizza is the best food")
- Questions
- Vague statements
- Personal experiences ("I went to the store yesterday")

For each claim found, extract it as a clear, standalone statement.

Respond with a JSON array of claims. If no fact-checkable claims are found, return an empty array.

Example input: "The Earth is flat and NASA has been lying to us. I really hate how cold it is today."
Example output: ["The Earth is flat", "NASA has been lying about the shape of Earth"]

Example input: "How are you doing today? I think it might rain."
Example output: []

IMPORTANT: Only return the JSON array, nothing else. No markdown, no explanation.`;

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return Response.json({ claims: [] });
    }

    // Skip very short text
    if (text.trim().length < 10) {
      return Response.json({ claims: [] });
    }

    const result = await generateText({
      model: perplexity("sonar"),
      system: systemPrompt,
      prompt: `Extract fact-checkable claims from this transcript:\n\n"${text}"`,
    });

    try {
      // Try to parse the response as JSON
      let claims: string[] = [];
      const responseText = result.text.trim();

      // Handle potential markdown code blocks
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        claims = JSON.parse(jsonMatch[0]);
      }

      // Filter out empty or too-short claims
      claims = claims.filter((c) => typeof c === "string" && c.trim().length > 10);

      return Response.json({ claims });
    } catch {
      // If parsing fails, return empty array
      return Response.json({ claims: [] });
    }
  } catch (error) {
    console.error("Claim extraction error:", error);
    return Response.json({ claims: [] });
  }
}
