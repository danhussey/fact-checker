const isDev = process.env.NODE_ENV === "development";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelColors: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

const reset = "\x1b[0m";

function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  if (!isDev && level === "debug") return;

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const color = levelColors[level];
  const prefix = `${color}[${timestamp}] [${tag}]${reset}`;

  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export const debug = {
  // Server-side loggers
  claims: {
    request: (newText: string, context: string, checked: string[]) => {
      log("debug", "CLAIMS", `New: "${newText.slice(0, 50)}..."`);
      if (context) log("debug", "CLAIMS", `Context: "${context.slice(-100)}..." (${context.length} chars)`);
      if (checked.length) log("debug", "CLAIMS", `Checked: ${checked.length} claims`);
    },
    response: (claims: string[]) =>
      log("debug", "CLAIMS", `Extracted: ${claims.length ? claims.join(" | ") : "(none)"}`),
    skip: (reason: string) =>
      log("debug", "CLAIMS", `Skipped: ${reason}`),
  },

  factCheck: {
    start: (claim: string) =>
      log("debug", "FACT-CHECK", `Checking: "${claim.slice(0, 50)}..."`),
    done: (claim: string, verdict: string) =>
      log("info", "FACT-CHECK", `${verdict.toUpperCase()}: "${claim.slice(0, 40)}..."`),
    error: (claim: string, err: unknown) =>
      log("error", "FACT-CHECK", `Failed: "${claim.slice(0, 40)}..."`, err),
  },

  transcript: {
    chunk: (text: string) =>
      log("debug", "TRANSCRIPT", `New chunk: "${text.slice(0, 50)}..."`),
  },
};
