"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useContinuousListener } from "@/hooks/useContinuousListener";
import { FactCheckCard } from "@/components/FactCheckCard";
import type { FactCheck, StructuredFactCheck } from "@/lib/types";

interface TranscriptChunk {
  text: string;
  timestamp: number;
}

const CONTEXT_WINDOW_MS = 300000; // 5 minutes of context

function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .trim()
    .replace(/\bgigabytes?\b/gi, "gb")
    .replace(/\bmegabytes?\b/gi, "mb")
    .replace(/\bterabytes?\b/gi, "tb")
    .replace(/\bkilobytes?\b/gi, "kb")
    .replace(/\bmillion\b/gi, "m")
    .replace(/\bbillion\b/gi, "b")
    .replace(/\bthousand\b/gi, "k")
    .replace(/\bdollars?\b/gi, "$")
    .replace(/\bpounds?\b/gi, "£")
    .replace(/\beuros?\b/gi, "€")
    .replace(/\bpercent\b/gi, "%")
    .replace(/\bper\s*cent\b/gi, "%")
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:'"]/g, "");
}

export default function Home() {
  const [factChecks, setFactChecks] = useState<FactCheck[]>([]);
  const [transcript, setTranscript] = useState("");
  const factCheckQueueRef = useRef<{ claim: string; context: string }[]>([]);
  const isProcessingRef = useRef(false);
  const processedClaimsRef = useRef<Set<string>>(new Set());
  const transcriptHistoryRef = useRef<TranscriptChunk[]>([]);
  const pendingTextRef = useRef<string>("");
  const extractTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processFactCheck = useCallback(async (claim: string, context?: string) => {
    const id = crypto.randomUUID();

    setFactChecks((prev) => [
      {
        id,
        claim,
        result: null,
        isLoading: true,
        timestamp: new Date(),
      },
      ...prev,
    ]);

    try {
      const response = await fetch("/api/fact-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim, context }),
      });

      if (!response.ok) {
        throw new Error("Fact-check failed");
      }

      const result: StructuredFactCheck = await response.json();

      setFactChecks((prev) =>
        prev.map((fc) =>
          fc.id === id ? { ...fc, result, isLoading: false } : fc
        )
      );
    } catch (error) {
      console.error("Fact-check error:", error);
      setFactChecks((prev) =>
        prev.map((fc) =>
          fc.id === id
            ? { ...fc, error: "Failed to fact-check this claim.", isLoading: false }
            : fc
        )
      );
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || factCheckQueueRef.current.length === 0) return;

    isProcessingRef.current = true;
    const { claim, context } = factCheckQueueRef.current.shift()!;

    await processFactCheck(claim, context);

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
    const checked = factChecks.map(fc => fc.claim);
    const pending = factCheckQueueRef.current.map(item => item.claim);
    return [...checked, ...pending];
  }, [factChecks]);

  const doExtractClaims = useCallback(async (textToProcess: string) => {
    if (textToProcess.trim().length < 20) return;

    try {
      const response = await fetch("/api/extract-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newText: textToProcess,
          recentContext: getRecentContext(),
          checkedClaims: getCheckedClaims(),
        }),
      });

      if (!response.ok) return;

      const { claims } = await response.json();

      if (claims && claims.length > 0) {
        claims.forEach((claim: string) => {
          const normalized = normalizeClaim(claim);
          if (!processedClaimsRef.current.has(normalized)) {
            processedClaimsRef.current.add(normalized);
            factCheckQueueRef.current.push({ claim, context: getRecentContext() });
          }
        });

        processQueue();
      }
    } catch (error) {
      console.error("Claim extraction error:", error);
    }
  }, [processQueue, getRecentContext, getCheckedClaims]);

  const extractAndProcessClaims = useCallback((newText: string) => {
    pendingTextRef.current = pendingTextRef.current
      ? `${pendingTextRef.current} ${newText}`
      : newText;

    if (extractTimeoutRef.current) {
      clearTimeout(extractTimeoutRef.current);
    }

    extractTimeoutRef.current = setTimeout(() => {
      const textToProcess = pendingTextRef.current;
      pendingTextRef.current = "";
      doExtractClaims(textToProcess);
    }, 1500);
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

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current && factChecks.length > 0) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [factChecks.length]);

  return (
    <main className="min-h-screen flex flex-col bg-bg">
      {/* Minimal Header */}
      <header className="shrink-0 pt-6 pb-4 px-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold text-text tracking-tight">
            Fact Check
          </h1>
        </div>
      </header>

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
                  <p className="text-text font-medium text-lg mb-2">Listening...</p>
                  <p className="text-text-muted text-sm max-w-xs">
                    Speak naturally. Claims will be fact-checked automatically.
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
                  <p className="text-text font-medium text-lg mb-2">Ready to fact-check</p>
                  <p className="text-text-muted text-sm max-w-xs">
                    Tap the microphone to start listening
                  </p>
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
                  <FactCheckCard factCheck={fc} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar - ChatGPT style */}
      <div className="fixed bottom-0 left-0 right-0 pb-safe">
        <div className="bg-bg/80 backdrop-blur-xl border-t border-border">
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

          {/* Mic button area */}
          <div className="px-6 py-4">
            <div className="max-w-2xl mx-auto flex flex-col items-center gap-3">
              {/* Main microphone button */}
              <button
                onClick={listener.isListening ? listener.stopListening : listener.startListening}
                className={`
                  flex items-center justify-center gap-2.5 px-6 py-3 rounded-full font-medium text-sm transition-all duration-200
                  ${listener.isListening
                    ? "bg-text text-bg"
                    : "bg-text text-bg hover:opacity-90"
                  }
                `}
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                {listener.isListening ? (
                  <>
                    {listener.connectionStatus === "connecting" && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                        <span>Connecting</span>
                      </>
                    )}
                    {listener.connectionStatus === "connected" && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-error" />
                        <span>Stop</span>
                      </>
                    )}
                    {listener.connectionStatus === "error" && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-error" />
                        <span>Error</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                    <span>Start Listening</span>
                  </>
                )}
              </button>

              {/* Footer text */}
              <p className="text-xs text-text-muted text-center">
                Evidence explorer — not a truth machine
                <span className="mx-2">·</span>
                <Link href="/privacy" className="hover:text-text-secondary transition-colors">
                  Privacy
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
