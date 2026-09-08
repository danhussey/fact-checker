import { test, expect } from "@playwright/test";
import {
  drainTranscriptionSocket,
  TranscriptSegmentTracker,
  type DeepgramTranscriptResult,
} from "../src/lib/transcriptSegments";

function result(
  text: string,
  start: number,
  duration: number,
  isFinal = true,
  words?: Array<{ word: string; start: number; end: number; punctuated_word?: string }>
): DeepgramTranscriptResult {
  return {
    type: "Results",
    channel_index: [0, 1],
    start,
    duration,
    is_final: isFinal,
    channel: { alternatives: [{ transcript: text, words }] },
  };
}

test.describe("Final transcription sequencing", () => {
  test("emits identical speech at different audio ranges, but not transport redelivery", () => {
    const tracker = new TranscriptSegmentTracker("session-a", 100_000);
    const first = result("Unemployment is 3.5%.", 0, 2);
    const one = tracker.consume(first, 102_300);
    expect(one).toMatchObject({ text: "Unemployment is 3.5%.", speechEndAt: 102_000, receivedAt: 102_300 });
    expect(tracker.consume(first, 102_500)).toBeNull();
    const two = tracker.consume(result("Unemployment is 3.5%.", 4, 2), 106_300);
    expect(two?.text).toBe(one?.text);
    expect(two?.segmentId).not.toBe(one?.segmentId);
    expect(two?.speechEndAt).toBe(106_000);
  });

  test("uses final wording once when interim numbers change, including after a silence signal", () => {
    const tracker = new TranscriptSegmentTracker("session-b", 100_000);
    expect(tracker.consume(result("Unemployment is 35", 0, 2, false), 102_200)).toBeNull();
    expect(tracker.interimText).toBe("Unemployment is 35");
    // UtteranceEnd carries no authoritative transcript and therefore does not
    // consume or emit the displayed hypothesis. The next final can correct it.
    const final = tracker.consume(result("Unemployment is 3.5%.", 0, 2), 103_400);
    expect(final?.text).toBe("Unemployment is 3.5%.");
    expect(tracker.interimText).toBe("");
    expect(tracker.consume(result("Unemployment is 35", 0, 2, false), 103_500)).toBeNull();
    expect(tracker.interimText).toBe("");
  });

  test("keeps final number and unit fragments unchanged for the extraction assembler", () => {
    const tracker = new TranscriptSegmentTracker("session-c", 100_000);
    const emitted = [
      tracker.consume(result("The tower is 300", 0, 1.5), 101_800),
      tracker.consume(result("meters tall.", 1.5, 0.7), 102_500),
    ];
    expect(emitted.map((segment) => segment?.text).join(" ")).toBe("The tower is 300 meters tall.");
    expect(emitted.map((segment) => segment?.speechEndAt)).toEqual([101_500, 102_200]);
  });

  test("reconciles overlapping finalized ranges with word timestamps", () => {
    const tracker = new TranscriptSegmentTracker("session-d", 100_000);
    const first = tracker.consume(result("The tower is 300", 0, 1.5), 101_700);
    const second = tracker.consume(result("300 meters tall.", 1, 1.4, true, [
      { word: "300", start: 1, end: 1.5 },
      { word: "meters", start: 1.5, end: 1.9 },
      { word: "tall", punctuated_word: "tall.", start: 1.9, end: 2.2 },
    ]), 102_700);
    expect(first?.text).toBe("The tower is 300");
    expect(second?.text).toBe("meters tall.");
    expect(second?.speechEndAt).toBe(102_200);
    expect(tracker.consume(result("The tower is 300 meters tall.", 0, 2.4), 102_900)).toBeNull();
  });

  test("does not append an ambiguous overlapping revision without word timestamps", () => {
    const tracker = new TranscriptSegmentTracker("session-e", 100_000);
    tracker.consume(result("The tower is 300", 0, 1.5), 101_700);
    expect(tracker.consume(result("The tower is 300 meters tall.", 0, 2.4), 102_700)).toBeNull();
  });

  test("keeps a later interim suffix while clearing the earlier finalized words", () => {
    const tracker = new TranscriptSegmentTracker("session-f", 100_000);
    tracker.consume(result("The tower is 300 meters", 0, 2, false, [
      { word: "The", start: 0, end: 0.2 },
      { word: "tower", start: 0.2, end: 0.7 },
      { word: "is", start: 0.7, end: 0.8 },
      { word: "300", start: 0.8, end: 1.5 },
      { word: "meters", start: 1.5, end: 2 },
    ]), 102_100);
    tracker.consume(result("The tower is 300", 0, 1.5), 102_200);
    expect(tracker.interimText).toBe("meters");
    tracker.consume(result("meters", 1.5, 0.5), 102_300);
    expect(tracker.interimText).toBe("");
  });

  test("an empty final clears a mistaken interim without emitting a claim", () => {
    const tracker = new TranscriptSegmentTracker("session-g", 100_000);
    tracker.consume(result("phantom words", 0, 2, false), 102_100);
    expect(tracker.consume(result("", 0, 2), 102_200)).toBeNull();
    expect(tracker.interimText).toBe("");
  });

  test("session IDs keep audio ranges distinct after restarting", () => {
    const first = new TranscriptSegmentTracker("session-a", 100_000).consume(result("It is 3.5%.", 0, 2), 102_300);
    const second = new TranscriptSegmentTracker("session-b", 200_000).consume(result("It is 3.5%.", 0, 2), 202_300);
    expect(first?.segmentId).not.toBe(second?.segmentId);
  });
});

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  forcedClose = false;
  private listeners = new Set<() => void>();
  send(data: string) { this.sent.push(data); }
  close() { this.forcedClose = true; this.serverClose(); }
  serverClose() { this.readyState = 3; for (const listener of this.listeners) listener(); }
  addEventListener(_type: "close", listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: "close", listener: () => void) { this.listeners.delete(listener); }
}

test.describe("Stopping transcription", () => {
  test("drains final recorder audio before asking the provider to finalize and close", async () => {
    const socket = new FakeSocket();
    let finishAudio!: () => void;
    const audioDrained = new Promise<void>((resolve) => { finishAudio = resolve; });
    let stopped = false;
    const drain = drainTranscriptionSocket(socket, audioDrained).then(() => { stopped = true; });
    await Promise.resolve();
    expect(socket.sent).toEqual([]);
    socket.sent.push("last audio chunk");
    finishAudio();
    await Promise.resolve();
    expect(socket.sent).toEqual(["last audio chunk", '{"type":"CloseStream"}']);
    expect(stopped).toBe(false);

    const tracker = new TranscriptSegmentTracker("session-stop", 100_000);
    tracker.consume(result("The rate is 35", 0, 2, false), 102_100);
    // The socket stays open for the provider's corrected final response.
    const final = tracker.consume(result("The rate is 3.5%.", 0, 2), 102_400);
    expect(final?.text).toBe("The rate is 3.5%.");
    socket.serverClose();
    await drain;
    expect(socket.forcedClose).toBe(false);
    expect(stopped).toBe(true);
  });

  test("bounds shutdown if the provider never acknowledges close", async () => {
    const socket = new FakeSocket();
    await drainTranscriptionSocket(socket, Promise.resolve(), 10);
    expect(socket.sent).toEqual(['{"type":"CloseStream"}']);
    expect(socket.forcedClose).toBe(true);
  });

  test("bounds shutdown even if final audio conversion never completes", async () => {
    const socket = new FakeSocket();
    await drainTranscriptionSocket(socket, new Promise(() => {}), 10);
    expect(socket.sent).toEqual([]);
    expect(socket.forcedClose).toBe(true);
  });
});
