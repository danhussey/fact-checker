import * as Sentry from "@sentry/nextjs";

type BreadcrumbData = Record<string, string | number | boolean | null | undefined>;

const transcriptDiagnosticsEnv =
  process.env.NEXT_PUBLIC_ENABLE_TRANSCRIPT_DIAGNOSTICS;
const maxDiagnosticTextChars = Number(
  process.env.NEXT_PUBLIC_TRANSCRIPT_DIAGNOSTIC_MAX_CHARS ?? "4000"
);

export const transcriptDiagnosticsEnabled = transcriptDiagnosticsEnv !== "false";

function getMaxDiagnosticTextChars() {
  if (!Number.isFinite(maxDiagnosticTextChars) || maxDiagnosticTextChars <= 0) {
    return 4000;
  }
  return Math.min(maxDiagnosticTextChars, 20000);
}

export function limitDiagnosticText(text: string, maxChars = getMaxDiagnosticTextChars()) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `[truncated:${trimmed.length - maxChars} chars] ${trimmed.slice(-maxChars)}`;
}

export function textStats(text: string): BreadcrumbData {
  const trimmed = text.trim();
  return {
    textLen: trimmed.length,
    wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
    hasNumber: /\d/.test(trimmed),
  };
}

export function textDiagnosticData(text: string, textKey: string): BreadcrumbData {
  const data = textStats(text);
  if (transcriptDiagnosticsEnabled) {
    data[textKey] = limitDiagnosticText(text);
  }
  return data;
}

export function transcriptDiagnosticData(text: string): BreadcrumbData {
  return textDiagnosticData(text, "transcript");
}

export function claimDiagnosticData(text: string): BreadcrumbData {
  return textDiagnosticData(text, "claim");
}

export function addPipelineBreadcrumb(
  message: string,
  data: BreadcrumbData = {},
  level: Sentry.SeverityLevel = "info"
) {
  Sentry.addBreadcrumb({
    category: "fact-checker.pipeline",
    message,
    level,
    data,
  });
}

export function capturePipelineError(
  error: unknown,
  context: BreadcrumbData = {}
) {
  Sentry.captureException(error, {
    tags: {
      area: "fact-checker.pipeline",
    },
    extra: context,
  });
}

type SentryWithFeedback = typeof Sentry & {
  sendFeedback?: (
    params: {
      message: string;
      tags?: Record<string, string | number | boolean>;
    },
    hint?: {
      includeReplay?: boolean;
      attachments?: Array<{
        filename: string;
        data: string | Uint8Array;
        contentType?: string;
      }>;
    }
  ) => Promise<string>;
};

export async function sendSessionDiagnosticsFeedback(
  message: string,
  diagnostics: Record<string, unknown>
) {
  const attachment = {
    filename: `fact-check-session-${Date.now()}.json`,
    data: JSON.stringify(diagnostics, null, 2),
    contentType: "application/json",
  };
  const feedbackMessage = message.trim() || "Session feedback";
  const tags = {
    source: "manual-session-feedback",
    transcriptDiagnostics: transcriptDiagnosticsEnabled ? "enabled" : "disabled",
  };
  const sentry = Sentry as SentryWithFeedback;

  if (typeof sentry.sendFeedback === "function") {
    return sentry.sendFeedback(
      {
        message: feedbackMessage,
        tags,
      },
      {
        includeReplay: true,
        attachments: [attachment],
      }
    );
  }

  return Sentry.captureEvent(
    {
      message: feedbackMessage,
      level: "info",
      tags,
      contexts: {
        feedback: {
          message: feedbackMessage,
          source: "manual-session-feedback",
        },
      },
    },
    {
      attachments: [attachment],
    }
  );
}
