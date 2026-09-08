import { test, expect } from "@playwright/test";
import { POST } from "../src/app/api/fact-check/route";
import { runGroundedFactCheck } from "../src/lib/groundedFactCheck";
import { FACT_CHECK_DEADLINE_MS } from "../src/lib/researchDeadline";

test.describe.configure({ mode: "serial" });

const url = "https://www.nasa.gov/earth/facts/";
const citation = { type: "url_citation", title: "NASA", url };
const research = {
  status: "completed",
  output: [
    { type: "web_search_call", status: "completed" },
    { type: "message", content: [{ type: "output_text", text: `Earth orbits the Sun once per year. [[1]](${url})`, annotations: [citation] }] },
  ],
  usage: { input_tokens: 100, output_tokens: 70, num_server_side_tools_used: 1 },
};
const assessment = {
  verdict: "true", confidence: 4, sourceIds: ["S1"],
  whatsTrue: [{ text: "Earth orbits the Sun annually", sourceId: "S1" }],
  whatsWrong: [], context: [], argument: null,
};
const assessmentResponse = (object = assessment) => ({
  status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(object) }] }],
});
const input = () => ({ claim: "Earth orbits the Sun", context: "PRIVATE CONVERSATION", claimId: "claim-1", revision: 2, requestId: "request-1", includeTranscriptDiagnostics: false });
const request = (body: unknown = input(), signal?: AbortSignal) => new Request("http://localhost/api/fact-check", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
});

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
let originalKey: string | undefined;
test.beforeEach(() => {
  originalKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key-never-sent";
  globalThis.fetch = async () => { throw new Error("Unexpected network request in test"); };
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  if (originalKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = originalKey;
});

test("actual POST performs required search before assessment and exposes only grounded sources", async () => {
  const calls: Array<{ endpoint: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined }> = [];
  globalThis.fetch = async (endpoint, init) => {
    calls.push({ endpoint: String(endpoint), body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json(calls.length === 1 ? research : assessmentResponse());
  };
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(await response.json()).toMatchObject({ verdict: "true", sources: [{ name: "NASA", url }] });
  expect(calls).toHaveLength(2);
  expect(calls[0].endpoint).toBe("https://api.x.ai/v1/responses");
  expect(calls[0].body).toMatchObject({ tools: [{ type: "web_search" }], tool_choice: "required", max_tool_calls: 1, store: false });
  expect(JSON.stringify(calls)).not.toContain("PRIVATE CONVERSATION");
  expect(calls[1].body).not.toHaveProperty("tools");
  expect(calls[1].body).toHaveProperty("text.format.type", "json_schema");
  expect(JSON.stringify(calls[1].body)).toContain("Earth orbits the Sun once per year.");
  expect(calls[1].signal).toBe(calls[0].signal);
});

test("actual POST distinguishes successful no-evidence search from upstream failure", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ...research, output: [research.output[0], {
    type: "message", content: [{ type: "output_text", text: "No relevant reliable evidence found.", annotations: [] }],
  }] }); };
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ verdict: "unverified", confidence: 1, sources: [] });
  expect(calls).toBe(1);
});

test("actual POST stops before assessment when search returns only a bibliography", async () => {
  let calls = 0;
  const title = "NASA Earth Planet Facts and Information";
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ...research, output: [research.output[0], {
      type: "message", content: [{ type: "output_text", text: `Source: [${title}](${url})`, annotations: [{ ...citation, title }] }],
    }] });
  };
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ verdict: "unverified", confidence: 1, sources: [] });
  expect(calls).toBe(1);
});

test("actual POST does not trust a model that invents citation IDs", async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? research : assessmentResponse({
    ...assessment, whatsTrue: [{ text: "An unsupported assertion", sourceId: "S99" }],
  }));
  const response = await POST(request());
  expect(await response.json()).toMatchObject({ verdict: "unverified", confidence: 1, sources: [] });
});

for (const status of [401, 429, 500, 503]) {
  test(`actual POST maps provider HTTP ${status} with appropriate retry policy`, async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: "upstream error" }, { status }); };
    const response = await POST(request());
    expect(response.status).toBe(status === 429 ? 429 : 503);
    const retryable = status === 429 || status >= 500;
    expect(response.headers.get("Retry-After")).toBe(retryable ? "2" : null);
    expect(await response.json()).toMatchObject({ code: "unavailable", retryable });
    expect(calls).toBe(1);
  });
}

test("actual POST refuses a response without completed search or with malformed assessment", async () => {
  globalThis.fetch = async () => Response.json({ ...research, output: [research.output[1]] });
  expect((await POST(request())).status).toBe(503);
  let calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? research : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not JSON" }] }] });
  expect((await POST(request())).status).toBe(503);
});

test("actual POST rejects incomplete or malformed provider completions without assessment", async () => {
  for (const body of [{ ...research, status: "incomplete" }, { ...research, status: "failed" }, { status: "completed", output: null }]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(body); };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unavailable", retryable: true });
    expect(calls).toBe(1);
  }
});

test("actual POST preserves upstream Retry-After seconds or date for queue cooldown", async () => {
  for (const retryAfter of ["30", "Wed, 09 Sep 2026 12:00:00 GMT"]) {
    globalThis.fetch = async () => Response.json({ error: "rate limit" }, { status: 429, headers: { "Retry-After": retryAfter } });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(retryAfter);
  }
});

test("actual POST returns HTTP504 rather than successful unverified on timeout", async () => {
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    originalSetTimeout(callback, ms === FACT_CHECK_DEADLINE_MS ? 5 : ms, ...args)) as typeof setTimeout;
  let providerSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_endpoint, init) => {
    providerSignal = init?.signal;
    return new Promise<Response>(() => {});
  };
  const response = await POST(request());
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ code: "timeout", retryable: true });
  expect(providerSignal?.aborted).toBe(true);
});

for (const phase of ["retrieval", "assessment"]) {
  test(`actual POST propagates cancellation during ${phase} and never completes obsolete work`, async () => {
    const controller = new AbortController();
    let calls = 0;
    let notifyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let providerSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (_endpoint, init) => {
      calls++;
      if (phase === "assessment" && calls === 1) return Response.json(research);
      providerSignal = init?.signal;
      notifyStarted();
      return new Promise<Response>(() => {});
    };
    const work = POST(request(input(), controller.signal));
    await started;
    controller.abort();
    const response = await work;
    expect(response.status).toBe(499);
    expect(providerSignal?.aborted).toBe(true);
    expect(calls).toBe(phase === "assessment" ? 2 : 1);
  });
}

test("deadline also covers an upstream response body that hangs", async () => {
  let providerSignal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = async (_endpoint, init) => {
    providerSignal = init?.signal;
    return new Response(new ReadableStream({ start() {} }));
  };
  await expect(runGroundedFactCheck({ claim: "Earth orbits the Sun", signal: new AbortController().signal, apiKey: "test", fetchImpl, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: "timeout" });
  expect(providerSignal?.aborted).toBe(true);
});

test("actual POST validates JSON and input and reports missing configuration without network", async () => {
  for (const body of [{}, { claim: " " }, { claim: "x".repeat(2001) }, { claim: "x", context: {} }, null]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect((await POST(new Request("http://localhost/api/fact-check", { method: "POST", body: "{" }))).status).toBe(400);
  delete process.env.XAI_API_KEY;
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "not_configured", retryable: false });
});
