import { z } from "zod";
import { normalizeSourceUrl } from "./sourceUrls";
import type { StructuredFactCheck } from "./types";

export interface EvidenceSource {
  id: string;
  name: string;
  url: string;
  // The search provider's cited passage, not an independently fetched page extract.
  excerpt: string;
}

export const researchResponseSchema = z.object({
  status: z.string(),
  output: z.array(z.object({
    type: z.string(),
    status: z.string().optional(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      annotations: z.array(z.object({
        type: z.string(),
        url: z.string().optional(),
        title: z.string().optional(),
        start_index: z.number().optional(),
        end_index: z.number().optional(),
      })).optional(),
    })).optional(),
  })),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    num_server_side_tools_used: z.number().optional(),
    cost_in_usd_ticks: z.number().optional(),
  }).optional(),
});
export type ResearchResponse = z.infer<typeof researchResponseSchema>;

const citedPointSchema = z.object({
  text: z.string().min(1).max(400),
  sourceId: z.string().min(1).max(20),
});
export const groundedAssessmentSchema = z.object({
  verdict: z.enum(["true", "mostly true", "half true", "mostly false", "false", "unverified"]),
  confidence: z.number().int().min(1).max(4),
  sourceIds: z.array(z.string().min(1).max(20)).max(3),
  whatsTrue: z.array(citedPointSchema).max(2),
  whatsWrong: z.array(citedPointSchema).max(2),
  context: z.array(citedPointSchema).max(2),
  argument: z.object({
    claim: z.string().max(2000),
    grounds: z.array(citedPointSchema).max(3),
    warrant: z.string().max(500),
    backing: z.string().max(500).nullable(),
    qualifier: z.enum(["certain", "probable", "possible", "uncertain"]),
    rebuttals: z.array(z.string().max(500)).max(2),
  }).nullable(),
});
export type GroundedAssessment = z.infer<typeof groundedAssessmentSchema>;

function withoutLinks(text: string) {
  return text
    .replace(/\[\[\d+\]\]\(https?:\/\/[^)]+\)/g, "")
    .replace(/\[([^\]]*)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\[\[?\d+\]?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeSourceUrl(value: string | undefined) {
  const normalized = normalizeSourceUrl(value);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.username || url.password) return undefined;
  return normalized;
}

/** Metadata-only URLs and URLs invented in free text are not evidence. */
export function collectEvidence(response: ResearchResponse): EvidenceSource[] {
  const sources = new Map<string, EvidenceSource>();
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text" || !content.text) continue;
      const answer = content.text;
      for (const citation of content.annotations ?? []) {
        if (citation.type !== "url_citation") continue;
        const url = safeSourceUrl(citation.url);
        if (!url) continue;
        const passages = answer.split(/\n+/).filter((line) => {
          const links = Array.from(line.matchAll(/\]\((https?:\/\/[^)]+)\)/g));
          return links.some((match) => safeSourceUrl(match[1]) === url);
        });
        if (!passages.length && citation.start_index !== undefined && citation.end_index !== undefined) {
          const { start_index: start, end_index: end } = citation;
          if (start >= 0 && end > start && end <= answer.length) {
            const lineStart = answer.lastIndexOf("\n", start) + 1;
            const nextNewline = answer.indexOf("\n", end);
            passages.push(answer.slice(lineStart, nextNewline < 0 ? answer.length : nextNewline));
          }
        }
        const supportingPassages = passages.filter((passage) => {
          // A bibliography entry may have a long page title but no evidence.
          // Require prose outside link labels before treating it as a passage.
          const prose = withoutLinks(passage.replace(/\[\[?[^\]]*\]?\]\(https?:\/\/[^)]+\)/gi, ""))
            .replace(/\b(?:sources?|references?|see)\b/gi, "");
          return /\p{L}/u.test(prose);
        });
        const excerpt = withoutLinks(supportingPassages.join(" ")).slice(0, 1800);
        if (excerpt.length < 20) continue;
        const existing = sources.get(url);
        if (existing) {
          if (!existing.excerpt.includes(excerpt)) existing.excerpt = `${existing.excerpt} ${excerpt}`.slice(0, 1800);
          continue;
        }
        if (sources.size >= 8) continue;
        const title = withoutLinks(citation.title ?? "").slice(0, 160);
        sources.set(url, {
          id: `S${sources.size + 1}`,
          // xAI often labels annotations "1", "2", ... instead of page titles.
          name: title && !/^\d+$/.test(title) ? title : new URL(url).hostname,
          url,
          excerpt,
        });
      }
    }
  }
  return [...sources.values()];
}

export function insufficientEvidence(): StructuredFactCheck {
  return {
    verdict: "unverified",
    confidence: 1,
    whatsTrue: [],
    whatsWrong: [],
    context: ["The search did not find enough cited evidence to verify this claim."],
    sources: [],
  };
}

export function groundAssessment(assessment: GroundedAssessment, catalog: EvidenceSource[]): StructuredFactCheck {
  const byId = new Map(catalog.map((source) => [source.id, source]));
  const selected = new Set(assessment.sourceIds);
  const points = [...assessment.whatsTrue, ...assessment.whatsWrong, ...assessment.context,
    ...(assessment.argument?.grounds ?? [])];
  // Invalid citations invalidate the conclusion instead of hiding its missing evidence.
  if ([...selected].some((id) => !byId.has(id)) ||
      points.some((point) => !selected.has(point.sourceId) || !byId.has(point.sourceId) ||
        !/\p{L}/u.test(withoutLinks(point.text))) ||
      (!assessment.whatsTrue.length && !assessment.whatsWrong.length)) {
    return insufficientEvidence();
  }
  const usedIds = new Set(points.map((point) => point.sourceId));
  const render = (point: z.infer<typeof citedPointSchema>) =>
    `${withoutLinks(point.text)} (${byId.get(point.sourceId)!.name})`;
  return {
    verdict: assessment.verdict,
    confidence: assessment.verdict === "unverified" ? 1 : assessment.confidence as 1 | 2 | 3 | 4,
    whatsTrue: assessment.whatsTrue.map(render),
    whatsWrong: assessment.whatsWrong.map(render),
    context: assessment.context.map(render),
    sources: [...usedIds].map((id) => ({ name: byId.get(id)!.name, url: byId.get(id)!.url })),
    ...(assessment.argument ? { argument: {
      claim: withoutLinks(assessment.argument.claim),
      grounds: assessment.argument.grounds.map(render),
      warrant: withoutLinks(assessment.argument.warrant),
      ...(assessment.argument.backing ? { backing: withoutLinks(assessment.argument.backing) } : {}),
      qualifier: assessment.argument.qualifier,
      rebuttals: assessment.argument.rebuttals.map(withoutLinks),
    } } : {}),
  };
}
