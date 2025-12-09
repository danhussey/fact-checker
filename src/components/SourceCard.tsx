"use client";

import { useState } from "react";

interface SourceCardProps {
  url: string;
  title?: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function getSourceIcon(domain: string): string {
  if (domain.includes("gov")) return "government";
  if (domain.includes("edu")) return "academic";
  if (domain.includes("wikipedia")) return "encyclopedia";
  if (domain.includes("reuters") || domain.includes("ap")) return "news-agency";
  return "web";
}

export function SourceCard({ url, title }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const domain = getDomain(url);
  const sourceType = getSourceIcon(domain);

  const typeColors: Record<string, string> = {
    government: "bg-blue-500/20 text-blue-300",
    academic: "bg-purple-500/20 text-purple-300",
    encyclopedia: "bg-amber-500/20 text-amber-300",
    "news-agency": "bg-green-500/20 text-green-300",
    web: "bg-zinc-500/20 text-zinc-300",
  };

  const typeLabels: Record<string, string> = {
    government: "Gov",
    academic: "Edu",
    encyclopedia: "Wiki",
    "news-agency": "News",
    web: "Web",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        {/* Source type badge */}
        <span
          className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${typeColors[sourceType]}`}
        >
          {typeLabels[sourceType]}
        </span>

        {/* Domain */}
        <span className="flex-1 text-sm text-zinc-300 truncate">
          {title || domain}
        </span>

        {/* Expand icon */}
        <svg
          className={`shrink-0 w-4 h-4 text-zinc-500 transition-transform ${
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
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-zinc-800">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span className="truncate max-w-[200px]">{domain}</span>
            <svg
              className="shrink-0 w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}
