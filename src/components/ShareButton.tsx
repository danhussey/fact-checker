"use client";

import { useState, useCallback } from "react";
import type { StructuredFactCheck } from "@/lib/types";
import { buildShareUrl } from "@/lib/shareEncoding";
import { verdictConfig } from "@/lib/types";

interface ShareButtonProps {
  claim: string;
  result: StructuredFactCheck;
}

export function ShareButton({ claim, result }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    const path = buildShareUrl(claim, result);
    const url = `${window.location.origin}${path}`;
    const verdictLabel = verdictConfig[result.verdict].label;
    const title = `Fact Check: ${verdictLabel}`;
    const text = `"${claim}" — ${verdictLabel} (${result.confidence}/4 confidence)`;

    // Try Web Share API first (mobile-friendly)
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // User cancelled or API failed — fall through to clipboard
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: prompt
      prompt("Copy this link:", url);
    }
  }, [claim, result]);

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
        text-text-secondary hover:text-text hover:bg-surface-hover
        transition-colors duration-150 cursor-pointer"
      title="Share this fact check"
      aria-label="Share this fact check"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
          <span>Share</span>
        </>
      )}
    </button>
  );
}
