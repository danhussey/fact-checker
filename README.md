# Fact Checker

[![CI](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-vercel-black)](https://fact-checker-theta.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Real-time fact-checking PWA. Listens to audio, extracts claims, and fact-checks them using AI.

**[Live Demo](https://fact-checker-theta.vercel.app)**

## How It Works

1. Click "Start Listening" to capture audio from your microphone
2. Speech is transcribed in real time via Deepgram
3. AI extracts fact-checkable claims from the transcript
4. Each claim is checked against web evidence and rated (true, false, mostly true, etc.)

Recognition and research are separate: claims appear as soon as extraction finishes,
and up to two evidence checks run concurrently. Repeats reuse existing checks;
explicit corrections replace and cancel outdated work. Failed checks have a Retry
button and are never remembered as successful verifications.

## Stack

- **Next.js 16** - App Router
- **Deepgram** - Streaming speech-to-text
- **xAI Grok** - Claim extraction & fact-checking
- **Vercel AI SDK** - Structured outputs
- **Vercel** - Deployment
- **Sentry** - Error monitoring, masked replay, and manual session diagnostics

## Quick Start

```bash
# Install
npm install

# Set up environment
cp .env.local.example .env.local
# Add your OPENAI_API_KEY and XAI_API_KEY

# Run
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DEEPGRAM_API_KEY` | Server-side Deepgram API key used to mint short-lived browser transcription tokens. Must have permission to call Deepgram `/v1/auth/grant`. |
| `XAI_API_KEY` | xAI API key for Grok |
| `XAI_EXTRACTION_MODEL` | Optional extraction model override; defaults to `grok-4.3`, with reasoning disabled for fast extraction. |
| `XAI_FACT_CHECK_MODEL` | Optional live evidence-research model override; defaults to `grok-4.3` and must support Responses `web_search` and structured output. |
| `OPENAI_API_KEY` | OpenAI API key for legacy transcription fallback |
| `NEXT_PUBLIC_SENTRY_DSN` | Public Sentry DSN for browser errors, replay, and feedback |
| `SENTRY_DSN` | Server-side Sentry DSN, usually the same project DSN |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Optional source map upload during Vercel builds |
| `NEXT_PUBLIC_ENABLE_TRANSCRIPT_DIAGNOSTICS` | Set to `false` to stop including transcript/claim text in Sentry diagnostics. Defaults to enabled. |
| `NEXT_PUBLIC_TRANSCRIPT_DIAGNOSTIC_MAX_CHARS` | Max characters per transcript diagnostic field. Defaults to `4000`. |
| `NEXT_PUBLIC_SENTRY_ENABLE_LOGS` / `SENTRY_ENABLE_LOGS` | Set to `false` to disable structured Sentry logs for claim extraction and fact-check review. |

## Observability

Sentry is configured for client, server, edge, masked replay, structured pipeline logs, and manual session feedback. The Feedback button sends a Sentry feedback event with a JSON diagnostics attachment and requests replay inclusion, so bad sessions can still be investigated even when normal replay sampling misses them.

Transcript diagnostics are anonymous in the sense that the app does not attach a user account, name, or email. When `NEXT_PUBLIC_ENABLE_TRANSCRIPT_DIAGNOSTICS` is not `false`, users can control the Transcript diagnostics toggle in Settings. If enabled, Sentry breadcrumbs, structured logs, and feedback attachments can include recent transcript text and extracted claims to improve claim detection. Raw audio is not stored.

For claim-extraction review, search Sentry Logs for `area:fact-checker.pipeline` and messages such as `api.claim_extraction.completed`, `client.claim_extraction.completed`, and `api.fact_check.completed`. The shared `diagnosticSessionId` connects logs from the same browser session to any feedback attachment.

Stage logs include extraction batch IDs, claim/revision IDs, recognition delay,
queue wait, actual research start, retrieval time, assessment time, and completion.
Compare those stages separately when tuning latency; a slow verdict is different
from delayed claim recognition.

## Validation

```bash
npm test              # Deterministic pipeline/API regression tests; no paid calls or browser
npm run lint
npx tsc --noEmit
npm run test:browser  # UI and mocked microphone/Deepgram flows; install Playwright Chromium first
npm run build
```

Live API tests are opt-in through provider environment variables. The pipeline
regression tests mock providers and never require credentials.

## Architecture

```
Browser Mic → Deepgram finals → Batched extraction → Claim card
                                                    ↓
                           xAI web search → Cited assessment → Verdict
```

See [REPORT.md](REPORT.md) for detailed technical documentation.

## License

MIT
