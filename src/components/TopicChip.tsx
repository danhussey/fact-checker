"use client";

import Link from "next/link";
import type { TopicListing, TopicCategory } from "@/lib/types";

interface TopicChipProps {
  topic: TopicListing;
}

const categoryColors: Record<TopicCategory, { bg: string; text: string }> = {
  politics: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300" },
  science: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300" },
  health: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300" },
  economics: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300" },
  social: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300" },
};

export function TopicChip({ topic }: TopicChipProps) {
  const colors = categoryColors[topic.category] || categoryColors.social;

  return (
    <Link
      href={`/topics/${topic.slug}`}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl ${colors.bg} hover:opacity-80 transition-opacity`}
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <span className={`text-sm font-medium ${colors.text}`}>
        {topic.title}
      </span>
      <span className="text-xs text-text-muted">
        {topic.claimCount} claims
      </span>
    </Link>
  );
}

export function TopicChipSkeleton() {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface animate-pulse">
      <div className="h-4 w-24 bg-border rounded" />
      <div className="h-3 w-12 bg-border rounded" />
    </div>
  );
}
