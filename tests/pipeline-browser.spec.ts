import { test, expect, type Page, type Route } from "@playwright/test";

interface Candidate {
  claim: string;
  relationship: "new" | "repeat" | "revision";
  relatedClaimId?: string;
  forceCheck?: boolean;
}
interface ExtractionRequest {
  id: string;
  newText: string;
  recentContext: string;
  knownClaims: Array<{ id: string; claim: string }>;
}
interface VerificationRequest {
  claim: string;
  claimId: string;
  revision: number;
}
interface MockExtraction {
  status?: number;
  headers?: Record<string, string>;
  candidates?: Candidate[];
  pendingFragment?: string | null;
}
interface SpeechResult {
  type: "Results";
  channel_index: number[];
  start: number;
  duration: number;
  is_final: boolean;
  speech_final: boolean;
  channel: { alternatives: Array<{
    transcript: string;
    words: Array<{ word: string; punctuated_word: string; start: number; end: number }>;
  }> };
}

declare global {
  interface Window {
    __pipelineBrowser: {
      emit: (result: SpeechResult) => number;
      utteranceEnd: () => void;
      stopFinal?: SpeechResult;
      socketUrls: string[];
      sent: string[];
      recorderSliceMs: number;
      tracksStopped: number;
      requests: Array<VerificationRequest & { startedAt: number; aborted: boolean }>;
    };
  }
}

function speech(text: string, start: number, duration = 2, final = true): SpeechResult {
  const tokens = text.trim().split(/\s+/);
  return {
    type: "Results", channel_index: [0, 1], start, duration,
    is_final: final, speech_final: final,
    channel: { alternatives: [{
      transcript: text,
      words: tokens.map((token, index) => ({
        word: token.toLowerCase().replace(/[.!?,]$/, ""), punctuated_word: token,
        start: start + duration * index / tokens.length,
        end: start + duration * (index + 1) / tokens.length,
      })),
    }] },
  };
}

function verdict(evidence = "Verified browser test evidence.", value = "true") {
  return {
    verdict: value, confidence: 4, whatsTrue: [evidence], whatsWrong: [],
    context: [], sources: [{ name: "Test reference", url: "https://example.com/reference" }],
  };
}

const cards = (page: Page) => page.locator("div.rounded-2xl.bg-surface");
const cardFor = (page: Page, claim: string) => cards(page).filter({ has: page.getByText(claim, { exact: true }) });

test("native browser timers mount and complete concurrent manual checks without runtime errors", async ({ page }) => {
  // Keep native timers here: clock mocks can conceal an invalid Window receiver.
  const errors: string[] = [];
  const requests: Route[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("fact-checker:show-text-input", "true"));
  await page.route("**/api/fact-check", route => { requests.push(route); });
  await page.goto("/");
  for (const claim of ["Cats are mammals", "Water contains hydrogen"]) {
    await page.getByTestId("claim-input").fill(claim);
    await page.getByTestId("claim-submit").click();
  }
  await expect.poll(() => requests.length).toBe(2);
  for (const route of requests) await route.fulfill({ json: verdict() });
  await expect(page.getByText("True", { exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

async function prepareBrowser(
  page: Page,
  extract: (body: ExtractionRequest, attempt: number) => MockExtraction
) {
  const extractions: ExtractionRequest[] = [];
  const verifications: Array<{ body: VerificationRequest; route: Route }> = [];
  // These tests exercise the actual React hooks and browser fetch cancellation.
  // Every paid API and the microphone are replaced before the page is loaded.
  await page.route("**/api/deepgram-token", route => route.fulfill({
    json: { token: "browser-test-token", tokenType: "bearer", expiresIn: 30 },
  }));
  await page.route("**/api/extract-claims", async route => {
    const body = route.request().postDataJSON() as ExtractionRequest;
    extractions.push(body);
    const response = extract(body, extractions.length);
    await route.fulfill({
      status: response.status ?? 200,
      headers: response.headers,
      json: response.status && response.status >= 400
        ? { error: "Temporary detection failure" }
        : { candidates: response.candidates ?? [], pendingFragment: response.pendingFragment ?? null },
    });
  });
  await page.route("**/api/fact-check", route => {
    // Hold each request until the test releases it; this makes concurrency and
    // cancellation observable without relying on arbitrary response delays.
    verifications.push({ body: route.request().postDataJSON() as VerificationRequest, route });
  });
  await page.addInitScript(() => {
    const state: Window["__pipelineBrowser"] = {
      emit: () => { throw new Error("Mock speech socket is not open"); },
      utteranceEnd: () => {},
      socketUrls: [], sent: [], recorderSliceMs: 0, tracksStopped: 0, requests: [],
    };
    window.__pipelineBrowser = state;
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-AU" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { state.tracksStopped += 1; } }],
        }),
      },
    });

    class MockSpeechSocket extends EventTarget {
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(public url: string) {
        super();
        state.emit = result => {
          if (this.readyState !== 1) throw new Error("Mock speech socket is not open");
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(result) }));
          return Date.now();
        };
        state.utteranceEnd = () => this.onmessage?.(new MessageEvent("message", {
          data: JSON.stringify({ type: "UtteranceEnd", channel: [0, 1], last_word_end: 2 }),
        }));
        state.socketUrls.push(url);
        queueMicrotask(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          this.onopen?.(new Event("open"));
        });
      }
      send(data: string | ArrayBuffer) {
        state.sent.push(typeof data === "string" ? data : "audio");
        if (typeof data === "string" && JSON.parse(data).type === "CloseStream") {
          queueMicrotask(() => {
            if (state.stopFinal) state.emit(state.stopFinal);
            this.close();
          });
        }
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        const event = new CloseEvent("close", { code: 1000, wasClean: true });
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }
    // Keep Next.js's development/HMR WebSockets working normally.
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        return String(args[0]).startsWith("wss://api.deepgram.com/")
          ? new MockSpeechSocket(String(args[0]))
          : Reflect.construct(target, args);
      },
    });
    class MockRecorder {
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported() { return true; }
      start(timeslice: number) { this.state = "recording"; state.recorderSliceMs = timeslice; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["final captured audio"]) });
          this.onstop?.();
        });
      }
    }
    window.MediaRecorder = MockRecorder as unknown as typeof MediaRecorder;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/fact-check")) {
        const body = JSON.parse(String(init?.body)) as VerificationRequest;
        const item = { ...body, startedAt: Date.now(), aborted: Boolean(init?.signal?.aborted) };
        state.requests.push(item);
        init?.signal?.addEventListener("abort", () => { item.aborted = true; }, { once: true });
      }
      return nativeFetch(input, init);
    };
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Start listening", exact: true }).click();
  await expect(page.getByText("Listening for factual claims", { exact: true })).toBeVisible();
  return { extractions, verifications };
}

async function emit(page: Page, result: SpeechResult) {
  return page.evaluate(value => window.__pipelineBrowser.emit(value), result);
}

async function nextFinal(page: Page, result: SpeechResult) {
  await emit(page, result);
  await page.clock.fastForward(2300);
}

test.describe("Live claim pipeline in the browser", () => {
  test("starts a visible check promptly from a final sentence, never from an interim or silence event", async ({ page }) => {
    const claim = "Smoking is harmful.";
    const { extractions, verifications } = await prepareBrowser(page, body => ({
      candidates: [{ claim: body.newText, relationship: "new" }],
    }));
    await emit(page, speech("Smoking is not harmful", 0, 2, false));
    await page.evaluate(() => window.__pipelineBrowser.utteranceEnd());
    await page.clock.runFor(1500);
    expect(extractions).toHaveLength(0);

    const finalizedAt = await emit(page, speech(claim, 0));
    await page.clock.runFor(250);
    await expect.poll(() => verifications.length).toBe(1);
    await expect(cardFor(page, claim).getByText("Checking...", { exact: true })).toBeVisible();
    expect(extractions[0].newText).toBe(claim);
    expect(extractions[0].recentContext).toBe("");
    const observation = await page.evaluate(() => ({
      request: window.__pipelineBrowser.requests[0],
      url: window.__pipelineBrowser.socketUrls[0],
      slice: window.__pipelineBrowser.recorderSliceMs,
    }));
    expect(observation.request.startedAt - finalizedAt).toBeLessThan(1000);
    const params = new URL(observation.url).searchParams;
    expect(params.get("no_delay")).toBe("true");
    expect(params.get("endpointing")).toBe("300");
    expect(params.get("language")).toBe("en-AU");
    expect(observation.slice).toBe(100);
    await verifications[0].route.fulfill({ json: verdict() });
    await expect(cardFor(page, claim).getByText("True", { exact: true })).toBeVisible();
  });

  test("starts two distinct checks concurrently and shows the third as queued", async ({ page }) => {
    const claims = ["Cats are mammals.", "Mars has two moons.", "Water contains hydrogen."];
    const { verifications } = await prepareBrowser(page, () => ({
      candidates: claims.map(claim => ({ claim, relationship: "new" })),
    }));
    await emit(page, speech(claims.join(" "), 0, 5));
    await page.clock.runFor(250);
    await expect.poll(() => verifications.length).toBe(2);
    await expect(cards(page)).toHaveCount(3);
    await expect(cardFor(page, claims[0]).getByText("Checking...", { exact: true })).toBeVisible();
    await expect(cardFor(page, claims[1]).getByText("Checking...", { exact: true })).toBeVisible();
    await expect(cardFor(page, claims[2]).getByText("Queued…", { exact: true })).toBeVisible();
    await verifications[0].route.fulfill({ json: verdict() });
    await expect.poll(() => verifications.length).toBe(3);
    await expect(cardFor(page, claims[2]).getByText("Checking...", { exact: true })).toBeVisible();
    await Promise.all(verifications.slice(1).map(item => item.route.fulfill({ json: verdict() })));
    await expect(cards(page).getByText("True", { exact: true })).toHaveCount(3);
  });

  test("reuses exact and semantic repeats, then cancels a superseded check and displays only the correction", async ({ page }) => {
    const original = "The policy increases employment.";
    const paraphrase = "The policy creates additional jobs.";
    const corrected = "The policy decreases employment.";
    const { extractions, verifications } = await prepareBrowser(page, (body, attempt) => {
      if (attempt === 1) return { candidates: [{ claim: original, relationship: "new" }] };
      const id = body.knownClaims.find(item => item.claim === original)?.id;
      expect(id).toBeTruthy();
      return { candidates: [{
        claim: attempt === 2 ? original : attempt === 3 ? paraphrase : corrected,
        relationship: attempt < 4 ? "repeat" : "revision", relatedClaimId: id,
      }] };
    });
    await nextFinal(page, speech(original, 0));
    await expect.poll(() => verifications.length).toBe(1);
    const initialId = verifications[0].body.claimId;

    // Same provider range is transport redelivery and never reaches extraction.
    await nextFinal(page, speech(original, 0));
    expect(extractions).toHaveLength(1);
    // The same words spoken again are recognized, then reuse the active check.
    await nextFinal(page, speech(original, 3));
    await expect.poll(() => extractions.length).toBe(2);
    await expect(page.getByText("Recognizing claims…", { exact: true })).not.toBeVisible();
    await nextFinal(page, speech(paraphrase, 6));
    await expect.poll(() => extractions.length).toBe(3);
    await expect(page.getByText("Recognizing claims…", { exact: true })).not.toBeVisible();
    expect(verifications).toHaveLength(1);
    await expect(cards(page)).toHaveCount(1);
    expect(await page.evaluate(() => window.__pipelineBrowser.requests[0].aborted)).toBe(false);

    await nextFinal(page, speech(`Actually, ${corrected}`, 9));
    await expect.poll(() => verifications.length).toBe(2);
    expect(verifications[1].body).toMatchObject({ claimId: initialId, claim: corrected, revision: 2 });
    expect(await page.evaluate(() => window.__pipelineBrowser.requests[0].aborted)).toBe(true);
    await verifications[1].route.fulfill({ json: verdict("Latest correction evidence.", "false") });
    // A late response from the cancelled revision must never replace the new one.
    await verifications[0].route.fulfill({ json: verdict("Obsolete evidence must not appear.") }).catch(() => {});
    await expect(cards(page)).toHaveCount(1);
    await expect(cardFor(page, corrected).getByText("False", { exact: true })).toBeVisible();
    await cardFor(page, corrected).getByRole("button").first().click();
    await expect(page.getByText("Latest correction evidence.", { exact: true })).toBeVisible();
    await expect(page.getByText("Obsolete evidence must not appear.", { exact: true })).not.toBeVisible();
  });

  test("carries a pending number into a later finalized unit without checking an incomplete claim", async ({ page }) => {
    const prefix = "The tower is 300";
    const complete = `${prefix} meters tall.`;
    const { extractions, verifications } = await prepareBrowser(page, (body, attempt) => attempt === 1
      ? { pendingFragment: prefix }
      : { candidates: [{ claim: body.newText, relationship: "new" }] });
    await emit(page, speech(prefix, 0, 1.5));
    await page.clock.runFor(500);
    await expect.poll(() => extractions.length).toBe(1);
    await expect(page.getByText("Recognizing claims…", { exact: true })).not.toBeVisible();
    await page.clock.fastForward(2300);
    expect(extractions).toHaveLength(1);
    expect(verifications).toHaveLength(0);
    await emit(page, speech("meters tall.", 1.5, 0.7));
    await page.clock.runFor(250);
    await expect.poll(() => verifications.length).toBe(1);
    expect(extractions[1].newText).toBe(complete);
    expect(extractions[1].recentContext).not.toContain(prefix);
    await expect(cardFor(page, complete)).toBeVisible();
  });

  test("retains speech through rate limits and a failed retry, then resumes using Retry detection", async ({ page }) => {
    const first = "Cats are mammals.";
    const second = "Mars has two moons.";
    const { extractions, verifications } = await prepareBrowser(page, (body, attempt) => {
      if (attempt === 1) return { status: 429, headers: { "Retry-After": "1" } };
      if (attempt === 2) return { status: 502 };
      return { candidates: [{ claim: body.newText, relationship: "new" }] };
    });
    await emit(page, speech(first, 0));
    await page.clock.runFor(250);
    await expect(page.getByText("Reconnecting to claim detection…", { exact: true })).toBeVisible();
    await emit(page, speech(second, 3));
    await page.clock.fastForward(2300);
    await expect(page.getByRole("button", { name: "Retry detection", exact: true })).toBeVisible();
    expect(extractions).toHaveLength(2);
    expect(extractions[1]).toMatchObject({ id: extractions[0].id, newText: first });
    expect(verifications).toHaveLength(0);

    await page.getByRole("button", { name: "Retry detection", exact: true }).click();
    await page.clock.fastForward(2300);
    await expect.poll(() => verifications.length).toBe(1);
    expect(extractions[2]).toMatchObject({ id: extractions[0].id, newText: first });
    await page.clock.fastForward(2300);
    await expect.poll(() => verifications.length).toBe(2);
    expect(extractions[3].newText).toBe(second);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Retry detection", exact: true })).not.toBeVisible();
  });

  test("stops the microphone immediately and processes the provider's corrected final during drain", async ({ page }) => {
    const claim = "The rate is 3.5%.";
    const { extractions, verifications } = await prepareBrowser(page, body => ({
      candidates: [{ claim: body.newText, relationship: "new" }],
    }));
    await emit(page, speech("The rate is 35", 0, 2, false));
    await page.evaluate(result => { window.__pipelineBrowser.stopFinal = result; }, speech(claim, 0));
    await page.getByRole("button", { name: "Stop listening", exact: true }).click();
    await page.clock.runFor(250);
    await expect.poll(() => verifications.length).toBe(1);
    expect(extractions[0].newText).toBe(claim);
    const stopped = await page.evaluate(() => ({
      sent: window.__pipelineBrowser.sent, tracks: window.__pipelineBrowser.tracksStopped,
    }));
    expect(stopped.tracks).toBe(1);
    expect(stopped.sent).toEqual(["audio", '{"type":"CloseStream"}']);
    await expect(page.getByRole("button", { name: "Start listening", exact: true })).toBeVisible();
    await expect(cardFor(page, claim)).toBeVisible();
  });
});
