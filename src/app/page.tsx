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

// Normalize claim for deduplication - handles unit variations, spacing, etc.
function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .trim()
    // Normalize storage units
    .replace(/\bgigabytes?\b/gi, "gb")
    .replace(/\bmegabytes?\b/gi, "mb")
    .replace(/\bterabytes?\b/gi, "tb")
    .replace(/\bkilobytes?\b/gi, "kb")
    // Normalize number words
    .replace(/\bmillion\b/gi, "m")
    .replace(/\bbillion\b/gi, "b")
    .replace(/\bthousand\b/gi, "k")
    // Normalize currency
    .replace(/\bdollars?\b/gi, "$")
    .replace(/\bpounds?\b/gi, "£")
    .replace(/\beuros?\b/gi, "€")
    // Normalize percentages
    .replace(/\bpercent\b/gi, "%")
    .replace(/\bper\s*cent\b/gi, "%")
    // Remove extra spaces
    .replace(/\s+/g, " ")
    // Remove punctuation for comparison
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

  // Process a single claim through fact-checking
  const processFactCheck = useCallback(async (claim: string, context?: string) => {
    const id = crypto.randomUUID();

    // Add to list immediately as loading
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

      // Update with the result
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

  // Process the fact-check queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || factCheckQueueRef.current.length === 0) return;

    isProcessingRef.current = true;
    const { claim, context } = factCheckQueueRef.current.shift()!;

    await processFactCheck(claim, context);

    isProcessingRef.current = false;

    // Process next in queue
    if (factCheckQueueRef.current.length > 0) {
      processQueue();
    }
  }, [processFactCheck]);

  // Get recent context from transcript history
  const getRecentContext = useCallback(() => {
    const now = Date.now();
    const recentChunks = transcriptHistoryRef.current.filter(
      chunk => now - chunk.timestamp < CONTEXT_WINDOW_MS
    );
    return recentChunks.map(c => c.text).join(" ");
  }, []);

  // Get list of already-checked AND pending claims for dedup
  const getCheckedClaims = useCallback(() => {
    const checked = factChecks.map(fc => fc.claim);
    const pending = factCheckQueueRef.current.map(item => item.claim);
    return [...checked, ...pending];
  }, [factChecks]);

  // Extract claims - called after debounce
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
          // Normalize to catch variations like "256 gigabytes" vs "256 GB"
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

  // Debounced claim extraction - batches rapid transcript chunks
  const extractAndProcessClaims = useCallback((newText: string) => {
    // Accumulate text
    pendingTextRef.current = pendingTextRef.current
      ? `${pendingTextRef.current} ${newText}`
      : newText;

    // Clear existing timeout
    if (extractTimeoutRef.current) {
      clearTimeout(extractTimeoutRef.current);
    }

    // Wait 1.5s for more text before extracting
    extractTimeoutRef.current = setTimeout(() => {
      const textToProcess = pendingTextRef.current;
      pendingTextRef.current = "";
      doExtractClaims(textToProcess);
    }, 1500);
  }, [doExtractClaims]);

  // Handle new transcript chunks
  const handleTranscript = useCallback((text: string) => {
    const now = Date.now();

    // Add to rolling history
    transcriptHistoryRef.current.push({ text, timestamp: now });

    // Prune old chunks (older than context window)
    transcriptHistoryRef.current = transcriptHistoryRef.current.filter(
      chunk => now - chunk.timestamp < CONTEXT_WINDOW_MS
    );

    // Update display transcript
    setTranscript((prev) => (prev ? `${prev} ${text}` : text));

    // Extract claims from new text (context provided separately)
    extractAndProcessClaims(text);
  }, [extractAndProcessClaims]);

  const listener = useContinuousListener(handleTranscript);

  // Auto-scroll to show new fact-checks
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current && factChecks.length > 0) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [factChecks.length]);

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="shrink-0 px-4 py-4 border-b border-zinc-800">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold">Fact Check</h1>

          {/* Listen toggle with integrated status */}
          <button
            onClick={listener.isListening ? listener.stopListening : listener.startListening}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-all
              ${
                listener.isListening
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-white text-black hover:bg-zinc-200"
              }
            `}
          >
            {listener.isListening ? (
              <>
                <span className="relative flex h-3 w-3">
                  {listener.connectionStatus === "connecting" && (
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500 animate-pulse" />
                  )}
                  {listener.connectionStatus === "connected" && (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                    </>
                  )}
                  {listener.connectionStatus === "error" && (
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  )}
                </span>
                {listener.connectionStatus === "connecting" && "Connecting..."}
                {listener.connectionStatus === "connected" && "Listening"}
                {listener.connectionStatus === "error" && "Error"}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
                Start Listening
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Live transcript - shows latest text with streaming interim results */}
        {listener.isListening && (transcript || listener.interimText) && (
          <div className="shrink-0 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
            <p className="text-xs text-zinc-500 mb-1">Live transcript</p>
            <p className="text-sm">
              <span className="text-zinc-600">...</span>
              <span className="text-zinc-400 animate-fade-in">{transcript.slice(-100)}</span>
              {listener.interimText && (
                <span className="text-zinc-500 italic animate-fade-in">
                  {transcript ? " " : ""}{listener.interimText}
                </span>
              )}
            </p>
          </div>
        )}

        {/* Error message */}
        {listener.error && (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20">
            <p className="text-sm text-red-400">{listener.error}</p>
          </div>
        )}

        {/* Fact-checks list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto">
            {factChecks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
                {listener.isListening ? (
                  <>
                    <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-zinc-400 animate-pulse"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                    </div>
                    <p className="text-zinc-400 mb-2">Listening for claims...</p>
                    <p className="text-sm text-zinc-600 max-w-xs">
                      Speak naturally. Fact-checkable claims will appear here automatically.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-zinc-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                    </div>
                    <p className="text-zinc-400 mb-2">Ready to fact-check</p>
                    <p className="text-sm text-zinc-600 max-w-xs">
                      Tap &ldquo;Start Listening&rdquo; to begin. Claims will be automatically detected and fact-checked.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {factChecks.map((fc) => (
                  <FactCheckCard key={fc.id} factCheck={fc} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 px-4 py-3 border-t border-zinc-800">
        <p className="text-xs text-center text-zinc-600">
          Evidence explorer — not a truth machine
          <span className="mx-2">·</span>
          <Link href="/privacy" className="hover:text-zinc-400">Privacy</Link>
        </p>
      </footer>
    </main>
  );
}
