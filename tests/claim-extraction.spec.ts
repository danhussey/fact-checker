import { test, expect } from "@playwright/test";
import { POST } from "../src/app/api/extract-claims/route";
import {
  buildExtractionPrompt,
  createExtractionHandler,
  prepareExtractionInput,
  validateCandidates,
  type ClaimCandidate,
  type ExtractionInput,
} from "../src/lib/claimExtraction";
import { areClaimsEquivalent, claimFactsDiffer, extractQuantities } from "../src/lib/claimComparison";
import { normalizeClaim } from "../src/lib/claimProcessing";

const request = (body: unknown, signal?: AbortSignal) => new Request("http://localhost/api/extract-claims", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
});
const input = (claim = "The policy increases employment") => prepareExtractionInput({
  newText: claim, knownClaims: [{ id: "policy", claim: "The policy increases employment" }],
});

test.describe("Shared conservative claim identity", () => {
  test("formatting and number/unit equivalents reuse an identity", () => {
    for (const [a, b] of [
      ["Smoking is harmful", "Smoking is harmful."],
      ["Unemployment is 3.50 percent", "Unemployment is 3.5%."],
      ["Unemployment is .5 percent", "Unemployment is 0.5%."],
      ["The tower is twenty five feet tall", "The tower is 25 ft tall"],
      ["It costs $5 million", "It costs 5,000,000 dollars"],
      ["It costs five million dollars", "It costs 5000000 dollars"],
      ["Smoking isn't safe", "Smoking is not safe"],
      ["There are 1234567890123456 stars", "There are 1,234,567,890,123,456 stars"],
    ]) {
      expect(areClaimsEquivalent(a, b), `${a} / ${b}`).toBe(true);
      expect(claimFactsDiffer(a, b), `${a} / ${b}`).toBe(false);
    }
  });

  test("changed payload, properties, scope and roles are never deterministic repeats", () => {
    for (const [a, b] of [
      ["Unemployment is 3.5%", "Unemployment is 35%"],
      ["Unemployment is .5%", "Unemployment is 5%"],
      ["There are 5 million residents", "There are 5 billion residents"],
      ["Smoking is harmful", "Smoking is not harmful"],
      ["Smoking is harmful", "Smoking isn't harmful"],
      ["The policy increases employment", "The policy increases wages"],
      ["The policy increases employment", "The policy decreases employment"],
      ["All birds fly", "Some birds fly"],
      ["The funding is per capita", "The funding is total"],
      ["Apple bought Microsoft", "Microsoft bought Apple"],
      ["France exports cars to Germany", "Germany exports cars to France"],
      ["The tax rate is 3.5% in France", "The tax rate is 3.5% in Germany"],
      ["The deficit is -3.5 billion dollars", "The deficit is 3.5 billion dollars"],
      ["There are 1234567890123456 stars", "There are 1234567890123457 stars"],
      ["The rate is 5%", "The rate is 5% in 2024"],
      ["Australia has 5 states", "Australia has 5 states and 2 territories"],
    ]) {
      expect(areClaimsEquivalent(a, b), `${a} / ${b}`).toBe(false);
      expect(claimFactsDiffer(a, b), `${a} / ${b}`).toBe(true);
    }
    expect(normalizeClaim("3.5%")).not.toEqual(normalizeClaim("35%"));
    expect([...extractQuantities("five million and six billion")]).toEqual(["5000000", "6000000000"]);
  });

  test("word overlap or containment cannot establish equivalence", () => {
    expect(areClaimsEquivalent("The policy increases employment", "The policy increases employment for young adults")).toBe(false);
    expect(areClaimsEquivalent("They get more funding", "Indigenous Australians receive more funding")).toBe(false);
  });
});

test.describe("Extraction contract and failure handling", () => {
  test("prompt isolates fresh speech and bounds context without duplication", () => {
    const prepared = prepareExtractionInput({ newText: "The rate is 3.5%.", recentContext: `${"Earlier context. ".repeat(1000)}The rate is 3.5%.` });
    expect(prepared.recentContext.length).toBeLessThanOrEqual(4000);
    const prompt = JSON.parse(buildExtractionPrompt(prepared));
    expect(prompt["NEW TEXT"]).toBe("The rate is 3.5%.");
    expect(prompt["CONTEXT FOR REFERENCES ONLY"]).not.toContain("The rate is 3.5%.");
  });

  test("keeps request identity through completion and failure for stage correlation", async () => {
    const body = { newText: "Earth orbits the Sun once per year.", requestId: "batch-7", sequence: 7 };
    let completed: ExtractionInput | undefined;
    let failed: ExtractionInput | undefined;
    const success = createExtractionHandler({ extract: async () => [], onComplete: (input) => { completed = input; } });
    expect(await (await success(request(body))).json()).toMatchObject({ requestId: "batch-7", sequence: 7 });
    expect(completed).toMatchObject({ requestId: "batch-7", sequence: 7 });
    const failure = createExtractionHandler({ extract: async () => { throw new Error("failure"); }, onError: (_error, input) => { failed = input; } });
    expect(await (await failure(request(body))).json()).toMatchObject({ requestId: "batch-7", sequence: 7, code: "extraction_failed" });
    expect(failed).toMatchObject({ requestId: "batch-7", sequence: 7 });
    expect((await success(request({ ...body, sequence: "7" }))).status).toBe(400);
  });

  test("legacy checkedClaims are accepted but repeats have explicit identities", async () => {
    const handler = createExtractionHandler({ extract: async () => [{ claim: "Cats are mammals.", relationship: "new" }] });
    const response = await handler(request({ text: "Cats are mammals.", checkedClaims: ["Cats are mammals"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claims: [], candidates: [{ claim: "Cats are mammals.", relationship: "repeat", relatedClaimId: "legacy-0" }],
    });
  });

  test("accepts meaningful paraphrases and explicit revisions, rejects unknown IDs", () => {
    const candidates: ClaimCandidate[] = [
      { claim: "The policy boosts job creation", relationship: "repeat", relatedClaimId: "policy" },
      { claim: "The policy increases wages", relationship: "revision", relatedClaimId: "policy" },
      { claim: "The new budget is 5 billion dollars", relationship: "repeat", relatedClaimId: "invented" },
    ];
    const validated = validateCandidates(candidates, input());
    expect(validated[0]).toMatchObject({ relationship: "repeat", relatedClaimId: "policy" });
    expect(validated[1]).toMatchObject({ relationship: "revision", relatedClaimId: "policy" });
    expect(validated[2]).toEqual({ claim: "The new budget is 5 billion dollars", relationship: "new" });
  });

  test("height and weight paraphrases remain repeats without merging other properties", () => {
    for (const [original, repeated] of [
      ["The tower is 25 meters tall", "The tower has a height of 25 meters"],
      ["The parcel weighs 25 kilograms", "The parcel has a weight of 25 kilograms"],
    ]) {
      const prepared = prepareExtractionInput({ newText: repeated, knownClaims: [{ id: "measurement", claim: original }] });
      expect(claimFactsDiffer(original, repeated)).toBe(false);
      expect(validateCandidates([{ claim: repeated, relationship: "repeat", relatedClaimId: "measurement" }], prepared)[0].relationship).toBe("repeat");
    }
    expect(claimFactsDiffer("The tower has a height of 25 meters", "The tower has a width of 25 meters")).toBe(true);
    expect(claimFactsDiffer("The parcel weighs 25 kilograms", "The parcel weighs 35 kilograms")).toBe(true);
  });

  test("model repeat mistakes cannot swallow changed numbers or properties", () => {
    for (const claim of ["The policy increases wages", "The policy does not increase employment"]) {
      expect(validateCandidates([{ claim, relationship: "repeat", relatedClaimId: "policy" }], input(claim)))
        .toEqual([{ claim, relationship: "new" }]);
    }
    const prepared = prepareExtractionInput({ newText: "The rate is 35%", knownClaims: [{ id: "rate", claim: "The rate is 3.5%" }] });
    expect(validateCandidates([{ claim: "The rate is 35%", relationship: "repeat", relatedClaimId: "rate" }], prepared)[0].relationship).toBe("new");
  });

  test("explicit recheck returns repeated claim, normal repetition cannot force checks", async () => {
    const extract = async () => [{ claim: "The policy increases employment", relationship: "repeat" as const, relatedClaimId: "policy", forceCheck: true }];
    const handler = createExtractionHandler({ extract });
    const normal = await (await handler(request(input()))).json();
    expect(normal.claims).toEqual([]);
    expect(normal.candidates[0].forceCheck).toBeUndefined();
    const forced = await (await handler(request({ ...input(), newText: "Fact check that again" }))).json();
    expect(forced.forcedClaims).toEqual(["The policy increases employment"]);
    expect(forced.candidates[0].forceCheck).toBe(true);
  });

  test("short assertions reach the model; incomplete numeric phrases have no fallback", async () => {
    const seen: string[] = [];
    const handler = createExtractionHandler({ extract: async (prepared) => { seen.push(prepared.newText); return []; } });
    for (const newText of ["Ice melts", "The tower is 300"]) {
      const response = await handler(request({ newText }));
      expect(await response.json()).toMatchObject({ claims: [], candidates: [] });
    }
    expect(seen).toEqual(["Ice melts", "The tower is 300"]);
  });

  test("retains only an actual unfinished new-text suffix for a later continuation", async () => {
    for (const [fragment, expected] of [
      ["The tower is 300", "The tower is 300"],
      ["The tower is  300", "The tower is 300"],
      ["The tower is 400", null],
      ["Previous assertion", null],
      ["It is 3.5%", null],
    ]) {
      const handler = createExtractionHandler({ extract: async () => ({ candidates: [], pendingFragment: fragment }) });
      const response = await handler(request({ newText: "Birds have feathers. The tower is 300", recentContext: "Previous assertion" }));
      expect(await response.json()).toMatchObject({ candidates: [], pendingFragment: expected });
    }
  });

  test("validates request data before model invocation", async () => {
    let calls = 0;
    const handler = createExtractionHandler({ extract: async () => { calls += 1; return []; } });
    expect((await handler(request({ newText: { invalid: true } }))).status).toBe(400);
    expect((await handler(request({ newText: "x", knownClaims: [{ claim: "missing ID" }] }))).status).toBe(400);
    expect(calls).toBe(0);
  });

  test("provider failure and rate limiting return retryable failures, not empty success", async () => {
    for (const [error, status, code] of [
      [new Error("provider unavailable"), 502, "extraction_failed"],
      [Object.assign(new Error("limited"), { statusCode: 429 }), 429, "rate_limited"],
    ] as const) {
      const handler = createExtractionHandler({ extract: async () => { throw error; } });
      const response = await handler(request({ newText: "The tower is 300 feet tall" }));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, retryable: true });
      if (status === 429) expect(response.headers.get("Retry-After")).toBe("2");
    }
  });

  test("permanent provider failures do not retry and rate-limit delays survive", async () => {
    for (const statusCode of [400, 401, 403, 404, 422]) {
      const handler = createExtractionHandler({ extract: async () => { throw Object.assign(new Error("rejected"), { statusCode }); } });
      const response = await handler(request({ newText: "Earth orbits the Sun once per year." }));
      expect(response.status).toBe(statusCode === 401 || statusCode === 403 ? 503 : 502);
      expect(await response.json()).toMatchObject({ retryable: false });
    }
    for (const delay of ["30", "Wed, 09 Sep 2026 01:00:00 GMT"]) {
      const handler = createExtractionHandler({ extract: async () => { throw Object.assign(new Error("limited"), { statusCode: 429, responseHeaders: { "retry-after": delay } }); } });
      const response = await handler(request({ newText: "Earth orbits the Sun once per year." }));
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe(delay);
      expect(await response.json()).toMatchObject({ retryable: true });
    }
    const missingKey = createExtractionHandler({ extract: async () => { throw Object.assign(new Error("missing key"), { name: "AI_LoadAPIKeyError" }); } });
    expect(await (await missingKey(request({ newText: "Earth orbits the Sun once per year." }))).json()).toMatchObject({ code: "extraction_unavailable", retryable: false });
  });

  test("deadline terminates a stalled extraction and propagates abort to the provider", async () => {
    let signal: AbortSignal | undefined;
    const handler = createExtractionHandler({ deadlineMs: 15, extract: async (_: ExtractionInput, incoming: AbortSignal) => {
      signal = incoming;
      return new Promise<ClaimCandidate[]>(() => {});
    } });
    const response = await handler(request({ newText: "The tower is 300 feet tall" }));
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(await response.json()).toMatchObject({ code: "extraction_timeout", retryable: true });
  });

  test("client cancellation cancels model execution and is not retryable", async () => {
    const controller = new AbortController();
    const handler = createExtractionHandler({ extract: async () => {
      controller.abort();
      return new Promise<ClaimCandidate[]>(() => {});
    } });
    const response = await handler(request({ newText: "The tower is 300 feet tall" }, controller.signal));
    expect(response.status).toBe(499);
    expect(await response.json()).toMatchObject({ code: "cancelled", retryable: false });
  });
});

test("production extraction route sends a bounded non-reasoning structured request with no SDK retries", async () => {
  // Mock only the provider transport; exercise the actual route, SDK schema
  // validation, prompt construction, candidate validation and response mapping.
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-extraction-key";
  const sent: Record<string, unknown>[] = [];
  let limited = false;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    expect(init?.signal).toBeDefined();
    if (limited) return Response.json({ error: { message: "Rate limited", type: "rate_limit_error" } }, { status: 429 });
    return Response.json({
      id: "mock-extraction", object: "chat.completion", created: 1, model: "grok-4.3",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ pendingFragment: null, candidates: [
        { claim: "The rate is 35%", relationship: "repeat", relatedClaimId: "rate", forceCheck: false },
      ] }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
    });
  }) as typeof fetch;
  try {
    const response = await POST(request({ newText: "The rate is 35%", knownClaims: [{ id: "rate", claim: "The rate is 3.5%" }] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ candidates: [{ claim: "The rate is 35%", relationship: "new" }], claims: ["The rate is 35%"] });
    expect(sent[0]).toMatchObject({ model: process.env.XAI_EXTRACTION_MODEL || "grok-4.3", response_format: { type: "json_schema" } });
    // xAI SDK releases use either Chat Completions token-limit field.
    // Require an explicit bound regardless of that wire-format difference.
    const tokenLimits = [sent[0].max_tokens, sent[0].max_completion_tokens].filter((limit) => limit !== undefined);
    expect(tokenLimits.length).toBeGreaterThan(0);
    for (const limit of tokenLimits) expect(limit).toBe(2400);
    if (!process.env.XAI_EXTRACTION_MODEL || process.env.XAI_EXTRACTION_MODEL === "grok-4.3") expect(sent[0].reasoning_effort).toBe("none");
    limited = true;
    const failed = await POST(request({ newText: "The rate is 35%" }));
    expect(failed.status).toBe(429);
    expect(sent).toHaveLength(2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = originalKey;
  }
});
