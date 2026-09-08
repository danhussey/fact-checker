import { test, expect } from "@playwright/test";
import { ExtractionScheduler, type ExtractionBatch, type ExtractionState } from "../src/lib/extractionScheduler";
import { PipelineRequestError } from "../src/lib/claimQueue";
import { TestClock, deferred, settle } from "./helpers/clock";

let clock: TestClock;
let schedulers: ExtractionScheduler[];
test.beforeEach(() => { clock = new TestClock(); schedulers = []; });
test.afterEach(async () => { schedulers.forEach(scheduler => scheduler.dispose()); await settle(); });

function setup() {
  const calls: { batch: ExtractionBatch; signal: AbortSignal; result: ReturnType<typeof deferred<void | { pendingFragment?: string }>> }[] = [];
  let state: ExtractionState = { status: "idle", pendingChars: 0 };
  const scheduler = new ExtractionScheduler({ now: () => clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onState: next => { state = next; },
    extract: (batch, signal) => { const result = deferred<void | { pendingFragment?: string }>(); calls.push({ batch, signal, result }); return result.promise; },
  });
  schedulers.push(scheduler);
  const say = (text: string) => scheduler.push({ text, receivedAt: clock.now, speechEndAt: clock.now - 100 });
  return { scheduler, calls, say, state: () => state };
}

test("completed sentence starts extraction promptly; following number/unit fragments coalesce", async () => {
  const { say, calls } = setup();
  say("Cats are mammals."); await clock.advance(120);
  expect(calls).toHaveLength(1);
  calls[0].result.resolve(); await settle();
  await clock.advance(2100);
  say("The project costs 25"); await clock.advance(300); say("million dollars."); await clock.advance(120);
  expect(calls[1].batch.newText).toBe("The project costs 25 million dollars.");
  expect(calls[1].batch.recentContext).toBe("Cats are mammals.");
});

test("continuous fragments cannot reset the batching deadline indefinitely", async () => {
  const { say, calls } = setup();
  for (let index = 0; index < 9; index++) { say("and"); await clock.advance(100); }
  expect(calls).toHaveLength(1);
  expect(calls[0].batch.newText.split(" ")).toHaveLength(9);
});

test("busy extraction retains speech in order and excludes new text from its context", async () => {
  const { say, calls } = setup();
  say("The tower is 25 meters tall."); await clock.advance(120);
  say("Actually it is 35 meters tall."); await clock.advance(3000);
  expect(calls).toHaveLength(1);
  calls[0].result.resolve(); await settle(); await clock.advance(0);
  expect(calls).toHaveLength(2);
  expect(calls[1].batch.newText).toBe("Actually it is 35 meters tall.");
  expect(calls[1].batch.recentContext).toBe("The tower is 25 meters tall.");
  expect(calls[1].batch.sequence).toBeGreaterThan(calls[0].batch.sequence);
});

test("rate limits retain the original batch, honor backoff, then process later speech", async () => {
  const { say, calls } = setup();
  say("Cats are mammals."); await clock.advance(120);
  calls[0].result.reject(new PipelineRequestError("Rate limited", 429, 5000)); await settle();
  say("Water contains hydrogen."); await clock.advance(4999); expect(calls).toHaveLength(1);
  await clock.advance(1); expect(calls[1].batch).toEqual(calls[0].batch);
  calls[1].result.resolve(); await settle(); await clock.advance(2100);
  expect(calls[2].batch.newText).toBe("Water contains hydrogen.");
});

test("a hung provider has a hard deadline and failed speech remains retryable", async () => {
  const { say, calls, state, scheduler } = setup();
  say("Cats are mammals."); await clock.advance(120);
  await clock.advance(8000); await clock.advance(0);
  expect(calls[0].signal.aborted).toBe(true);
  expect(calls).toHaveLength(2);
  await clock.advance(8000);
  expect(state().status).toBe("failed");
  scheduler.retry(); await clock.advance(0);
  expect(calls[2].batch.id).toBe(calls[0].batch.id);
  calls[2].result.resolve(); await settle();
  expect(state().status).toBe("idle");
});

test("request pacing stays under the server budget during many final segments", async () => {
  const { say, calls } = setup();
  for (let index = 0; index < 240; index++) {
    say(`Claim fragment ${index}.`);
    await clock.advance(250);
    calls.at(-1)?.result.resolve(); await settle();
  }
  expect(calls.length).toBeLessThanOrEqual(29);
  expect(calls.flatMap(call => call.batch.newText.match(/Claim fragment/g) ?? []).length).toBeGreaterThan(220);
});

test("an incomplete assertion survives a completed extraction until its delayed ending arrives", async () => {
  const { say, calls, scheduler } = setup();
  say("The tower is 300"); await clock.advance(450);
  calls[0].result.resolve({ pendingFragment: "The tower is 300" }); await settle();
  await clock.advance(5000);
  expect(calls).toHaveLength(1);
  expect(scheduler.snapshot().pendingText).toBe("The tower is 300");
  const continuationAt = clock.now;
  say("meters tall."); await clock.advance(120);
  expect(calls[1].batch.newText).toBe("The tower is 300 meters tall.");
  expect(calls[1].batch.recentContext).toBe("");
  expect(calls[1].batch.newestReceivedAt).toBe(continuationAt);
});

test("an unfinished suffix joins speech received while the previous extraction was busy", async () => {
  const { say, calls } = setup();
  say("Cats are mammals. The tower is 300"); await clock.advance(450);
  say("meters tall."); await clock.advance(500);
  calls[0].result.resolve({ pendingFragment: "The tower is 300" }); await settle();
  await clock.advance(2100);
  expect(calls[1].batch.newText).toBe("The tower is 300 meters tall.");
  expect(calls[1].batch.recentContext).toBe("Cats are mammals.");
});
