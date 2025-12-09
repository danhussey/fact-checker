"use client";

import { SourceCard } from "./SourceCard";
import ReactMarkdown from "react-markdown";

interface Source {
  url: string;
  title?: string;
}

interface EvidenceExplorerProps {
  claim: string;
  response: string;
  sources: Source[];
  isStreaming: boolean;
  onReset: () => void;
}

export function EvidenceExplorer({
  claim,
  response,
  sources,
  isStreaming,
  onReset,
}: EvidenceExplorerProps) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      {/* Claim being checked */}
      <div className="rounded-xl bg-zinc-800/50 border border-zinc-700 p-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Checking claim
        </p>
        <p className="text-lg text-white">&ldquo;{claim}&rdquo;</p>
      </div>

      {/* Response content */}
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 overflow-hidden">
        <div
          className={`prose prose-invert prose-sm max-w-none
            prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:mt-6 prose-headings:mb-3 prose-headings:first:mt-0
            prose-p:text-zinc-300 prose-p:leading-relaxed
            prose-ul:text-zinc-300 prose-li:text-zinc-300
            prose-strong:text-zinc-100
            prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
            ${isStreaming ? "streaming-cursor" : ""}
          `}
        >
          <ReactMarkdown>{response}</ReactMarkdown>
        </div>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3">
            Sources ({sources.length})
          </h3>
          <div className="flex flex-col gap-2">
            {sources.map((source, index) => (
              <SourceCard
                key={source.url + index}
                url={source.url}
                title={source.title}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isStreaming && (
        <div className="flex flex-col gap-3 mt-2">
          <button
            onClick={onReset}
            className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-zinc-200 transition-colors"
          >
            Check another claim
          </button>
        </div>
      )}
    </div>
  );
}
