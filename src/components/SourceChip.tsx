"use client";

interface SourceChipProps {
  name: string;
  url?: string;
}

export function SourceChip({ name, url }: SourceChipProps) {
  if (!url) {
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs bg-bg-secondary text-text-secondary">
        {name}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-info-bg text-info hover:opacity-80 transition-opacity"
    >
      <span>{name}</span>
      <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
