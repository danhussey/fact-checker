const PLACEHOLDER_URLS = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unavailable",
  "not available",
  "no url",
]);

export function normalizeSourceUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  if (PLACEHOLDER_URLS.has(trimmed.toLowerCase())) return undefined;

  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(candidate)) return undefined;

  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
}
