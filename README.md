# Fact Checker

[![CI](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-vercel-black)](https://fact-checker-theta.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Real-time fact-checking PWA for noisy live speech. It listens to audio, transcribes speech, extracts checkable claims, deduplicates repeated claims, and verifies them with structured model outputs.

**[Live Demo](https://fact-checker-theta.vercel.app)**

## Evaluation Angle

The hard problem is not drawing verdict cards in a browser. It is claim extraction under streaming, noisy, adversarial speech: sarcasm, self-correction, interruptions, ambiguous pronouns, repeated claims, and model-generated citations that may not exist.

The repository includes an offline eval scaffold in `evals/` for reviewing claim-extraction behavior without API keys. It measures:

- claim recall against labeled transcript snippets,
- duplicate extraction rate,
- unsupported or unverified verdict rate,
- mean reported latency.

```bash
npm run eval:claims
```

The starter transcript set covers sarcasm, self-correction, debate interruptions, ambiguous pronouns, and hallucinated citations. The example predictions file is intentionally small; replace it with exported model outputs to compare prompts or model versions.

## How It Works

1. Capture microphone audio in the browser.
2. Stream speech-to-text through Deepgram.
3. Maintain rolling transcript context for fragmented or referential speech.
4. Extract fact-checkable claims with a structured-output model call.
5. Suppress duplicates before verification.
6. Verify each claim and return a structured verdict, evidence summary, and source names.

## Stack

- **Next.js 16** - App Router
- **Deepgram** - Streaming speech-to-text
- **xAI Grok** - Claim extraction and fact-checking
- **Vercel AI SDK** - Structured outputs
- **Vercel** - Deployment
- **Sentry** - Error monitoring, masked replay, structured pipeline logs, and manual session diagnostics

## Quick Start

```bash
# Install
npm install

# Set up environment
cp .env.local.example .env.local
# Add your DEEPGRAM_API_KEY, OPENAI_API_KEY, and XAI_API_KEY

# Run
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DEEPGRAM_API_KEY` | Server-side Deepgram API key used to mint short-lived browser transcription tokens. Must have permission to call Deepgram `/v1/auth/grant`. |
| `XAI_API_KEY` | xAI API key for Grok |
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

## Architecture

```text
Browser Mic -> Deepgram -> Transcript -> Grok extract -> duplicate filter -> Grok verify -> UI
```

See [REPORT.md](REPORT.md) for detailed technical documentation.

## License

MIT
