import { test, expect } from "@playwright/test";
import { ClaimQueue, PipelineRequestError } from "../src/lib/claimQueue";
import type { FactCheck, StructuredFactCheck } from "../src/lib/types";
import { TestClock, deferred, settle } from "./helpers/clock";

const verdict: StructuredFactCheck = { verdict: "true", confidence: 4, whatsTrue: [], whatsWrong: [], context: [], sources: [] };
let clock: TestClock;
let queues: ClaimQueue[];
test.beforeEach(() => { clock = new TestClock(); queues = []; });
test.afterEach(async () => { queues.forEach(queue => queue.dispose()); await settle(); });

function setup() {
  const requests: { claim: string; signal: AbortSignal; result: ReturnType<typeof deferred<StructuredFactCheck>> }[] = [];
  let checks: FactCheck[] = [];
  let id = 0;
  const queue = new ClaimQueue({
    now: () => clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, createId: () => `claim-${++id}`, onChange: value => { checks = value; },
    verify: (claim, _context, signal) => {
      const result = deferred<StructuredFactCheck>(); requests.push({ claim, signal, result }); return result.promise;
    },
  });
  queues.push(queue);
  const submit = (claim: string, sequence = clock.now) => queue.submit({ claim, relationship: "new" }, { context: "", sequence });
  return { queue, requests, submit, checks: () => checks };
}

test("formatting repeats reuse the running request and completed result", async () => {
  const { submit, requests, checks } = setup();
  submit("The tower is 25 meters tall");
  submit("The tower is 25 metres tall.");
  expect(requests).toHaveLength(1);
  requests[0].result.resolve(verdict); await settle();
  await clock.advance(6 * 60_000);
  submit("The tower is twenty five meters tall");
  expect(requests).toHaveLength(1);
  expect(checks()).toHaveLength(1);
  expect(checks()[0].status).toBe("done");
});

test("different decimal, scale and negation assertions are each checked", async () => {
  const { submit, requests, checks } = setup();
  for (const claim of ["Unemployment is 3.5 percent", "Unemployment is 35 percent", "The project costs 5 million dollars", "The project costs 5 billion dollars", "Smoking is harmful", "Smoking is not harmful"]) {
    submit(claim);
    requests[requests.length - 1].result.resolve(verdict); await settle();
  }
  expect(requests).toHaveLength(6);
  expect(checks()).toHaveLength(6);
});

test("two jobs run concurrently; a correction cancels obsolete work and takes priority", async () => {
  const { queue, submit, requests, checks } = setup();
  const id = submit("The tower is 25 meters tall")!;
  submit("Cats are mammals"); submit("Water contains hydrogen");
  expect(requests).toHaveLength(2);
  expect(checks().find(check => check.claim === "Water contains hydrogen")?.status).toBe("queued");
  queue.submit({ claim: "The tower is 35 meters tall", relationship: "revision", relatedClaimId: id }, { context: "Actually 35", sequence: clock.now + 1 });
  await settle();
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[2].claim).toBe("The tower is 35 meters tall");
  requests[0].result.resolve({ ...verdict, verdict: "false" }); await settle();
  expect(checks().find(check => check.id === id)?.result).toBeNull();
  requests[2].result.resolve(verdict); await settle();
  expect(checks().find(check => check.id === id)?.result?.verdict).toBe("true");
  expect(requests[3].claim).toBe("Water contains hydrogen");
});

test("semantic repeats reuse a check but changed factual anchors cannot", async () => {
  const { queue, submit, requests } = setup();
  const id = submit("The tower is 25 meters tall")!;
  queue.submit({ claim: "The tower has a height of 25 meters", relationship: "repeat", relatedClaimId: id }, { context: "", sequence: clock.now });
  expect(requests).toHaveLength(1);
  queue.submit({ claim: "The tower is 35 meters tall", relationship: "repeat", relatedClaimId: id }, { context: "", sequence: clock.now });
  expect(requests).toHaveLength(2);
});

test("stale correction cannot replace a newer utterance", async () => {
  const { queue, submit, requests } = setup();
  const id = submit("The tower is 35 meters tall", 20)!;
  queue.submit({ claim: "The tower is 25 meters tall", relationship: "revision", relatedClaimId: id }, { context: "", sequence: 10 });
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
});

test("timeouts fail visibly and remain eligible for a manual retry", async () => {
  const { queue, submit, requests, checks } = setup();
  const id = submit("Cats are mammals")!;
  await clock.advance(48_000);
  expect(requests[0].signal.aborted).toBe(true);
  expect(checks()[0].status).toBe("failed");
  expect(queue.knownClaims()).toEqual([]);
  queue.retry(id);
  expect(requests).toHaveLength(2);
  requests[1].result.resolve(verdict); await settle();
  expect(checks()[0].status).toBe("done");
});

test("429 honors Retry-After without occupying a research worker", async () => {
  const { submit, requests, checks } = setup();
  submit("Cats are mammals");
  requests[0].result.reject(new PipelineRequestError("Rate limited", 429, 5000)); await settle();
  expect(checks()[0].status).toBe("retrying");
  submit("Water contains hydrogen");
  expect(requests).toHaveLength(1);
  expect(checks().filter(check => check.status === "checking")).toHaveLength(0);
  await clock.advance(4999); expect(requests).toHaveLength(1);
  await clock.advance(1); expect(requests).toHaveLength(3);
  expect(requests[1].claim).toBe("Cats are mammals");
});

test("a failed refresh does not keep an old success in checked-claim memory", async () => {
  const { queue, submit, requests, checks } = setup();
  const id = submit("Cats are mammals")!;
  requests[0].result.resolve(verdict); await settle();
  queue.submit({ claim: "Cats are mammals", relationship: "repeat", relatedClaimId: id, forceCheck: true }, { context: "", sequence: clock.now });
  requests[1].result.reject(new PipelineRequestError("Timed out", 504)); await settle();
  expect(checks()[0].status).toBe("failed");
  expect(queue.knownClaims()).toEqual([]);
});

test("nonretryable provider configuration errors do not start another paid check", async () => {
  const { submit, requests, checks } = setup();
  submit("Cats are mammals");
  requests[0].result.reject(new PipelineRequestError("Research is not configured", 503, 0, false)); await settle();
  await clock.advance(60_000);
  expect(requests).toHaveLength(1);
  expect(checks()[0].status).toBe("failed");
});

test("rapid corrections run only the latest revision while unrelated research continues", async () => {
  const { queue, submit, requests, checks } = setup();
  const id = submit("The tower is 25 meters tall")!;
  submit("Cats are mammals");
  for (const [sequence, height] of [[1, 35], [2, 45], [3, 55]]) {
    queue.submit({ claim: `The tower is ${height} meters tall`, relationship: "revision", relatedClaimId: id }, {
      context: "A spoken correction", sequence: clock.now + sequence,
    });
  }
  await settle();
  expect(requests.map(request => request.claim)).toEqual([
    "The tower is 25 meters tall", "Cats are mammals", "The tower is 55 meters tall",
  ]);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  requests[2].result.resolve(verdict);
  await settle();
  requests[0].result.resolve({ ...verdict, verdict: "false" });
  await settle();
  expect(checks().find(check => check.id === id)).toMatchObject({
    claim: "The tower is 55 meters tall", status: "done", result: { verdict: "true" },
  });
  expect(checks()).toHaveLength(2);
});

test("exhausted transient retries release the worker and a later mention can recover the claim", async () => {
  const { queue, submit, requests, checks } = setup();
  const id = submit("Cats are mammals")!;
  requests[0].result.reject(new PipelineRequestError("Unavailable", 503));
  await settle();
  await clock.advance(1000);
  expect(requests).toHaveLength(2);
  requests[1].result.reject(new PipelineRequestError("Still unavailable", 503));
  await settle();
  await clock.advance(60_000);
  expect(requests).toHaveLength(2);
  expect(queue.snapshot().activeCount).toBe(0);
  expect(queue.knownClaims()).toEqual([]);
  expect(checks()[0].status).toBe("failed");
  expect(submit("Cats are mammals.")).toBe(id);
  requests[2].result.resolve(verdict);
  await settle();
  expect(checks()).toHaveLength(1);
  expect(checks()[0].status).toBe("done");
});

test("disposing the session aborts running checks and never starts queued work or accepts late results", async () => {
  const { queue, submit, requests, checks } = setup();
  submit("Cats are mammals");
  submit("Water contains hydrogen");
  submit("Earth orbits the Sun");
  const lastPublished = checks();
  queue.dispose();
  expect(requests.every(request => request.signal.aborted)).toBe(true);
  requests.forEach(request => request.result.resolve(verdict));
  await settle();
  await clock.advance(60_000);
  expect(requests).toHaveLength(2);
  expect(checks()).toBe(lastPublished);
});
