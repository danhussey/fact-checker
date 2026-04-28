const ASSERTION_PATTERN =
  /\b(is|are|was|were|has|have|had|costs?|weighs?|measures?|contains?|receives?|spends?|emits?|increased|decreased|rose|fell)\b/i;

const QUESTION_PATTERN =
  /^(who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would)\b/i;

const NUMERIC_WORD_PATTERN =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|trillion)\b/i;

function normalizeTranscriptText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^(um|uh|ah|er|like),?\s+/i, "")
    .trim();
}

function isSingleThought(text: string): boolean {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length <= 1;
}

export function directFactClaimFallback(text: string): string | null {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return null;
  if (normalized.length < 10 || normalized.length > 240) return null;
  if (!isSingleThought(normalized)) return null;
  if (normalized.endsWith("?") || QUESTION_PATTERN.test(normalized)) return null;

  const hasNumber = /\d/.test(normalized) || NUMERIC_WORD_PATTERN.test(normalized);
  if (!hasNumber || !ASSERTION_PATTERN.test(normalized)) return null;

  const wordCount = normalized.split(/\s+/).length;
  if (wordCount < 4) return null;

  return normalized;
}
