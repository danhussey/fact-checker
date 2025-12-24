"use client";

import { useState } from "react";
import type { ToulminStructure, Qualifier } from "@/lib/types";

interface ArgumentBreakdownProps {
  argument: ToulminStructure;
}

const qualifierConfig: Record<Qualifier, { bg: string; text: string; label: string }> = {
  certain: { bg: "bg-success-bg", text: "text-success", label: "Certain" },
  probable: { bg: "bg-success-bg", text: "text-success", label: "Probable" },
  possible: { bg: "bg-warning-bg", text: "text-warning", label: "Possible" },
  uncertain: { bg: "bg-border", text: "text-text-muted", label: "Uncertain" },
};

export function ArgumentBreakdown({ argument }: ArgumentBreakdownProps) {
  const [expanded, setExpanded] = useState(false);
  const { claim, grounds, warrant, backing, qualifier, rebuttals } = argument;
  const qualifierStyle = qualifierConfig[qualifier];

  return (
    <div className="rounded-xl bg-surface-hover overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-border/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
            Argument Structure
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${qualifierStyle.bg} ${qualifierStyle.text}`}>
            {qualifierStyle.label}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Claim */}
          <div>
            <h5 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
              Claim
            </h5>
            <p className="text-sm text-text">{claim}</p>
          </div>

          {/* Grounds */}
          {grounds.length > 0 && (
            <div>
              <h5 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
                Grounds (Evidence)
              </h5>
              <ul className="space-y-1">
                {grounds.map((ground, i) => (
                  <li key={i} className="text-sm text-text flex items-start gap-2">
                    <span className="text-text-muted text-xs mt-0.5">•</span>
                    <span>{ground}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warrant */}
          <div>
            <h5 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
              Warrant (Logic)
            </h5>
            <p className="text-sm text-text-secondary italic">{warrant}</p>
          </div>

          {/* Backing (optional) */}
          {backing && (
            <div>
              <h5 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
                Backing
              </h5>
              <p className="text-sm text-text-secondary">{backing}</p>
            </div>
          )}

          {/* Rebuttals (optional) */}
          {rebuttals && rebuttals.length > 0 && (
            <div>
              <h5 className="text-[10px] font-medium text-error uppercase tracking-wider mb-1">
                Rebuttals
              </h5>
              <ul className="space-y-1">
                {rebuttals.map((rebuttal, i) => (
                  <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                    <span className="text-error text-xs mt-0.5">!</span>
                    <span>{rebuttal}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
