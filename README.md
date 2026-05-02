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
4. Each claim is verified and rated (true, false, mostly true, etc.)

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
| `DEEPGRAM_API_KEY` | Deepgram API key for streaming transcription |
| `XAI_API_KEY` | xAI API key for Grok |
| `OPENAI_API_KEY` | OpenAI API key for legacy transcription fallback |
| `NEXT_PUBLIC_SENTRY_DSN` | Public Sentry DSN for browser errors, replay, and feedback |
| `SENTRY_DSN` | Server-side Sentry DSN, usually the same project DSN |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Optional source map upload during Vercel builds |
| `NEXT_PUBLIC_ENABLE_TRANSCRIPT_DIAGNOSTICS` | Set to `false` to stop including transcript/claim text in Sentry diagnostics. Defaults to enabled. |
| `NEXT_PUBLIC_TRANSCRIPT_DIAGNOSTIC_MAX_CHARS` | Max characters per transcript diagnostic field. Defaults to `4000`. |

## Observability

Sentry is configured for client, server, edge, masked replay, and manual session feedback. The Feedback button sends a Sentry feedback event with a JSON diagnostics attachment and requests replay inclusion, so bad sessions can still be investigated even when normal replay sampling misses them.

Transcript diagnostics are anonymous in the sense that the app does not attach a user account, name, or email. When `NEXT_PUBLIC_ENABLE_TRANSCRIPT_DIAGNOSTICS` is not `false`, Sentry breadcrumbs and feedback attachments can include recent transcript text and extracted claims to improve claim detection. Raw audio is not stored.

## Architecture

```
Browser Mic → Deepgram → Transcript → Grok (extract) → Grok (verify) → UI
```

See [REPORT.md](REPORT.md) for detailed technical documentation.

## License

MIT
