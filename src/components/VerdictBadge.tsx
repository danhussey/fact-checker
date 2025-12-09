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
  4: "solid",
};

export function VerdictBadge({ verdict, confidence }: VerdictBadgeProps) {
  const config = verdictConfig[verdict];

  return (
    <span
      className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide ${config.bg} ${config.text}`}
    >
      {config.label} <span className="opacity-60 font-medium">• {confidenceLabels[confidence]}</span>
    </span>
  );
}

// Loading state version
export function VerdictBadgeLoading() {
  return (
    <span className="px-2.5 py-1 rounded-md bg-zinc-700 animate-pulse">
      <span className="text-xs font-bold tracking-wide text-transparent">CHECKING...</span>
    </span>
  );
}
