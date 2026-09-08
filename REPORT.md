# Live claim recognition and evidence checking

## Runtime path

The browser sends ordered microphone chunks to Deepgram Nova 3. Only finalized
transcript ranges enter claim detection; interim words remain a display preview.
`no_delay=true` avoids entity-formatting waits, and 300 ms endpointing permits
short pauses. Audio timestamps distinguish transport redelivery from genuinely
repeated speech. Stop drains final recorder audio through `CloseStream`, bounded
to 1.5 seconds, with guards against stale sessions and late callbacks.

`ExtractionScheduler` coalesces finalized fragments, sends one ordered extraction
request at a time, and retains additional speech while busy. A completed sentence
normally dispatches after 120 ms; trailing numbers and clauses have longer short
windows. A 900 ms maximum batch age prevents indefinite debounce resets. Requests
start at least 2.1 seconds apart, remaining below the middleware's 30/minute/IP
budget. These are local scheduling bounds, not promises about provider latency.

Each batch contains fresh text and a snapshot of up to 4,000 characters from the
preceding 90 seconds. Fresh speech is not duplicated in history. An unfinished
suffix explicitly returned by extraction is retained and prepended when more
speech arrives, allowing “25 … million dollars” to survive across requests. Only
an actual suffix of the submitted text can be retained. Failed batches remain
available for retry instead of disappearing.

Extraction defaults to Grok 4.3 with reasoning disabled, zero SDK retries, and a
seven-second server deadline (eight-second browser deadline). Model output has
up to eight candidates, classified as `new`, `repeat`, or `revision`, with an
existing claim ID when applicable. Only fresh assertions are eligible; history
resolves references and continuations. Short complete assertions are permitted;
there is no numeric fallback that treats unfinished speech as a claim.

## Claim identity and corrections

`claimComparison.ts` is the shared source of deterministic equivalence and changed
fact guards. Formatting, equivalent number words and unit spelling can share an
identity. Decimal points, signs, scale, currency, negation, entity, property,
subject/object roles, comparison direction and scope must survive comparison.
Word overlap alone never establishes a duplicate.

The extraction model identifies semantic paraphrases. Both API and client validate
referenced IDs and veto repeat classifications when factual anchors differ. A
related assertion about another property is new. Only an actual correction or
replacement is a revision. Explicit requests can recheck completed claims; a
request already running is reused.

`ClaimQueue` keeps session-local identities, including recently mentioned completed
claims. Simple repetition does not expire a successful check after an arbitrary
five-minute timer. Changed facts are eligible immediately. A substantive revision
increments its generation, aborts obsolete work, and takes priority. Two research
workers prevent a slow claim monopolizing all verification. Stale generations
cannot update the displayed result. Timestamp ordering uses the newest segment
in a batch so a later spoken correction is not mistaken for an older manual claim.

The UI distinguishes queued, checking, retrying, completed and failed checks.
Failures are excluded from checked-claim memory and have an explicit Retry button.
429 responses impose a shared queue cooldown using `Retry-After`. Transient
network/502/503 failures get one retry unless the server marks them nonretryable.
A 45-second research timeout does not automatically launch another paid search;
the user can retry the failed card. The client imposes its own 48-second deadline.

## Evidence retrieval

Live `/api/fact-check` explicitly uses xAI Responses `web_search`, rather than
relying on model memory. Search receives only the resolved standalone claim and
the current date, not the raw transcript. Each attempt permits one search tool
call and asks for primary-source evidence, relevant contradictions and uncertainty.

Only provider citation metadata associated with a cited passage can become an
evidence source. Those passages are search-provider summaries, not independently
fetched page extracts. A second structured assessment sees those passages and
selects source IDs. Factual bullets must reference valid selected IDs, and the
server supplies source labels and URLs from the retrieved source records. Free-text
URLs and invented source IDs cannot become displayed citations. Insufficient
evidence returns `unverified`; infrastructure timeouts and provider errors return
failure statuses instead of a successfully checked verdict.

Retrieval and assessment share a 45-second deadline and propagate client
cancellation. There are no server retries multiplying the browser's retry policy.
`XAI_FACT_CHECK_MODEL` and `XAI_EXTRACTION_MODEL` optionally override the default
`grok-4.3`. Research uses the existing `XAI_API_KEY`. According to xAI's pricing at
implementation, web search costs $0.005 per tool invocation plus model token
charges; consult current pricing before changing budgets or concurrency.

The separate `/api/research/topic` is an admin topic-generation workflow. It is
not the live microphone pipeline and is not invoked for individual live claims.

## Observability and regression coverage

Measure separately:

1. Audio word end → finalized transcript receipt.
2. Transcript receipt → extraction start and completion.
3. Audio word end → claim queued/displayed.
4. Queue wait and audio word end → actual research start.
5. Retrieval, assessment and total research duration.

Logs use `diagnosticSessionId`, extraction request/batch ID and sequence, and claim
ID/revision. Transcript text remains governed by the existing diagnostics toggle.
No raw audio is logged or stored. Application state lives in the current page.

`npm test` runs deterministic tests without a browser or billable API calls. These
cover factual identity, semantic-repeat guards, production API payloads, deadline
and cancellation behavior, stale revisions, concurrent workers, retry recovery,
request budgets, unfinished-fragment retention, cited evidence and recording drain.
Browser tests exercise the actual React page with mocked microphone, WebSocket and
provider endpoints. The pipeline unit suite runs in CI alongside type checking,
linting and the production build.

An authorized one-claim provider smoke measured 982 ms for extraction and 18.868
seconds for grounded research (12.801 seconds retrieval, 6.065 seconds assessment).
It used one web search and returned NASA/ESA citations, costing $0.02236365 total
including extraction. These are individual provider-call measurements, not a
microphone-to-verdict benchmark or a guaranteed latency. Browser scheduling tests
use controlled provider responses, plus a separate native-timer regression.

## Provider references

- [Deepgram Smart Format and no_delay](https://developers.deepgram.com/docs/smart-format)
- [Deepgram endpointing](https://developers.deepgram.com/docs/endpointing)
- [xAI web search](https://docs.x.ai/developers/tools/web-search)
- [xAI citations](https://docs.x.ai/developers/tools/citations)
- [xAI model migration](https://docs.x.ai/developers/migration/may-15-retirement)
- [xAI pricing](https://docs.x.ai/developers/pricing)
