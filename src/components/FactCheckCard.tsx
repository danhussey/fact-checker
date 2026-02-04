"use client";

import { useState } from "react";
import type { FactCheck } from "@/lib/types";
import { VerdictBadge, VerdictBadgeLoading } from "./VerdictBadge";
import { WhatsTrueCard, WhatsWrongCard, ContextCard } from "./InfoCard";
import { SourceChip } from "./SourceChip";
import { ArgumentBreakdown } from "./ArgumentBreakdown";

interface FactCheckCardProps {
  factCheck: FactCheck;
  showArgumentBreakdown?: boolean;
  showResearchTopics?: boolean;
}

export function FactCheckCard({
  factCheck,
  showArgumentBreakdown = true,
  showResearchTopics = true,
}: FactCheckCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { result, isLoading, error, claim, timestamp } = factCheck;
  const hasResult = result !== null;
  const hasDetails = hasResult && (
    result.whatsTrue.length > 0 ||
    result.whatsWrong.length > 0 ||
    result.context.length > 0
  );

  return (
    <div
      className="rounded-2xl bg-surface overflow-hidden transition-shadow duration-200"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
        className={`w-full px-5 py-4 text-left ${
          hasDetails ? "hover:bg-surface-hover cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Top row: Verdict badge and timestamp */}
        <div className="flex items-center justify-between mb-2">
          {isLoading ? (
            <VerdictBadgeLoading />
          ) : hasResult ? (
            <VerdictBadge
              verdict={result.verdict}
              confidence={result.confidence as 1 | 2 | 3 | 4}
            />
          ) : error ? (
            <span className="text-xs font-medium text-error">Error</span>
          ) : null}

          <span className="text-xs text-text-muted">
            {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>

        {/* Claim text */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-text leading-relaxed">
            {claim}
          </p>

          {hasDetails && (
            <svg
              className={`shrink-0 w-4 h-4 text-text-muted transition-transform duration-200 mt-0.5 ${
                expanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && hasResult && (
        <div className="px-5 pb-5 space-y-3">
          <WhatsTrueCard items={result.whatsTrue} />
          <WhatsWrongCard items={result.whatsWrong} />
          <ContextCard items={result.context} />

          {showArgumentBreakdown && result.argument && (
            <ArgumentBreakdown argument={result.argument} />
          )}

          {showResearchTopics && result.sources.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {result.sources.map((source, i) => (
                <SourceChip key={i} name={source.name} url={source.url} />
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="px-5 pb-4 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  );
}
