"use client";

import { useState } from "react";
import Link from "next/link";
import type { ShareData } from "@/lib/shareEncoding";
import { verdictConfig } from "@/lib/types";

const confidenceLabels: Record<1 | 2 | 3 | 4, string> = {
  1: "weak",
  2: "limited",
  3: "good",
  4: "strong",
};

function InfoSection({
  title,
  items,
  colorClass,
}: {
  title: string;
  items: string[];
  colorClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-xl p-4 ${colorClass}`}>
      <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2.5">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="text-sm text-text leading-relaxed flex items-start gap-2.5"
          >
            <span className="text-text-muted mt-1 text-xs">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SharedFactCardProps {
  data: string;
  shareData: ShareData;
}

export function SharedFactCard({ data, shareData }: SharedFactCardProps) {
  const [copied, setCopied] = useState(false);
  const config = verdictConfig[shareData.verdict];

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/fact/${data}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this link:", url);
    }
  };

  const handleShareTwitter = () => {
    const url = `${window.location.origin}/fact/${data}`;
    const verdictLabel = verdictConfig[shareData.verdict].label;
    const text = `"${shareData.claim}" — ${verdictLabel}`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const handleShareFacebook = () => {
    const url = `${window.location.origin}/fact/${data}`;
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const handleShareLinkedIn = () => {
    const url = `${window.location.origin}/fact/${data}`;
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-text-muted hover:text-text transition-colors text-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            Fact Check
          </Link>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl bg-surface overflow-hidden"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          <div className="px-5 py-5">
            {/* Verdict badge */}
            <div className="mb-3">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
              >
                <span>{config.label}</span>
                <span className="opacity-50">·</span>
                <span className="opacity-70">
                  {confidenceLabels[shareData.confidence]}
                </span>
              </span>
            </div>

            {/* Claim */}
            <p className="text-base text-text leading-relaxed font-medium mb-4">
              &ldquo;{shareData.claim}&rdquo;
            </p>

            {/* Details */}
            <div className="space-y-3">
              <InfoSection
                title="What's True"
                items={shareData.whatsTrue}
                colorClass="bg-success-bg"
              />
              <InfoSection
                title="What's Wrong"
                items={shareData.whatsWrong}
                colorClass="bg-error-bg"
              />
              <InfoSection
                title="Context"
                items={shareData.context}
                colorClass="bg-info-bg"
              />
            </div>

            {/* Sources */}
            {shareData.sourceNames.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-xs text-text-muted mb-2">Sources</p>
                <div className="flex flex-wrap gap-2">
                  {shareData.sourceNames.map((name, i) => (
                    <span
                      key={i}
                      className="text-xs px-2.5 py-1 rounded-full bg-bg-secondary text-text-secondary"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Share bar */}
          <div className="px-5 py-3 border-t border-border bg-bg-secondary flex items-center justify-between">
            <span className="text-xs text-text-muted">Share this fact check</span>
            <div className="flex items-center gap-1">
              {/* X / Twitter */}
              <button
                onClick={handleShareTwitter}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors cursor-pointer"
                title="Share on X"
                aria-label="Share on X"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </button>

              {/* Facebook */}
              <button
                onClick={handleShareFacebook}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors cursor-pointer"
                title="Share on Facebook"
                aria-label="Share on Facebook"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </button>

              {/* LinkedIn */}
              <button
                onClick={handleShareLinkedIn}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors cursor-pointer"
                title="Share on LinkedIn"
                aria-label="Share on LinkedIn"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </button>

              {/* Copy link */}
              <button
                onClick={handleCopyLink}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors cursor-pointer"
                title={copied ? "Link copied!" : "Copy link"}
                aria-label="Copy link"
              >
                {copied ? (
                  <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.497" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-surface text-text text-sm font-medium hover:bg-surface-hover transition-colors"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            Try Fact Check yourself
          </Link>
        </div>
      </div>
    </div>
  );
}
