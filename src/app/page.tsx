"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useContinuousListener } from "@/hooks/useContinuousListener";
import { FactCheckCard } from "@/components/FactCheckCard";
import { TopicChip } from "@/components/TopicChip";
import { useClaimPipeline } from "@/hooks/useClaimPipeline";
import { useStoredBoolean } from "@/hooks/useStoredBoolean";
import type { TranscriptSegmentMetadata } from "@/lib/transcriptSegments";
import { getTopicListings } from "@/lib/research/loader";
import {
  addPipelineBreadcrumb,
  capturePipelineError,
  claimDiagnosticData,
  limitDiagnosticText,
  sendSessionDiagnosticsFeedback,
  textStats,
  transcriptDiagnosticsEnabled,
} from "@/lib/observability";
import { USAGE_LIMITS } from "@/lib/types";

const ARGUMENT_STORAGE_KEY = "fact-checker:show-argument-breakdown";
const TEXT_INPUT_STORAGE_KEY = "fact-checker:show-text-input";
const TRANSCRIPT_DIAGNOSTICS_STORAGE_KEY =
  "fact-checker:include-transcript-diagnostics";

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
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showArgumentBreakdown, setShowArgumentBreakdown] = useStoredBoolean(ARGUMENT_STORAGE_KEY, false);
  const [showTextInput, setShowTextInput] = useStoredBoolean(TEXT_INPUT_STORAGE_KEY, enableTextInputEnv);
  const [includeTranscriptDiagnostics, setIncludeTranscriptDiagnostics] =
    useStoredBoolean(TRANSCRIPT_DIAGNOSTICS_STORAGE_KEY, transcriptDiagnosticsEnabled);
  const [topics] = useState(getTopicListings);
  const transcriptDiagnosticsIncluded =
    transcriptDiagnosticsEnabled && includeTranscriptDiagnostics;
  const formRef = useRef<HTMLFormElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [diagnosticSessionId] = useState(createDiagnosticSessionId);
  const diagnosticSessionStartedAtRef = useRef(new Date().toISOString());
  const pipeline = useClaimPipeline({
    diagnosticSessionId,
    includeTranscriptDiagnostics: transcriptDiagnosticsIncluded,
  });
  const { factChecks, handleTranscript: processTranscript, submitClaim, flush, diagnostics } = pipeline;

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
    if (showTextInput) resizeTextArea();
  }, [showTextInput, textInput, resizeTextArea]);

  const handleTranscript = useCallback((text: string, metadata?: TranscriptSegmentMetadata) => {
    setTranscript(prev => `${prev} ${text}`.trim().slice(-12000));
    processTranscript(text, metadata);
  }, [processTranscript]);

  const listener = useContinuousListener(handleTranscript, {
    includeTranscriptDiagnostics: transcriptDiagnosticsIncluded,
  });

  const buildSessionDiagnostics = useCallback((): Record<string, unknown> => {
    const pipelineSnapshot = diagnostics();
    const chunks = pipelineSnapshot.history;
    const transcriptText = chunks.map((chunk) => chunk.text).join(" ");
    const pendingText = pipelineSnapshot.pending?.pendingText.trim() ?? "";
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
      sessionId: diagnosticSessionId,
      sessionStartedAt: diagnosticSessionStartedAtRef.current,
      sentAt: new Date().toISOString(),
      browser: browserContext,
      observability: {
        transcriptDiagnosticsDefaultEnabled: transcriptDiagnosticsEnabled,
        transcriptDiagnosticsIncluded,
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
        fullText: transcriptDiagnosticsIncluded
          ? limitDiagnosticText(transcriptText, 12000)
          : undefined,
        chunks: chunks.map((chunk) => ({
          timestamp: new Date(chunk.timestamp).toISOString(),
          ...textStats(chunk.text),
          text: transcriptDiagnosticsIncluded
            ? limitDiagnosticText(chunk.text, 1000)
            : undefined,
        })),
      },
      pendingExtraction: {
        ...textStats(pendingText),
        text: transcriptDiagnosticsIncluded
          ? limitDiagnosticText(pendingText, 4000)
          : undefined,
        activeBatchId: pipelineSnapshot.pending?.activeBatchId,
        failedBatchId: pipelineSnapshot.pending?.failedBatchId,
      },
      claims: factChecks.map((factCheck) => ({
        id: factCheck.id,
        timestamp: factCheck.timestamp.toISOString(),
        status: factCheck.isLoading ? "loading" : factCheck.error ? "error" : "done",
        error: factCheck.error,
        claimStats: textStats(factCheck.claim),
        claim: transcriptDiagnosticsIncluded
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
      queue: pipelineSnapshot.queue,
    };
  }, [
    diagnostics,
    diagnosticSessionId,
    factChecks,
    listener.connectionStatus,
    listener.error,
    listener.isListening,
    listener.sessionUsage,
    listener.stopReason,
    showArgumentBreakdown,
    showTextInput,
    transcriptDiagnosticsIncluded,
    transcript,
  ]);

  const handleFeedbackSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedbackStatus("sending");
    setFeedbackError(null);
    addPipelineBreadcrumb("feedback.send_requested", {
      factCheckCount: factChecks.length,
      transcriptDiagnosticsIncluded,
    });

    try {
      const eventId = await sendSessionDiagnosticsFeedback(
        feedbackText,
        buildSessionDiagnostics(),
        { transcriptDiagnosticsIncluded }
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
  }, [
    buildSessionDiagnostics,
    factChecks.length,
    feedbackText,
    transcriptDiagnosticsIncluded,
  ]);

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const claim = textInput.trim();
    if (!claim) return;

    addPipelineBreadcrumb(
      "text_claim.submitted",
      claimDiagnosticData(claim, transcriptDiagnosticsIncluded)
    );
    submitClaim(claim);
    setTextInput("");
  }, [submitClaim, textInput, transcriptDiagnosticsIncluded]);

  useEffect(() => {
    if (!listener.isListening) flush();
  }, [listener.isListening, flush]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current && factChecks.length > 0) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [factChecks.length]);

  const canShowTextInput = showTextInput;
  const isRecordingControlActive = listener.isListening || listener.isStarting;
  const listenLabel = "Start listening";
  const recordingControlLabel = listener.isStarting ? "Starting" : "Stop";
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text font-medium">Transcript diagnostics</p>
                  <p className="text-xs text-text-muted">
                    {transcriptDiagnosticsEnabled
                      ? "Include recent transcript text in feedback and logs."
                      : "Disabled by deployment config."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Transcript diagnostics"
                  aria-checked={transcriptDiagnosticsIncluded}
                  disabled={!transcriptDiagnosticsEnabled}
                  onClick={() => setIncludeTranscriptDiagnostics((prev) => !prev)}
                  className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    transcriptDiagnosticsIncluded ? "bg-text" : "bg-border-strong"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-bg transition-transform ${
                      transcriptDiagnosticsIncluded ? "translate-x-5" : ""
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
                {transcriptDiagnosticsIncluded
                  ? ", including recent transcript text."
                  : ". Transcript text is turned off."}
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
              {listener.isStarting ? (
                <>
                  <div className="w-20 h-20 mb-6 rounded-full bg-surface flex items-center justify-center" style={{ boxShadow: "var(--shadow-md)" }}>
                    <svg
                      className="w-9 h-9 text-text animate-pulse-subtle"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 6h12v12H6z" />
                    </svg>
                  </div>
                  <p className="text-text font-medium text-lg mb-2">
                    Starting microphone
                  </p>
                  <p className="text-text-muted text-sm max-w-xs">
                    Connecting to the microphone and evidence pipeline.
                  </p>
                </>
              ) : listener.isListening ? (
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
                    onRetry={() => pipeline.retryClaim(fc.id)}
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
                  Recording stopped after 2 hours. Tap to start a new session.
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

          {pipeline.extractionState.status !== "idle" && (
            <div className="px-6 py-2 border-b border-border" role="status" aria-live="polite">
              <div className="max-w-2xl mx-auto flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span>{pipeline.extractionState.status === "failed"
                  ? pipeline.extractionState.error
                  : pipeline.extractionState.status === "retrying"
                    ? "Reconnecting to claim detection…"
                    : "Recognizing claims…"}</span>
                {pipeline.extractionState.status === "failed" && (
                  <button className="shrink-0 underline" onClick={pipeline.retryExtraction}>Retry detection</button>
                )}
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
                  onClick={
                    isRecordingControlActive
                      ? listener.stopListening
                      : listener.startListening
                  }
                  className={`
                  flex items-center justify-center gap-2 rounded-full font-medium text-sm transition-all duration-200 whitespace-nowrap
                  ${isRecordingControlActive
                    ? "bg-text text-bg"
                    : "bg-text text-bg hover:opacity-90"
                  }
                  ${canShowTextInput ? "h-11 w-11 sm:w-auto sm:px-4" : "h-11 px-6"}
                `}
                  style={{ boxShadow: "var(--shadow-sm)" }}
                  aria-label={
                    isRecordingControlActive ? "Stop listening" : "Start listening"
                  }
                >
                  {isRecordingControlActive ? (
                    <>
                      <svg
                        className={`w-4 h-4 ${listener.isStarting ? "animate-pulse-subtle" : ""}`}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      <span className={statusLabelClass}>{recordingControlLabel}</span>
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
