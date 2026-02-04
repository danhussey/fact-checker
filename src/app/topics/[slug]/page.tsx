import { notFound } from "next/navigation";
import Link from "next/link";
import { getTopicBySlug, getAllTopicSlugs } from "@/lib/research/loader";
import { TopicClaimCard } from "./TopicClaimCard";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllTopicSlugs().map((slug) => ({ slug }));
}

export default async function TopicPage({ params }: PageProps) {
  const { slug } = await params;
  const topic = await getTopicBySlug(slug);

  if (!topic) {
    notFound();
  }

  return (
    <main className="min-h-screen flex flex-col bg-bg">
      {/* Header */}
      <header className="shrink-0 pt-6 pb-4 px-6 border-b border-border">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to fact-checker
          </Link>
          <h1 className="text-xl font-semibold text-text tracking-tight mb-2">
            {topic.title}
          </h1>
          <p className="text-sm text-text-muted leading-relaxed">
            {topic.summary}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs text-text-muted capitalize px-2 py-1 rounded-md bg-surface">
              {topic.category}
            </span>
            <span className="text-xs text-text-muted">
              {topic.claims.length} claims analyzed
            </span>
            <span className="text-xs text-text-muted">
              Updated {new Date(topic.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </header>

      {/* Claims list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 pb-24">
        <div className="max-w-2xl mx-auto">
          <div className="flex flex-col gap-4">
            {topic.claims.map((claim, index) => (
              <div
                key={index}
                className="animate-fade-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <TopicClaimCard claim={claim} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
