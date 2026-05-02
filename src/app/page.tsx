"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useContinuousListener } from "@/hooks/useContinuousListener";
import { FactCheckCard } from "@/components/FactCheckCard";
import { TopicChip } from "@/components/TopicChip";
import type { FactCheck, StructuredFactCheck, TopicListing } from "@/lib/types";
import { getTopicListings } from "@/lib/research/loader";
import {
  claimSimilarityScore,
  getExtractionDelayMs,
  isDisputeCue,
  isExplicitVerifyCue,
  normalizeClaim,
} from "@/lib/claimProcessing";
import {
  addPipelineBreadcrumb,
  capturePipelineError,
  claimDiagnosticData,
  limitDiagnosticText,
  sendSessionDiagnosticsFeedback,
  textStats,
  transcriptDiagnosticData,
  transcriptDiagnosticsEnabled,
} from "@/lib/observability";
import { USAGE_LIMITS } from "@/lib/types";

interface TranscriptChunk {
  text: string;
  timestamp: number;
}

const CONTEXT_WINDOW_MS = 300000; // 5 minutes of context
const CLAIM_TTL_MS = 5 * 60 * 1000;
const CLAIM_SIMILARITY_THRESHOLD = 0.78;
const CLAIM_DUPLICATE_THRESHOLD = 0.92;
const MIN_EXTRACT_TEXT_CHARS = 8;
const ARGUMENT_STORAGE_KEY = "fact-checker:show-argument-breakdown";
const TEXT_INPUT_STORAGE_KEY = "fact-checker:show-text-input";

type ClaimStatus = "queued" | "checking" | "done";

interface ClaimRecord {
  id: string;
  claim: string;
  normalized: string;
  revision: number;
  status: ClaimStatus;
  lastUpdatedAt: number;
  lastCheckedAt?: number;
  inFlightRevision?: number;
}

interface QueuedClaim {
  id: string;
  claim: string;
  context: string;
  revision: number;
  urgent: boolean;
}

interface ExtractIntent {
  hasDispute: boolean;
  hasExplicitVerify: boolean;
}

type FeedbackStatus = "idle" | "sending" | "sent" | "error";

const isDev = process.env.NODE_ENV === "development";
const enableTextInputEnv = process.env.NEXT_PUBLIC_ENABLE_TEXT_INPUT === "true";
const showResearchTopicsEnv = process.env.NEXT_PUBLIC_SHOW_RESEARCH_TOPICS;

function createDiagnosticSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function Home() {
  const [factChecks, setFactChecks] = useState<FactCheck[]>([]);
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showArgumentBreakdown, setShowArgumentBreakdown] = useState(false);
  const [showTextInput, setShowTextInput] = useState(enableTextInputEnv);
  const [topics, setTopics] = useState<TopicListing[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const factCheckQueueRef = useRef<QueuedClaim[]>([]);
  const claimByIdRef = useRef<Map<string, ClaimRecord>>(new Map());
  const claimIndexRef = useRef<Map<string, string>>(new Map());
  const latestClaimIdRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const transcriptHistoryRef = useRef<TranscriptChunk[]>([]);
  const pendingTextRef = useRef<string>("");
  const extractTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingIntentRef = useRef<ExtractIntent>({
    hasDispute: false,
    hasExplicitVerify: false,
  });
  const diagnosticSessionIdRef = useRef(createDiagnosticSessionId());
  const diagnosticSessionStartedAtRef = useRef(new Date().toISOString());

  const resizeTextArea = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    const maxHeight = 160;
    el.style.height = "0px";
    const scrollHeight = el.scrollHeight;
    const nextHeight = Math.min(scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    // Load topic listings
    setTopics(getTopicListings());
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ARGUMENT_STORAGE_KEY);
      if (stored !== null) {
        setShowArgumentBreakdown(stored === "true");
      }
    } catch (error) {
      console.warn("Failed to read argument preference.", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        ARGUMENT_STORAGE_KEY,
        showArgumentBreakdown ? "true" : "false"
      );
    } catch (error) {
      console.warn("Failed to save argument preference.", error);
    }
  }, [showArgumentBreakdown]);

  useEffect(() => {
    if (!showTextInput) return;
    resizeTextArea();
  }, [showTextInput, textInput, resizeTextArea]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TEXT_INPUT_STORAGE_KEY);
      if (stored !== null) {
        setShowTextInput(stored === "true");
      }
    } catch (error) {
      console.warn("Failed to read text input preference.", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        TEXT_INPUT_STORAGE_KEY,
        showTextInput ? "true" : "false"
      );
    } catch (error) {
      console.warn("Failed to save text input preference.", error);
    }
  }, [showTextInput]);

  const upsertFactCheckLoading = useCallback((id: string, claim: string) => {
    setFactChecks((prev) => {
      const existingIndex = prev.findIndex((fc) => fc.id === id);
      const entry: FactCheck = {
        id,
        claim,
        result: null,
        isLoading: true,
        timestamp: new Date(),
      };

      if (existingIndex === -1) {
        return [entry, ...prev];
      }

      const existing = prev[existingIndex];
      const updated: FactCheck = {
        ...existing,
        claim,
        result: null,
        isLoading: true,
        error: undefined,
        timestamp: entry.timestamp,
      };

      const next = [...prev];
      next.splice(existingIndex, 1);
      return [updated, ...next];
    });
  }, []);

  const setFactCheckResult = useCallback((id: string, result: StructuredFactCheck) => {
    setFactChecks((prev) =>
      prev.map((fc) =>
        fc.id === id ? { ...fc, result, isLoading: false, error: undefined } : fc
      )
    );
  }, []);

  const setFactCheckError = useCallback((id: string, message: string) => {
    setFactChecks((prev) =>
      prev.map((fc) =>
        fc.id === id ? { ...fc, error: message, isLoading: false } : fc
      )
    );
  }, []);

  const enqueueClaim = useCallback((item: QueuedClaim) => {
    const queue = factCheckQueueRef.current;
    const existingIndex = queue.findIndex((queued) => queued.id === item.id);
    if (existingIndex >= 0) {
      queue.splice(existingIndex, 1);
    }

    if (item.urgent) {
      queue.unshift(item);
    } else {
      queue.push(item);
    }
  }, []);

  const findSimilarRecord = useCallback((claim: string) => {
    let best: { record: ClaimRecord; score: number } | null = null;
    for (const record of claimByIdRef.current.values()) {
      const score = claimSimilarityScore(claim, record.claim);
      if (score >= CLAIM_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { record, score };
      }
    }
    return best;
  }, []);

  const queueClaimCheck = useCallback(
    (claim: string, options: { context: string; urgent?: boolean; forceCheck?: boolean }) => {
      const { context, urgent = false, forceCheck = false } = options;
      const normalized = normalizeClaim(claim);
      const now = Date.now();

      const exactId = claimIndexRef.current.get(normalized);
      let matchedRecord: ClaimRecord | undefined;
      let matchScore = 0;

      if (exactId) {
        matchedRecord = claimByIdRef.current.get(exactId);
        matchScore = 1;
      }

      if (!matchedRecord) {
        const similar = findSimilarRecord(claim);
        if (similar) {
          matchedRecord = similar.record;
          matchScore = similar.score;
        }
      }

      if (matchedRecord) {
        latestClaimIdRef.current = matchedRecord.id;

        const isSameText = matchedRecord.claim.trim() === claim.trim();
        const isRecentDone = matchedRecord.status === "done"
          && matchedRecord.lastCheckedAt
          && now - matchedRecord.lastCheckedAt < CLAIM_TTL_MS;

        if (isRecentDone && !forceCheck && !urgent && matchScore >= CLAIM_DUPLICATE_THRESHOLD) {
          addPipelineBreadcrumb("claim.skip_recent_duplicate", {
            ...claimDiagnosticData(claim),
            matchScore,
            recordStatus: matchedRecord.status,
          });
          return;
        }

        if (matchedRecord.status !== "done" && isSameText && !forceCheck && !urgent) {
          addPipelineBreadcrumb("claim.skip_existing_inflight", {
            ...claimDiagnosticData(claim),
            recordStatus: matchedRecord.status,
          });
          return;
        }

        if (!isSameText || forceCheck || urgent || matchedRecord.status === "done") {
          matchedRecord.revision += 1;
        }

        matchedRecord.claim = claim;
        matchedRecord.lastUpdatedAt = now;

        if (normalized !== matchedRecord.normalized) {
          claimIndexRef.current.delete(matchedRecord.normalized);
          matchedRecord.normalized = normalized;
          claimIndexRef.current.set(normalized, matchedRecord.id);
        }

        matchedRecord.status = "queued";
        addPipelineBreadcrumb("claim.requeued", {
          ...claimDiagnosticData(claim),
          urgent,
          forceCheck,
          matchScore,
          revision: matchedRecord.revision,
        });
        upsertFactCheckLoading(matchedRecord.id, claim);
        enqueueClaim({
          id: matchedRecord.id,
          claim,
          context,
          revision: matchedRecord.revision,
          urgent,
        });
        return;
      }

      const id = crypto.randomUUID();
      const record: ClaimRecord = {
        id,
        claim,
        normalized,
        revision: 1,
        status: "queued",
        lastUpdatedAt: now,
      };

      claimByIdRef.current.set(id, record);
      claimIndexRef.current.set(normalized, id);
      latestClaimIdRef.current = id;
      addPipelineBreadcrumb("claim.queued", {
        ...claimDiagnosticData(claim),
        urgent,
        forceCheck,
      });
      upsertFactCheckLoading(id, claim);
      enqueueClaim({ id, claim, context, revision: 1, urgent });
    },
    [enqueueClaim, findSimilarRecord, upsertFactCheckLoading]
  );

  const processFactCheck = useCallback(async (item: QueuedClaim) => {
    const record = claimByIdRef.current.get(item.id);
    if (!record || record.revision !== item.revision) {
      return;
    }

    record.status = "checking";
    record.inFlightRevision = item.revision;
    addPipelineBreadcrumb("fact_check.start", {
      ...claimDiagnosticData(item.claim),
      revision: item.revision,
      contextLen: item.context.length,
    });

    try {
      const response = await fetch("/api/fact-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: item.claim, context: item.context }),
      });

      if (!response.ok) {
        addPipelineBreadcrumb("fact_check.http_error", {
          status: response.status,
        }, "error");
        throw new Error("Fact-check failed");
      }

      const result: StructuredFactCheck = await response.json();
      const current = claimByIdRef.current.get(item.id);
      if (!current || current.revision !== item.revision) {
        return;
      }

      current.status = "done";
      current.lastCheckedAt = Date.now();
      current.inFlightRevision = undefined;
      addPipelineBreadcrumb("fact_check.done", {
        verdict: result.verdict,
        confidence: result.confidence,
        whatsTrueCount: result.whatsTrue.length,
        whatsWrongCount: result.whatsWrong.length,
        contextCount: result.context.length,
        sourceCount: result.sources.length,
      });
      setFactCheckResult(item.id, result);
    } catch (error) {
      console.error("Fact-check error:", error);
      capturePipelineError(error, {
        stage: "client-fact-check",
        revision: item.revision,
        ...claimDiagnosticData(item.claim),
      });
      const current = claimByIdRef.current.get(item.id);
      if (!current || current.revision !== item.revision) {
        return;
      }

      current.status = "done";
      current.inFlightRevision = undefined;
      setFactCheckError(item.id, "Failed to fact-check this claim.");
    }
  }, [setFactCheckError, setFactCheckResult]);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || factCheckQueueRef.current.length === 0) return;

    isProcessingRef.current = true;
    const next = factCheckQueueRef.current.shift();
    if (next) {
      await processFactCheck(next);
    }
    isProcessingRef.current = false;

    if (factCheckQueueRef.current.length > 0) {
      processQueue();
    }
  }, [processFactCheck]);

  const getRecentContext = useCallback(() => {
    const now = Date.now();
    const recentChunks = transcriptHistoryRef.current.filter(
      chunk => now - chunk.timestamp < CONTEXT_WINDOW_MS
    );
    return recentChunks.map(c => c.text).join(" ");
  }, []);

  const getCheckedClaims = useCallback(() => {
    const now = Date.now();
    const checked = new Set<string>();

    claimByIdRef.current.forEach((record) => {
      if (record.status === "checking" || record.status === "queued") {
        checked.add(record.claim);
        return;
      }
      if (record.status === "done" && record.lastCheckedAt && now - record.lastCheckedAt < CLAIM_TTL_MS) {
        checked.add(record.claim);
      }
    });

    return [...checked];
  }, []);

  const doExtractClaims = useCallback(async (textToProcess: string, intent: ExtractIntent) => {
    const trimmed = textToProcess.trim();
    if (trimmed.length < MIN_EXTRACT_TEXT_CHARS && !intent.hasDispute && !intent.hasExplicitVerify) {
      addPipelineBreadcrumb("extract.skip_short_text", transcriptDiagnosticData(trimmed));
      return;
    }

    try {
      addPipelineBreadcrumb("extract.start", {
        ...transcriptDiagnosticData(textToProcess),
        hasDispute: intent.hasDispute,
        hasExplicitVerify: intent.hasExplicitVerify,
        checkedClaimCount: getCheckedClaims().length,
      });
      const response = await fetch("/api/extract-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newText: textToProcess,
          recentContext: getRecentContext(),
          checkedClaims: getCheckedClaims(),
        }),
      });

      if (!response.ok) {
        addPipelineBreadcrumb("extract.http_error", {
          status: response.status,
        }, "error");
        return;
      }

      const { claims, forcedClaims } = await response.json();
      const forcedSet = new Set<string>(forcedClaims || []);
      const context = getRecentContext();
      let queued = false;
      addPipelineBreadcrumb("extract.done", {
        claimCount: claims?.length || 0,
        forcedClaimCount: forcedClaims?.length || 0,
      });

      if (claims && claims.length > 0) {
        claims.forEach((claim: string) => {
          const forceCheck = intent.hasExplicitVerify || forcedSet.has(claim);
          const urgent = intent.hasDispute || forceCheck;
          queueClaimCheck(claim, { context, urgent, forceCheck });
          queued = true;
        });
      }

      if (!queued && (intent.hasDispute || intent.hasExplicitVerify)) {
        const latestId = latestClaimIdRef.current;
        const latestRecord = latestId ? claimByIdRef.current.get(latestId) : undefined;
        if (latestRecord) {
          queueClaimCheck(latestRecord.claim, { context, urgent: true, forceCheck: true });
          queued = true;
        }
      }

      if (queued) {
        processQueue();
      }
    } catch (error) {
      console.error("Claim extraction error:", error);
      capturePipelineError(error, {
        stage: "client-extract",
        ...transcriptDiagnosticData(textToProcess),
      });
    }
  }, [getRecentContext, getCheckedClaims, processQueue, queueClaimCheck]);

  const extractAndProcessClaims = useCallback((newText: string) => {
    const hasDispute = isDisputeCue(newText);
    const hasExplicitVerify = isExplicitVerifyCue(newText);

    pendingTextRef.current = pendingTextRef.current
      ? `${pendingTextRef.current} ${newText}`
      : newText;

    pendingIntentRef.current.hasDispute = pendingIntentRef.current.hasDispute || hasDispute;
    pendingIntentRef.current.hasExplicitVerify =
      pendingIntentRef.current.hasExplicitVerify || hasExplicitVerify;
    addPipelineBreadcrumb("extract.schedule", {
      ...transcriptDiagnosticData(newText),
      hasDispute,
      hasExplicitVerify,
    });

    if (extractTimeoutRef.current) {
      clearTimeout(extractTimeoutRef.current);
    }

    const delayMs = getExtractionDelayMs(newText, pendingIntentRef.current.hasExplicitVerify);
    addPipelineBreadcrumb("extract.delay_selected", { delayMs });

    extractTimeoutRef.current = setTimeout(() => {
      const textToProcess = pendingTextRef.current;
      const intent = pendingIntentRef.current;
      pendingTextRef.current = "";
      pendingIntentRef.current = { hasDispute: false, hasExplicitVerify: false };
      doExtractClaims(textToProcess, intent);
    }, delayMs);
  }, [doExtractClaims]);

  const handleTranscript = useCallback((text: string) => {
    const now = Date.now();

    transcriptHistoryRef.current.push({ text, timestamp: now });

    transcriptHistoryRef.current = transcriptHistoryRef.current.filter(
      chunk => now - chunk.timestamp < CONTEXT_WINDOW_MS
    );

    setTranscript((prev) => (prev ? `${prev} ${text}` : text));

    extractAndProcessClaims(text);
  }, [extractAndProcessClaims]);

  const listener = useContinuousListener(handleTranscript);

  const buildSessionDiagnostics = useCallback((): Record<string, unknown> => {
    const chunks = transcriptHistoryRef.current.slice(-80);
    const transcriptText = chunks.map((chunk) => chunk.text).join(" ");
    const pendingText = pendingTextRef.current.trim();
    const browserContext =
      typeof window === "undefined"
        ? {}
        : {
            url: window.location.href,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            online: navigator.onLine,
            userAgent: navigator.userAgent,
          };

    return {
      app: "fact-checker",
      sessionId: diagnosticSessionIdRef.current,
      sessionStartedAt: diagnosticSessionStartedAtRef.current,
      sentAt: new Date().toISOString(),
      browser: browserContext,
      observability: {
        transcriptDiagnosticsEnabled,
        replayRequested: true,
      },
      listener: {
        isListening: listener.isListening,
        connectionStatus: listener.connectionStatus,
        stopReason: listener.stopReason,
        error: listener.error,
        sessionUsage: listener.sessionUsage,
      },
      settings: {
        showArgumentBreakdown,
        showTextInput,
      },
      transcript: {
        ...textStats(transcriptText),
        chunkCount: chunks.length,
        visibleTextStats: textStats(transcript),
        fullText: transcriptDiagnosticsEnabled
          ? limitDiagnosticText(transcriptText, 12000)
          : undefined,
        chunks: chunks.map((chunk) => ({
          timestamp: new Date(chunk.timestamp).toISOString(),
          ...textStats(chunk.text),
          text: transcriptDiagnosticsEnabled
            ? limitDiagnosticText(chunk.text, 1000)
            : undefined,
        })),
      },
      pendingExtraction: {
        ...textStats(pendingText),
        text: transcriptDiagnosticsEnabled
          ? limitDiagnosticText(pendingText, 4000)
          : undefined,
        hasDispute: pendingIntentRef.current.hasDispute,
        hasExplicitVerify: pendingIntentRef.current.hasExplicitVerify,
      },
      claims: factChecks.map((factCheck) => ({
        id: factCheck.id,
        timestamp: factCheck.timestamp.toISOString(),
        status: factCheck.isLoading ? "loading" : factCheck.error ? "error" : "done",
        error: factCheck.error,
        claimStats: textStats(factCheck.claim),
        claim: transcriptDiagnosticsEnabled
          ? limitDiagnosticText(factCheck.claim, 1000)
          : undefined,
        result: factCheck.result
          ? {
              verdict: factCheck.result.verdict,
              confidence: factCheck.result.confidence,
              whatsTrue: factCheck.result.whatsTrue,
              whatsWrong: factCheck.result.whatsWrong,
              context: factCheck.result.context,
              sourceCount: factCheck.result.sources.length,
              sources: factCheck.result.sources,
              argumentQualifier: factCheck.result.argument?.qualifier,
            }
          : null,
      })),
      queue: {
        queuedCount: factCheckQueueRef.current.length,
        isProcessing: isProcessingRef.current,
        knownClaimCount: claimByIdRef.current.size,
      },
    };
  }, [
    factChecks,
    listener.connectionStatus,
    listener.error,
    listener.isListening,
    listener.sessionUsage,
    listener.stopReason,
    showArgumentBreakdown,
    showTextInput,
    transcript,
  ]);

  const handleFeedbackSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedbackStatus("sending");
    setFeedbackError(null);
    addPipelineBreadcrumb("feedback.send_requested", {
      factCheckCount: factChecks.length,
      transcriptDiagnosticsEnabled,
    });

    try {
      const eventId = await sendSessionDiagnosticsFeedback(
        feedbackText,
        buildSessionDiagnostics()
      );
      addPipelineBreadcrumb("feedback.sent", { eventId });
      setFeedbackStatus("sent");
      setFeedbackText("");
    } catch (error) {
      capturePipelineError(error, { stage: "feedback-send" });
      setFeedbackStatus("error");
      setFeedbackError(
        error instanceof Error ? error.message : "Feedback could not be sent."
      );
    }
  }, [buildSessionDiagnostics, factChecks.length, feedbackText]);

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const claim = textInput.trim();
    if (!claim) return;

    addPipelineBreadcrumb("text_claim.submitted", claimDiagnosticData(claim));
    queueClaimCheck(claim, {
      context: getRecentContext(),
      urgent: true,
      forceCheck: true,
    });
    processQueue();
    setTextInput("");
  }, [textInput, queueClaimCheck, processQueue, getRecentContext]);

  useEffect(() => {
    if (listener.isListening) return;
    if (!pendingTextRef.current.trim()) return;

    if (extractTimeoutRef.current) {
      clearTimeout(extractTimeoutRef.current);
      extractTimeoutRef.current = null;
    }

    const textToProcess = pendingTextRef.current;
    const intent = pendingIntentRef.current;
    pendingTextRef.current = "";
    pendingIntentRef.current = { hasDispute: false, hasExplicitVerify: false };
    doExtractClaims(textToProcess, intent);
  }, [listener.isListening, doExtractClaims]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current && factChecks.length > 0) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [factChecks.length]);

  const canShowTextInput = showTextInput;
  const listenLabel = "Start listening";
  const statusLabelClass = canShowTextInput ? "hidden sm:inline" : "";
  const showTopicListings = isDev && showResearchTopicsEnv !== "false";

  return (
    <main className="min-h-screen flex flex-col bg-bg">
      {/* Minimal Header */}
      <header className="shrink-0 pt-6 pb-4 px-6">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text tracking-tight">
            Fact Check
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                setIsFeedbackOpen(true);
                setFeedbackStatus("idle");
                setFeedbackError(null);
              }}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Feedback
            </button>
            <Link
              href="/privacy"
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Privacy
            </Link>
          </div>
        </div>
      </header>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            type="button"
            aria-label="Dismiss settings"
            onClick={() => setIsSettingsOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface border border-border overflow-hidden"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text">Settings</h2>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Close
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text font-medium">Argument structure</p>
                  <p className="text-xs text-text-muted">
                    Show the Toulmin breakdown inside results.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Argument structure"
                  aria-checked={showArgumentBreakdown}
                  onClick={() => setShowArgumentBreakdown((prev) => !prev)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    showArgumentBreakdown ? "bg-text" : "bg-border-strong"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-bg transition-transform ${
                      showArgumentBreakdown ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text font-medium">Text input</p>
                  <p className="text-xs text-text-muted">
                    Show a text box to type claims.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Text input"
                  aria-checked={showTextInput}
                  onClick={() => setShowTextInput((prev) => !prev)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    showTextInput ? "bg-text" : "bg-border-strong"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-bg transition-transform ${
                      showTextInput ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isFeedbackOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            type="button"
            aria-label="Dismiss feedback"
            onClick={() => setIsFeedbackOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Share session"
            onSubmit={handleFeedbackSubmit}
            className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface border border-border overflow-hidden"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text">Share session</h2>
              <button
                type="button"
                onClick={() => setIsFeedbackOpen(false)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Close
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="block">
                <span className="text-sm text-text font-medium">What went wrong?</span>
                <textarea
                  rows={4}
                  value={feedbackText}
                  onChange={(event) => {
                    setFeedbackText(event.target.value);
                    if (feedbackStatus !== "sending") {
                      setFeedbackStatus("idle");
                    }
                  }}
                  placeholder="Missed a claim, checked too early, showed an error..."
                  className="mt-2 w-full rounded-xl bg-bg border border-border px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-text-secondary resize-none"
                />
              </label>
              <p className="text-xs text-text-muted">
                Sends anonymous diagnostics
                {transcriptDiagnosticsEnabled
                  ? ", including recent transcript text."
                  : ". Transcript text is disabled in config."}
              </p>
              {feedbackStatus === "sent" && (
                <p className="text-xs text-success">Feedback sent.</p>
              )}
              {feedbackStatus === "error" && (
                <p className="text-xs text-error">
                  {feedbackError || "Feedback could not be sent."}
                </p>
              )}
              <button
                type="submit"
                disabled={feedbackStatus === "sending"}
                className="w-full h-10 rounded-full bg-text text-bg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {feedbackStatus === "sending" ? "Sending" : "Send feedback"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Scrollable Content Area */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 pb-48">
        <div className="max-w-2xl mx-auto">
          {factChecks.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-up">
              {listener.isListening ? (
                <>
                  <div className="w-20 h-20 mb-6 rounded-full bg-surface flex items-center justify-center" style={{ boxShadow: "var(--shadow-md)" }}>
                    <svg
                      className="w-10 h-10 text-success animate-pulse-subtle"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  </div>
                  <p className="text-text font-medium text-lg mb-2">
                    Listening for factual claims
                  </p>
                  <p className="text-text-muted text-sm max-w-xs">
                    Speak naturally. When a claim comes up, Fact Check will look
                    for evidence and show the result.
                  </p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 mb-6 rounded-full bg-surface flex items-center justify-center" style={{ boxShadow: "var(--shadow-md)" }}>
                    <svg
                      className="w-10 h-10 text-text-muted"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  </div>
                  <p className="text-text font-medium text-lg mb-2">
                    Bring evidence into the conversation
                  </p>
                  <p className="text-text-muted text-sm max-w-xs mb-8">
                    Tap the mic. Fact Check listens for factual claims and shows
                    what&apos;s supported, disputed, or uncertain.
                  </p>

                  {/* Topic chips */}
                  {showTopicListings && topics.length > 0 && (
                    <div className="mt-4 w-full max-w-md">
                      <p className="text-xs text-text-muted uppercase tracking-wide mb-3 text-center">
                        Or explore researched topics
                      </p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {topics.map((topic) => (
                          <TopicChip key={topic.slug} topic={topic} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-4">
              {factChecks.map((fc, index) => (
                <div
                  key={fc.id}
                  className="animate-fade-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <FactCheckCard
                    factCheck={fc}
                    showArgumentBreakdown={showArgumentBreakdown}
                    showSourceChips
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar - ChatGPT style */}
      <div className="fixed bottom-0 left-0 right-0 pb-safe">
        <div className="bg-bg/80 backdrop-blur-xl border-t border-border">
          {/* Session limit warning banner */}
          {listener.isListening && listener.sessionUsage.isWarning && (
            <div className="px-6 py-2 bg-warning-bg border-b border-warning/20">
              <div className="max-w-2xl mx-auto flex items-center gap-2">
                <svg className="w-4 h-4 text-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-warning font-medium">
                  Session ending in {formatTimeRemaining(USAGE_LIMITS.maxSessionDurationMs - listener.sessionUsage.elapsedMs)}
                </p>
              </div>
            </div>
          )}

          {/* Session limit reached message */}
          {listener.stopReason === "session_limit" && (
            <div className="px-6 py-3 bg-border">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-text-secondary">
                  Session limit reached (30 min). Tap to start a new session.
                </p>
              </div>
            </div>
          )}

          {/* Daily limit reached message */}
          {listener.stopReason === "daily_limit" && (
            <div className="px-6 py-3 bg-error-bg">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-error">
                  Daily limit reached. Please try again tomorrow.
                </p>
              </div>
            </div>
          )}

          {/* Live transcript */}
          {listener.isListening && (transcript || listener.interimText) && (
            <div className="px-6 py-3 border-b border-border">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-text-secondary">
                  {transcript.length > 80 && <span className="text-text-muted">...</span>}
                  <span>{transcript.slice(-80)}</span>
                  {listener.interimText && (
                    <span className="text-text-muted italic">
                      {transcript ? " " : ""}{listener.interimText}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {listener.error && (
            <div className="px-6 py-3 bg-error-bg">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-error">{listener.error}</p>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="px-6 py-4">
            <div className="max-w-2xl mx-auto w-full">
              <div className={`flex items-end gap-2 min-w-0 ${canShowTextInput ? "" : "justify-center"}`}>
                {/* Text input (toggled in settings) */}
                {canShowTextInput && (
                  <form
                    ref={formRef}
                    onSubmit={handleTextSubmit}
                    className="flex-1 min-w-0 flex items-end gap-2"
                  >
                    <textarea
                      ref={textAreaRef}
                      rows={1}
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onInput={resizeTextArea}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          formRef.current?.requestSubmit();
                        }
                      }}
                      placeholder="Enter a claim..."
                      className="flex-1 min-w-0 min-h-[44px] px-4 py-3 rounded-2xl bg-surface border border-border text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-text-secondary transition-colors resize-none leading-5 overflow-hidden"
                      style={{ boxShadow: "var(--shadow-sm)" }}
                      data-testid="claim-input"
                    />
                    <button
                      type="submit"
                      disabled={!textInput.trim()}
                      aria-label="Send claim"
                      className="h-11 w-11 shrink-0 rounded-full bg-text text-bg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                      data-testid="claim-submit"
                      style={{ boxShadow: "var(--shadow-sm)" }}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l6 7-6 7" />
                      </svg>
                    </button>
                  </form>
                )}

                {/* Main microphone button */}
                <button
                  type="button"
                  onClick={listener.isListening ? listener.stopListening : listener.startListening}
                  className={`
                  flex items-center justify-center gap-2 rounded-full font-medium text-sm transition-all duration-200 whitespace-nowrap
                  ${listener.isListening
                    ? "bg-text text-bg"
                    : "bg-text text-bg hover:opacity-90"
                  }
                  ${canShowTextInput ? "h-11 w-11 sm:w-auto sm:px-4" : "h-11 px-6"}
                `}
                  style={{ boxShadow: "var(--shadow-sm)" }}
                  aria-label={listener.isListening ? "Stop listening" : "Start listening"}
                >
                  {listener.isListening ? (
                    <>
                      <svg className="w-4 h-4 sm:hidden" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      {listener.connectionStatus === "connecting" && (
                        <>
                          <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                          <span className={statusLabelClass}>Connecting</span>
                        </>
                      )}
                      {listener.connectionStatus === "connected" && (
                        <>
                          <span className="w-2 h-2 rounded-full bg-error" />
                          <span className={statusLabelClass}>Stop</span>
                        </>
                      )}
                      {listener.connectionStatus === "error" && (
                        <>
                          <span className="w-2 h-2 rounded-full bg-error" />
                          <span className={statusLabelClass}>Error</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                      <span className={statusLabelClass}>{listenLabel}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </main>
  );
}
