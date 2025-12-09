"use client";

interface InfoCardProps {
  title: string;
  items: string[];
  colorClass: string; // e.g., "border-green-500/30 bg-green-500/5"
}

export function InfoCard({ title, items, colorClass }: InfoCardProps) {
  if (items.length === 0) return null;

  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm text-zinc-200 flex items-start gap-2">
            <span className="text-zinc-500 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Predefined card types for convenience
export function WhatsTrueCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="What's True"
      items={items}
      colorClass="border-green-500/30 bg-green-500/5"
    />
  );
}

export function WhatsMisleadingCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="What's Misleading"
      items={items}
      colorClass="border-yellow-500/30 bg-yellow-500/5"
    />
  );
}

export function MissingContextCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="Missing Context"
      items={items}
      colorClass="border-orange-500/30 bg-orange-500/5"
    />
  );
}
