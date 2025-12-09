"use client";

interface InfoCardProps {
  title: string;
  items: string[];
  colorClass: string;
}

export function InfoCard({ title, items, colorClass }: InfoCardProps) {
  if (items.length === 0) return null;

  return (
    <div className={`rounded-xl p-4 ${colorClass}`}>
      <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2.5">
        {title}
      </h4>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="text-sm text-text leading-relaxed flex items-start gap-2.5">
            <span className="text-text-muted mt-1 text-xs">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatsTrueCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="What's True"
      items={items}
      colorClass="bg-success-bg"
    />
  );
}

export function WhatsWrongCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="What's Wrong"
      items={items}
      colorClass="bg-error-bg"
    />
  );
}

export function ContextCard({ items }: { items: string[] }) {
  return (
    <InfoCard
      title="Context"
      items={items}
      colorClass="bg-info-bg"
    />
  );
}
