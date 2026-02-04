"use client";

import { useState } from "react";
import type { ResearchClaim } from "@/lib/types";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SourceChip } from "@/components/SourceChip";

interface TopicClaimCardProps {
  claim: ResearchClaim;
}

export function TopicClaimCard({ claim }: TopicClaimCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails =
    claim.evidenceFor.length > 0 ||
    claim.evidenceAgainst.length > 0 ||
    claim.sources.length > 0;

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
        {/* Top row: Verdict badge */}
        <div className="flex items-center justify-between mb-2">
          <VerdictBadge
            verdict={claim.verdict}
            confidence={claim.confidence}
          />
        </div>

        {/* Claim text */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-text leading-relaxed">
            {claim.statement}
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
      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* Evidence For */}
          {claim.evidenceFor.length > 0 && (
            <div className="rounded-xl bg-success-bg p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-medium text-success uppercase tracking-wide">
                  Supporting Evidence
                </span>
              </div>
              <ul className="space-y-2">
                {claim.evidenceFor.map((evidence, i) => (
                  <li key={i} className="text-sm text-text-secondary leading-relaxed">
                    <span className="text-text">{evidence.point}</span>
                    {evidence.source && (
                      <span className="text-text-muted text-xs ml-1">
                        — {evidence.source}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence Against */}
          {claim.evidenceAgainst.length > 0 && (
            <div className="rounded-xl bg-error-bg p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="text-xs font-medium text-error uppercase tracking-wide">
                  Contradicting Evidence
                </span>
              </div>
              <ul className="space-y-2">
                {claim.evidenceAgainst.map((evidence, i) => (
                  <li key={i} className="text-sm text-text-secondary leading-relaxed">
                    <span className="text-text">{evidence.point}</span>
                    {evidence.source && (
                      <span className="text-text-muted text-xs ml-1">
                        — {evidence.source}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sources */}
          {claim.sources.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {claim.sources.map((source, i) => (
                <SourceChip key={i} name={source.name} url={source.url} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
