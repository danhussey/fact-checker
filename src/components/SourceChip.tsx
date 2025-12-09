"use client";

import { useState } from "react";

interface SourceChipProps {
  name: string;
  url?: string;
}

export function SourceChip({ name, url }: SourceChipProps) {
  const [expanded, setExpanded] = useState(false);

  if (!url) {
    return (
      <span className="px-2 py-1 rounded-md text-xs bg-zinc-800 text-zinc-400">
        {name}
      </span>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`px-2 py-1 rounded-md text-xs transition-colors ${
          expanded
            ? "bg-zinc-700 text-zinc-200"
            : "bg-zinc-800 text-zinc-400 active:bg-zinc-700"
        }`}
      >
        {name}
        <span className="ml-1 text-zinc-500">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 px-2 py-1.5 rounded-md text-xs bg-blue-500/10 text-blue-400 active:bg-blue-500/20 break-all"
        >
          {url.replace(/^https?:\/\//, "").slice(0, 40)}
          {url.length > 48 ? "..." : ""}
          <span className="ml-1">↗</span>
        </a>
      )}
    </div>
  );
}
