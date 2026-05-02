import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ??
    (process.env.NODE_ENV === "development" ? "1" : "0.1")
);
const replaysSessionSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ??
    (process.env.NODE_ENV === "development" ? "1" : "0.1")
);
const replaysOnErrorSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? "1.0"
);
const enableLogs = process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS !== "false";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate,
  enableLogs,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate,
  replaysOnErrorSampleRate,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
