import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = Number(
  process.env.SENTRY_TRACES_SAMPLE_RATE ??
    (process.env.NODE_ENV === "development" ? "1" : "0.1")
);
const enableLogs =
  (process.env.SENTRY_ENABLE_LOGS ??
    process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS) !== "false";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate,
  enableLogs,
});
