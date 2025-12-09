# Real-Time Fact-Checker: Technical Report

## What It Does

A PWA that listens to live audio, transcribes speech, extracts factual claims, and fact-checks them in real-time using AI. Designed for evaluating claims during conversations, podcasts, or broadcasts.

**Live**: https://fact-checker-theta.vercel.app

---

## Architecture

```
Browser Mic → MediaRecorder → Whisper API → Transcript
                                              ↓
                              Grok (claim extraction)
                                              ↓
                              Grok (fact-checking) → UI
```

### Stack
- **Framework**: Next.js 16 (App Router)
- **Transcription**: OpenAI Whisper (`whisper-1`)
- **AI**: xAI Grok (`grok-3-fast`) via Vercel AI SDK
- **Deployment**: Vercel
- **PWA**: `@ducanh2912/next-pwa` with offline support

---

## Key Technical Decisions

### Structured Outputs
Used Vercel AI SDK's `generateObject()` with Zod schemas to get consistent JSON responses:

```typescript
const factCheckSchema = z.object({
  verdict: z.enum(["true", "mostly true", "half true", "mostly false", "false", "unverified"]),
  confidence: z.number().min(1).max(4),
  whatsTrue: z.array(z.string()).max(2),
  whatsWrong: z.array(z.string()).max(2),
  sources: z.array(z.object({ name: z.string(), url: z.string().optional() })).max(3),
});
```

### Duplicate Detection
Two-layer approach to prevent re-checking the same claim:
1. **Prompt-level**: LLM instructed to skip claims similar to already-checked list
2. **Post-filter**: 50% word overlap threshold with stop-word removal

### Context Window
5-minute rolling transcript buffer sent with each claim extraction request. Allows the AI to:
- Resolve pronouns and references
- Build complete claims from fragmented speech
- Verify claims about "what was just said"

### Whisper Hallucination Filtering
Whisper hallucinates on silence/ambient noise. Filtered via:
- Minimum file size threshold (8KB)
- Pattern matching for known hallucinations ("subscribe", "thank you for watching", emoji spam)
- Non-ASCII ratio checks

---

## Abuse Prevention

### Rate Limiting (Middleware)
```typescript
const RATE_LIMITS = {
  "/api/transcribe": 10,      // req/min - most expensive
  "/api/extract-claims": 30,
  "/api/fact-check": 30,
};
```
IP-based, in-memory sliding window. Returns 429 with `Retry-After` header.

### Request Logging
Structured logs for Vercel dashboard (IPs are SHA-256 hashed for privacy):
```
[api:fact-check] { ip: "a1b2c3d4e5f6", claimLen, hasContext }
[api:transcribe] { ip: "a1b2c3d4e5f6", size, textLen }
[rate-limit] { ip: "a1b2c3d4e5f6", endpoint, retryAfter }
```

### IP Anonymization
All IP addresses are hashed before logging or rate-limit tracking:
```typescript
function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}
```
Raw IPs are never stored.

---

## API Routes

| Endpoint | Purpose | Model |
|----------|---------|-------|
| `/api/transcribe` | Audio → text | OpenAI Whisper |
| `/api/extract-claims` | Text → fact-checkable claims | Grok 3 Fast |
| `/api/fact-check` | Claim → verdict + evidence | Grok 3 Fast |

---

## What Didn't Work

- **Grok 4.1 Fast**: Schema validation errors and 3+ minute response times. Reverted to Grok 3 Fast.
- **Perplexity**: Initially tested for fact-checking but switched to Grok for more direct verdicts.
- **Citation URLs**: AI models tend to hallucinate URLs. Source names are more reliable.

---

## Files Structure

```
src/
├── app/
│   ├── api/
│   │   ├── transcribe/route.ts    # Whisper integration
│   │   ├── extract-claims/route.ts # Claim extraction
│   │   └── fact-check/route.ts    # Fact-checking
│   ├── privacy/page.tsx           # Privacy policy
│   └── page.tsx                   # Main UI
├── hooks/
│   └── useContinuousListener.ts   # Audio capture + VAD
├── components/
│   ├── FactCheckCard.tsx          # Result display
│   └── VerdictBadge.tsx           # TRUE/FALSE badges
└── middleware.ts                  # Rate limiting
```

---

## Environment Variables

```
OPENAI_API_KEY=   # Whisper transcription
XAI_API_KEY=      # Grok (claims + fact-check)
```

---

## Future Considerations

- Switch to Groq Whisper (`whisper-large-v3-turbo`) for faster/better transcription
- Redis-backed rate limiting for multi-instance deployment
- Vercel AI Gateway integration for usage dashboard
