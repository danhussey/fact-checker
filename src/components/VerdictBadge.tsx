"use client";

import { verdictConfig, type Verdict } from "@/lib/types";

interface VerdictBadgeProps {
  verdict: Verdict;
  confidence: 1 | 2 | 3 | 4;
}

const confidenceLabels: Record<1 | 2 | 3 | 4, string> = {
  1: "weak",
  2: "limited",
  3: "good",
  4: "strong",
};

export function VerdictBadge({ verdict, confidence }: VerdictBadgeProps) {
  const config = verdictConfig[verdict];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
    >
      <span>{config.label}</span>
      <span className="opacity-50">·</span>
      <span className="opacity-70">{confidenceLabels[confidence]}</span>
    </span>
  );
}

export function VerdictBadgeLoading() {
  return (
    <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-border animate-pulse">
      <span className="text-xs font-medium text-text-muted">Checking...</span>
    </span>
  );
}
