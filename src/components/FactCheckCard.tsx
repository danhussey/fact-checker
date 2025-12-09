"use client";

import { useState } from "react";
import type { FactCheck } from "@/lib/types";
import { VerdictBadge, VerdictBadgeLoading } from "./VerdictBadge";
import { WhatsTrueCard, WhatsMisleadingCard, MissingContextCard } from "./InfoCard";

interface FactCheckCardProps {
  factCheck: FactCheck;
}

export function FactCheckCard({ factCheck }: FactCheckCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { result, isLoading, error, claim, timestamp } = factCheck;
  const hasResult = result !== null;
  const hasDetails = hasResult && (
    result.whatsTrue.length > 0 ||
    result.whatsMisleading.length > 0 ||
    result.missingContext.length > 0
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
        className={`w-full px-4 py-3 text-left transition-colors ${
          hasDetails ? "hover:bg-zinc-800/50 cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Top row: Verdict badge or loading */}
        <div className="flex items-center justify-between mb-2">
          {isLoading ? (
            <VerdictBadgeLoading />
          ) : hasResult ? (
            <VerdictBadge
              verdict={result.verdict}
              confidence={result.confidence as 1 | 2 | 3 | 4}
            />
          ) : error ? (
            <span className="px-2.5 py-1 rounded-md text-xs font-bold tracking-wide bg-red-500/20 text-red-400">
              ERROR
            </span>
          ) : null}

          {/* Expand icon */}
          {hasDetails && (
            <svg
              className={`shrink-0 w-5 h-5 text-zinc-500 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
        </div>

        {/* Claim text */}
        <p className="text-sm text-white font-medium line-clamp-2">
          &ldquo;{claim}&rdquo;
        </p>

        {/* Timestamp */}
        <p className="text-xs text-zinc-500 mt-1.5">
          {isLoading ? "Checking..." : new Date(timestamp).toLocaleTimeString()}
        </p>
      </button>

      {/* Expanded content with visual cards */}
      {expanded && hasResult && (
        <div className="px-4 pb-4 border-t border-zinc-800 space-y-3 pt-3">
          <WhatsTrueCard items={result.whatsTrue} />
          <WhatsMisleadingCard items={result.whatsMisleading} />
          <MissingContextCard items={result.missingContext} />

          {/* Sources */}
          {result.sources.length > 0 && (
            <div className="flex items-center gap-2 pt-2 text-xs text-zinc-500">
              <span>Sources:</span>
              {result.sources.map((source, i) => (
                <span key={i}>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-white transition-colors"
                    >
                      {source.name}
                    </a>
                  ) : (
                    <span className="text-zinc-400">{source.name}</span>
                  )}
                  {i < result.sources.length - 1 && " • "}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="px-4 pb-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
