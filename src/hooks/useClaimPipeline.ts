"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ClaimQueue, PipelineRequestError, retryAfterMs, type ClaimCandidate } from "@/lib/claimQueue";
import { ExtractionScheduler, type ExtractionState } from "@/lib/extractionScheduler";
import type { FactCheck, StructuredFactCheck } from "@/lib/types";
import type { TranscriptSegmentMetadata } from "@/lib/transcriptSegments";
import { addPipelineBreadcrumb, addPipelineLog, claimDiagnosticData, transcriptDiagnosticData } from "@/lib/observability";

const candidateSchema = z.object({
  claim: z.string().trim().min(1),
  relationship: z.enum(["new", "repeat", "revision"]),
  relatedClaimId: z.string().optional(),
  forceCheck: z.boolean().optional(),
});
const extractionResponseSchema = z.object({
  candidates: z.array(candidateSchema).optional(),
  claims: z.array(z.string()).optional(),
  forcedClaims: z.array(z.string()).optional(),
  pendingFragment: z.string().nullable().optional(),
});
const factCheckResponseSchema = z.object({
  verdict: z.enum(["true", "mostly true", "half true", "mostly false", "false", "unverified"]),
  confidence: z.number().int().min(1).max(4),
  whatsTrue: z.array(z.string()), whatsWrong: z.array(z.string()), context: z.array(z.string()),
  sources: z.array(z.object({ name: z.string(), url: z.string().optional() })),
  argument: z.object({
    claim: z.string(), grounds: z.array(z.string()), warrant: z.string(),
    backing: z.string().optional(), qualifier: z.enum(["certain", "probable", "possible", "uncertain"]),
    rebuttals: z.array(z.string()).optional(),
  }).optional(),
});

async function readResponse(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new PipelineRequestError(
      typeof body.error === "string" ? body.error : "Connection problem. Please try again.",
      response.status, retryAfterMs(response), typeof body.retryable === "boolean" ? body.retryable : undefined,
    );
  }
  return response.json();
}

export function useClaimPipeline(options: { diagnosticSessionId: string; includeTranscriptDiagnostics: boolean }) {
  const [factChecks, setFactChecks] = useState<FactCheck[]>([]);
  const [extractionState, setExtractionState] = useState<ExtractionState>({ status: "idle", pendingChars: 0 });
  const optionsRef = useRef(options);
  const queueRef = useRef<ClaimQueue | null>(null);
  const schedulerRef = useRef<ExtractionScheduler | null>(null);
  const historyRef = useRef<{ text: string; timestamp: number }[]>([]);

  useEffect(() => { optionsRef.current = options; }, [options]);

  useEffect(() => {
    const log = (event: string, data: Record<string, unknown>) => {
      addPipelineBreadcrumb(event, Object.fromEntries(Object.entries(data).filter(([, value]) =>
        value == null || ["string", "number", "boolean"].includes(typeof value)
      )) as Record<string, string | number | boolean | null | undefined>);
      addPipelineLog(`client.${event}`, { diagnosticSessionId: optionsRef.current.diagnosticSessionId, ...data });
    };
    const queue = new ClaimQueue({
      onChange: setFactChecks,
      log,
      verify: async (claim, context, signal, metadata) => {
        const current = optionsRef.current;
        log("fact_check.request", { ...metadata, ...claimDiagnosticData(claim, current.includeTranscriptDiagnostics) });
        const response = await fetch("/api/fact-check", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ claim, context, ...metadata, requestId: crypto.randomUUID(), ...current }),
        });
        return factCheckResponseSchema.parse(await readResponse(response)) as StructuredFactCheck;
      },
    });
    const scheduler = new ExtractionScheduler({
      onState: setExtractionState,
      log,
      extract: async (batch, signal) => {
        const current = optionsRef.current;
        log("claim_extraction.request", {
          batchId: batch.id, sequence: batch.sequence,
          ...transcriptDiagnosticData(batch.newText, current.includeTranscriptDiagnostics),
        });
        const response = await fetch("/api/extract-claims", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ ...batch, requestId: batch.id, knownClaims: queue.knownClaims(), ...current }),
        });
        const result = extractionResponseSchema.parse(await readResponse(response));
        if (signal.aborted) return;
        const forced = new Set(result.forcedClaims ?? []);
        const candidates: ClaimCandidate[] = result.candidates ?? (result.claims ?? []).map(claim => ({
          claim, relationship: "new", forceCheck: forced.has(claim),
        }));
        const context = `${batch.recentContext} ${batch.newText}`.trim().slice(-5000);
        for (const candidate of candidates) queue.submit(candidate, {
          context, sequence: batch.newestReceivedAt, speechEndAt: batch.speechEndAt,
          urgent: batch.hasDispute || candidate.relationship === "revision",
          forceCheck: candidate.forceCheck,
        });
        log("claim_extraction.completed", { batchId: batch.id, candidateCount: candidates.length });
        return { pendingFragment: result.pendingFragment ?? undefined };
      },
    });
    queueRef.current = queue;
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose(); queue.dispose();
      schedulerRef.current = null; queueRef.current = null;
    };
  }, []);

  const handleTranscript = useCallback((text: string, metadata?: TranscriptSegmentMetadata) => {
    const now = Date.now();
    historyRef.current = [...historyRef.current.filter(chunk => now - chunk.timestamp < 300_000), { text, timestamp: now }];
    schedulerRef.current?.push({ text, receivedAt: metadata?.receivedAt ?? now,
      speechEndAt: metadata?.speechEndAt, segmentId: metadata?.segmentId });
  }, []);

  const submitClaim = useCallback((claim: string) => {
    queueRef.current?.submit({ claim, relationship: "new", forceCheck: true }, {
      context: historyRef.current.map(chunk => chunk.text).join(" ").slice(-4000),
      sequence: Date.now(), urgent: true, forceCheck: true,
    });
  }, []);

  const retryClaim = useCallback((id: string) => queueRef.current?.retry(id), []);
  const retryExtraction = useCallback(() => schedulerRef.current?.retry(), []);
  const flush = useCallback(() => schedulerRef.current?.flush(), []);
  const diagnostics = useCallback(() => ({
    history: historyRef.current.slice(-80),
    pending: schedulerRef.current?.snapshot(),
    queue: queueRef.current?.snapshot(),
  }), []);

  return { factChecks, extractionState, handleTranscript, submitClaim, retryClaim, retryExtraction, flush, diagnostics };
}
