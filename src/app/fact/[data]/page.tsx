import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { decodeShareData } from "@/lib/shareEncoding";
import { verdictConfig } from "@/lib/types";
import { SharedFactCard } from "./SharedFactCard";

interface PageProps {
  params: Promise<{ data: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { data } = await params;
  const shareData = decodeShareData(data);

  if (!shareData) {
    return { title: "Fact Check Not Found" };
  }

  const verdictLabel = verdictConfig[shareData.verdict].label;
  const title = `${verdictLabel}: "${shareData.claim.slice(0, 60)}${shareData.claim.length > 60 ? "..." : ""}"`;
  const description = [
    ...shareData.whatsTrue.map((s) => `True: ${s}`),
    ...shareData.whatsWrong.map((s) => `Wrong: ${s}`),
    ...shareData.context.map((s) => s),
  ]
    .slice(0, 2)
    .join(" | ") || `Fact-checked with ${shareData.confidence}/4 confidence.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "Fact Check",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function SharedFactPage({ params }: PageProps) {
  const { data } = await params;
  const shareData = decodeShareData(data);

  if (!shareData) {
    notFound();
  }

  return <SharedFactCard data={data} shareData={shareData} />;
}
