import type { ResearchTopic, TopicListing } from "@/lib/types";

// Import topic data
import topicsIndex from "@/content/topics/index.json";

// Dynamic import for individual topics
const topicModules: Record<string, () => Promise<ResearchTopic>> = {
  "ice-shooting-debate": () =>
    import("@/content/topics/ice-shooting-debate.json").then((m) => m.default as ResearchTopic),
  "climate-carbon-tax": () =>
    import("@/content/topics/climate-carbon-tax.json").then((m) => m.default as ResearchTopic),
};

export function getTopicListings(): TopicListing[] {
  return topicsIndex.topics as TopicListing[];
}

export async function getTopicBySlug(slug: string): Promise<ResearchTopic | null> {
  const loader = topicModules[slug];
  if (!loader) {
    return null;
  }

  try {
    return await loader();
  } catch (error) {
    console.error(`Failed to load topic: ${slug}`, error);
    return null;
  }
}

export function getAllTopicSlugs(): string[] {
  return Object.keys(topicModules);
}
