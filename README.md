# Fact Checker

[![CI](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/danhussey/fact-checker/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-vercel-black)](https://fact-checker-theta.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Real-time fact-checking PWA. Listens to audio, extracts claims, and fact-checks them using AI.

**[Live Demo](https://fact-checker-theta.vercel.app)**

## How It Works

1. Click "Start Listening" to capture audio from your microphone
2. Speech is transcribed in real-time via OpenAI Whisper
3. AI extracts fact-checkable claims from the transcript
4. Each claim is verified and rated (true, false, mostly true, etc.)

## Stack

- **Next.js 16** - App Router
- **OpenAI Whisper** - Speech-to-text
- **xAI Grok** - Claim extraction & fact-checking
- **Vercel AI SDK** - Structured outputs
- **Vercel** - Deployment

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
| `OPENAI_API_KEY` | OpenAI API key for Whisper transcription |
| `XAI_API_KEY` | xAI API key for Grok |

## Architecture

```
Browser Mic → Whisper → Transcript → Grok (extract) → Grok (verify) → UI
```

See [REPORT.md](REPORT.md) for detailed technical documentation.

## License

MIT
