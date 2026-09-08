import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { debug } from "@/lib/debug";
import {
  buildExtractionPrompt,
  createExtractionHandler,
  extractionSchema,
  EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/claimExtraction";
import {
  addPipelineBreadcrumb,
  addPipelineLog,
  capturePipelineError,
  limitDiagnosticText,
  textStats,
  transcriptDiagnosticData,
  transcriptDiagnosticsEnabled,
} from "@/lib/observability";

const model = process.env.XAI_EXTRACTION_MODEL || "grok-4.3";
// This installed SDK predates grok-4.3's non-reasoning mode and rejects "none"
// as a provider option. Set the documented API field at the transport boundary
// for this model; keep the SDK's structured-output validation and cancellation.
const extractionProvider = createXai({
  fetch: (input, init) => {
    if (model === "grok-4.3" && typeof init?.body === "string") {
      const body = JSON.parse(init.body);
      return fetch(input, { ...init, body: JSON.stringify({ ...body, reasoning_effort: "none" }) });
    }
    return fetch(input, init);
  },
});

export const POST = createExtractionHandler({
  async extract(input, signal) {
    const result = await generateObject({
      model: extractionProvider(model),
      schema: extractionSchema,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: buildExtractionPrompt(input),
      maxRetries: 0,
      maxOutputTokens: 2400,
      abortSignal: signal,
    });
    console.log("[usage:extract-claims]", { model, requestId: input.requestId, sequence: input.sequence, ...result.usage });
    return {
      pendingFragment: result.object.pendingFragment,
      candidates: result.object.candidates.map((candidate) => ({
        claim: candidate.claim,
        relationship: candidate.relationship,
        ...(candidate.relatedClaimId ? { relatedClaimId: candidate.relatedClaimId } : {}),
        ...(candidate.forceCheck ? { forceCheck: true } : {}),
      })),
    };
  },
  onStart(input) {
    const includeText = transcriptDiagnosticsEnabled && input.includeTranscriptDiagnostics !== false;
    addPipelineBreadcrumb("api.extract.start", {
      ...transcriptDiagnosticData(input.newText, includeText),
      contextLen: input.recentContext.length,
      knownClaimCount: input.knownClaims.length,
      diagnosticSessionId: input.diagnosticSessionId,
      requestId: input.requestId,
      sequence: input.sequence,
    });
    debug.claims.request(input.newText, input.recentContext, input.knownClaims.map((item) => item.claim));
  },
  onComplete(input, candidates, durationMs) {
    const includeText = transcriptDiagnosticsEnabled && input.includeTranscriptDiagnostics !== false;
    const claims = candidates.map((candidate) => candidate.claim);
    const log = {
      diagnosticSessionId: input.diagnosticSessionId,
      requestId: input.requestId,
      sequence: input.sequence,
      route: "/api/extract-claims", model, durationMs,
      inputTextLen: input.newText.length,
      inputWordCount: textStats(input.newText).wordCount,
      contextLen: input.recentContext.length,
      knownClaimCount: input.knownClaims.length,
      candidateCount: candidates.length,
      repeatCount: candidates.filter((candidate) => candidate.relationship === "repeat").length,
      revisionCount: candidates.filter((candidate) => candidate.relationship === "revision").length,
      forcedClaimCount: candidates.filter((candidate) => candidate.forceCheck).length,
      claims: includeText ? limitDiagnosticText(claims.join(" | "), 2000) : undefined,
    };
    addPipelineBreadcrumb("api.extract.done", log);
    addPipelineLog("api.claim_extraction.completed", log);
    debug.claims.response(claims);
  },
  onError(error, input, durationMs) {
    const details = {
      route: "/api/extract-claims", requestId: input.requestId, sequence: input.sequence,
      diagnosticSessionId: input.diagnosticSessionId, durationMs,
    };
    capturePipelineError(error, details);
    addPipelineLog("api.claim_extraction.failed", details, "warn");
    debug.claims.skip("extraction failed; caller may retry this batch");
  },
});
