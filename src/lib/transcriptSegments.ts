export interface TranscriptSegmentMetadata {
  /** Identifies audio, not wording: repeated speech has a different ID. */
  segmentId: string;
  /** Approximate wall-clock time of the last spoken word in this segment. */
  speechEndAt: number;
  receivedAt: number;
}

export interface FinalTranscriptSegment extends TranscriptSegmentMetadata {
  text: string;
}

export interface DeepgramTranscriptResult {
  type: "Results";
  channel_index?: number[];
  start: number;
  duration: number;
  is_final: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript: string;
      words?: Array<{
        word: string;
        punctuated_word?: string;
        start: number;
        end: number;
      }>;
    }>;
  };
}

interface AudioRange {
  start: number;
  end: number;
}

function audioRange(result: DeepgramTranscriptResult): AudioRange | null {
  if (!Number.isFinite(result.start) || !Number.isFinite(result.duration) ||
      result.start < 0 || result.duration <= 0) return null;
  return {
    start: Math.round(result.start * 1000),
    end: Math.round((result.start + result.duration) * 1000),
  };
}

/**
 * Deepgram's is_final results are immutable for their audio range. Interim
 * hypotheses are display-only; UtteranceEnd is a silence signal, not a final.
 * Keep audio coverage so redelivery/overlap cannot append the same words, while
 * identical words spoken later still reach claim comparison downstream.
 */
export class TranscriptSegmentTracker {
  private readonly finalized = new Map<number, AudioRange[]>();
  private interim: DeepgramTranscriptResult | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly captureStartedAt: number
  ) {}

  private unseen(result: DeepgramTranscriptResult) {
    const range = audioRange(result);
    const alternative = result.channel?.alternatives?.[0];
    if (!range || !alternative?.transcript.trim()) return null;
    const channel = result.channel_index?.[0] ?? 0;
    const covered = this.finalized.get(channel) ?? [];
    const overlaps = covered.some((other) => other.start < range.end && other.end > range.start);
    if (covered.some((other) => other.start <= range.start && other.end >= range.end)) return null;

    const words = alternative.words?.filter((word) =>
      Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start
    );
    let text = alternative.transcript.trim();
    let speechEnd = words?.length ? words[words.length - 1].end * 1000 : range.end;
    if (overlaps) {
      // Never guess a text offset from a revised transcript. Word timestamps
      // let us retain just the newly finalized suffix (or an uncovered gap).
      const newWords = words?.filter((word) => {
        const midpoint = (word.start + word.end) * 500;
        return !covered.some((other) => midpoint >= other.start && midpoint < other.end);
      });
      if (!newWords?.length) return null;
      text = newWords.map((word) => word.punctuated_word || word.word).join(" ").trim();
      speechEnd = newWords[newWords.length - 1].end * 1000;
    }
    if (!text) return null;
    return { channel, range, text, speechEnd };
  }

  get interimText(): string {
    return this.interim ? this.unseen(this.interim)?.text ?? "" : "";
  }

  clearInterim(): void {
    this.interim = null;
  }

  consume(result: DeepgramTranscriptResult, receivedAt: number): FinalTranscriptSegment | null {
    if (!result.is_final) {
      this.interim = result;
      return null;
    }
    const unseen = this.unseen(result);
    const range = audioRange(result);
    if (!range) return null;
    const channel = result.channel_index?.[0] ?? 0;
    // An empty authoritative final also clears an earlier, mistaken preview.
    const ranges = [...(this.finalized.get(channel) ?? []), range].sort((a, b) => a.start - b.start);
    const merged: AudioRange[] = [];
    for (const next of ranges) {
      const last = merged[merged.length - 1];
      if (last && next.start <= last.end) last.end = Math.max(last.end, next.end);
      else merged.push({ ...next });
    }
    this.finalized.set(channel, merged);
    if (!unseen) return null;

    const { text, speechEnd } = unseen;

    return {
      text,
      segmentId: `${this.sessionId}:${channel}:${range.start}-${range.end}`,
      speechEndAt: Math.min(receivedAt, this.captureStartedAt + speechEnd),
      receivedAt,
    };
  }
}

interface DrainableSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: "close", listener: () => void): void;
}

export const TRANSCRIPTION_DRAIN_TIMEOUT_MS = 1500;

/** Stop audio first, send its last chunk, then let the provider finalize it. */
export function drainTranscriptionSocket(
  socket: DrainableSocket,
  audioDrained: Promise<unknown>,
  timeoutMs = TRANSCRIPTION_DRAIN_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve) => {
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      socket.removeEventListener("close", finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (socket.readyState < 2) socket.close(1000);
      finish();
    }, timeoutMs);
    socket.addEventListener("close", finish);
    if (socket.readyState >= 2) {
      finish();
      return;
    }
    void audioDrained.then(() => {
      if (complete) return;
      if (socket.readyState === 1) {
        // CloseStream flushes remaining audio and returns final Results before
        // closing. Closing the WebSocket here would discard that response.
        socket.send(JSON.stringify({ type: "CloseStream" }));
      } else {
        if (socket.readyState === 0) socket.close(1000);
        finish();
      }
    }).catch(() => {
      if (socket.readyState < 2) socket.close(1000);
      finish();
    });
  });
}
