import crypto from "crypto";
import { z } from "zod";
import { debug } from "@/lib/debug";
import { DEFAULT_FACT_CHECK_MODEL, runGroundedFactCheck } from "@/lib/groundedFactCheck";
import { FactCheckServiceError } from "@/lib/researchDeadline";
import {
  addPipelineBreadcrumb,
  addPipelineLog,
  capturePipelineError,
  claimDiagnosticData,
  transcriptDiagnosticsEnabled,
} from "@/lib/observability";

export const maxDuration = 60;

const inputSchema = z.object({
  claim: z.string().max(2000).optional(),
  prompt: z.string().max(2000).optional(),
  context: z.string().max(32000).optional(),
  includeTranscriptDiagnostics: z.boolean().optional(),
  diagnosticSessionId: z.string().max(120).optional(),
  requestId: z.string().max(120).optional(),
  claimId: z.string().max(120).optional(),
  revision: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let claim = "";
  let diagnosticSessionId: string | undefined;
  let claimId: string | undefined;
  let clientRequestId: string | undefined;
  let revision: number | undefined;
  let includeTranscriptDiagnostics = false;
  const trace = () => ({ requestId, clientRequestId, diagnosticSessionId, claimId, revision, route: "/api/fact-check" });
  const respond = (body: unknown, status = 200, retryAfter?: string) => Response.json(body, {
    status,
    headers: { "X-Request-Id": requestId, "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": retryAfter } : {}) },
  });

  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return respond({ error: "Invalid JSON request", retryable: false }, 400);
    }
    const parsed = inputSchema.safeParse(rawBody);
    if (!parsed.success) return respond({ error: "Invalid fact-check input", retryable: false }, 400);
    const body = parsed.data;
    claim = (body.claim || body.prompt || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (!claim) return respond({ error: "No claim provided", retryable: false }, 400);

    diagnosticSessionId = body.diagnosticSessionId;
    claimId = body.claimId;
    revision = body.revision;
    clientRequestId = body.requestId;
    includeTranscriptDiagnostics = transcriptDiagnosticsEnabled && body.includeTranscriptDiagnostics !== false;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    const model = process.env.XAI_FACT_CHECK_MODEL || DEFAULT_FACT_CHECK_MODEL;
    console.log("[api:fact-check]", { ...trace(), ip: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12), claimLen: claim.length, model });
    addPipelineBreadcrumb("api.fact_check.start", { ...trace(), ...claimDiagnosticData(claim, includeTranscriptDiagnostics), model });
    if (includeTranscriptDiagnostics) debug.factCheck.start(claim);

    const result = await runGroundedFactCheck({
      claim,
      signal: request.signal,
      model,
      onStage: (stage) => {
        console.log("[api:fact-check:stage]", { ...trace(), model, ...stage });
        addPipelineLog(`api.fact_check.${stage.stage}`, { ...trace(), model, ...stage });
      },
    });
    const completed = { ...trace(), model, durationMs: Date.now() - startedAt, verdict: result.verdict,
      confidence: result.confidence, sourceCount: result.sources.length,
      whatsTrueCount: result.whatsTrue.length, whatsWrongCount: result.whatsWrong.length };
    addPipelineBreadcrumb("api.fact_check.done", completed);
    addPipelineLog("api.fact_check.completed", completed);
    if (includeTranscriptDiagnostics) debug.factCheck.done(claim, result);
    return respond(result);
  } catch (error) {
    const serviceError = error instanceof FactCheckServiceError ? error : undefined;
    const cancelled = serviceError?.code === "cancelled" || request.signal.aborted;
    const status = cancelled ? 499 : serviceError?.code === "timeout" ? 504 : serviceError?.providerStatus === 429 ? 429 : 503;
    const providerStatus = serviceError?.providerStatus;
    const retryable = !cancelled && serviceError?.code !== "not_configured" &&
      (providerStatus === undefined || providerStatus === 408 || providerStatus === 429 || providerStatus >= 500);
    const code = cancelled ? "cancelled" : serviceError?.code || "unavailable";
    const details = { ...trace(), code, durationMs: Date.now() - startedAt, providerStatus: serviceError?.providerStatus };
    addPipelineLog(`api.fact_check.${code}`, details, cancelled ? "info" : "warn");
    if (!cancelled) {
      capturePipelineError(error, { ...details, ...claimDiagnosticData(claim, includeTranscriptDiagnostics) });
      debug.factCheck.error(includeTranscriptDiagnostics ? claim : "", error);
    }
    return respond({
      error: cancelled ? "Fact-check cancelled" : code === "timeout" ? "Fact-check timed out. Please retry." :
        code === "not_configured" ? "Live research is not configured." : "Research temporarily unavailable. Please retry.",
      code,
      retryable,
    }, status, retryable ? serviceError?.retryAfter ?? "2" : undefined);
  }
}
