"use client";

import { verdictConfig, type Verdict } from "@/lib/types";

interface VerdictBadgeProps {
  verdict: Verdict;
  confidence: 1 | 2 | 3 | 4;
}

export function VerdictBadge({ verdict, confidence }: VerdictBadgeProps) {
  const config = verdictConfig[verdict];

  return (
    <div className="flex items-center gap-3">
      {/* Verdict label */}
      <span
        className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide ${config.bg} ${config.text}`}
      >
        {config.label}
      </span>

      {/* Confidence dots */}
      <div className="flex items-center gap-1" title={`Confidence: ${confidence}/4`}>
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`w-2 h-2 rounded-full ${
              level <= confidence ? config.text.replace("text-", "bg-") : "bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// Loading state version
export function VerdictBadgeLoading() {
  return (
    <div className="flex items-center gap-3">
      <div className="px-2.5 py-1 rounded-md bg-zinc-700 animate-pulse">
        <span className="text-xs font-bold tracking-wide text-transparent">CHECKING</span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="w-2 h-2 rounded-full bg-zinc-700 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
