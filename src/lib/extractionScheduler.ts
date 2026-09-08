import { getExtractionDelayMs, isDisputeCue, isExplicitVerifyCue } from "./claimProcessing";
import { PipelineRequestError, withAbort } from "./claimQueue";

export interface TranscriptInput {
  text: string;
  receivedAt: number;
  speechEndAt?: number;
  segmentId?: string;
}

export interface ExtractionBatch {
  id: string;
  sequence: number;
  newText: string;
  recentContext: string;
  speechEndAt?: number;
  receivedAt: number;
  newestReceivedAt: number;
  hasDispute: boolean;
  hasExplicitVerify: boolean;
}

export interface ExtractionState {
  status: "idle" | "waiting" | "extracting" | "retrying" | "failed";
  error?: string;
  pendingChars: number;
}

interface SchedulerOptions {
  extract: (batch: ExtractionBatch, signal: AbortSignal) => Promise<void | { pendingFragment?: string }>;
  onState: (state: ExtractionState) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  minIntervalMs?: number;
}

/** One ordered extraction at a time; new speech is retained and coalesced while busy. */
export class ExtractionScheduler {
  private pending: TranscriptInput[] = [];
  private history: TranscriptInput[] = [];
  private contextBeforePending = "";
  private fragment?: { input: TranscriptInput; context: string };
  private active?: { batch: ExtractionBatch; controller: AbortController; attempt: number };
  private failed?: { batch: ExtractionBatch; attempt: number };
  private timer?: ReturnType<typeof setTimeout>;
  private dueAt = 0;
  private nextStartAt = 0;
  private sequence = 0;
  private disposed = false;
  private now: () => number;
  private setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private clearTimer: (timer: ReturnType<typeof setTimeout> | undefined) => void;

  constructor(private options: SchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  push(input: TranscriptInput) {
    if (this.disposed || !input.text.trim()) return;
    const before = this.history.filter(chunk => this.now() - chunk.receivedAt < 90_000);
    if (!this.pending.length) {
      this.contextBeforePending = this.fragment?.context ?? before.map(chunk => chunk.text).join(" ").slice(-4000);
      if (this.fragment) {
        this.pending.push({ ...this.fragment.input, receivedAt: input.receivedAt });
        this.fragment = undefined;
      }
    }
    this.history = [...before, input];
    this.pending.push(input);
    const explicit = this.pending.some(chunk => isExplicitVerifyCue(chunk.text));
    this.dueAt = Math.min(this.now() + getExtractionDelayMs(input.text, explicit), this.pending[0].receivedAt + 900);
    this.schedule();
  }

  flush() {
    this.dueAt = this.now();
    this.schedule();
  }

  retry() {
    if (!this.failed || this.active) return;
    this.failed.attempt = 0;
    this.nextStartAt = Math.max(this.nextStartAt, this.now());
    this.schedule(true);
  }

  snapshot() {
    return {
      pendingText: [this.fragment?.input.text, ...this.pending.map(chunk => chunk.text)].filter(Boolean).join(" "),
      activeBatchId: this.active?.batch.id,
      failedBatchId: this.failed?.batch.id,
    };
  }

  dispose() {
    this.disposed = true;
    this.clearTimer(this.timer);
    this.active?.controller.abort();
  }

  private publish(status: ExtractionState["status"], error?: string) {
    if (!this.disposed) this.options.onState({ status, error, pendingChars: this.snapshot().pendingText.length });
  }

  private schedule(retryFailed = false) {
    if (this.disposed || this.active) return;
    this.clearTimer(this.timer);
    if (this.failed && this.failed.attempt >= 2 && !retryFailed) {
      this.publish("failed", "Claim detection paused after a connection problem. Retry to process the retained speech.");
      return;
    }
    if (!this.failed && !this.pending.length) { this.publish("idle"); return; }
    this.publish(this.failed ? "retrying" : "waiting");
    const wait = Math.max(0, this.nextStartAt - this.now(), this.failed ? 0 : this.dueAt - this.now());
    this.timer = this.setTimer(() => void this.run(), wait);
  }

  private async run() {
    if (this.disposed || this.active) return;
    let batch: ExtractionBatch;
    let attempt = 0;
    if (this.failed) {
      ({ batch, attempt } = this.failed);
      this.failed = undefined;
    } else {
      // Preserve whole segments and bound each request, retaining later speech for the next batch.
      const chunks: TranscriptInput[] = [];
      let chars = 0;
      while (this.pending.length && (chars < 2400 || !chunks.length)) {
        const chunk = this.pending.shift()!;
        chunks.push(chunk);
        chars += chunk.text.length;
      }
      if (!chunks.length) return;
      const newText = chunks.map(chunk => chunk.text).join(" ");
      const sequence = ++this.sequence;
      batch = {
        id: `batch-${sequence}`, sequence, newText,
        recentContext: this.contextBeforePending,
        speechEndAt: chunks[0].speechEndAt, receivedAt: chunks[0].receivedAt,
        newestReceivedAt: chunks[chunks.length - 1].receivedAt,
        hasDispute: isDisputeCue(newText), hasExplicitVerify: isExplicitVerifyCue(newText),
      };
      this.contextBeforePending = `${batch.recentContext} ${newText}`.trim().slice(-4000);
    }
    const controller = new AbortController();
    this.active = { batch, controller, attempt: attempt + 1 };
    const startedAt = this.now();
    // Below the server's 30 requests/minute limit even during continuous fragmented speech.
    this.nextStartAt = startedAt + (this.options.minIntervalMs ?? 2100);
    const timeout = this.setTimer(() => controller.abort(new PipelineRequestError("Claim detection timed out.", 504)), 8000);
    this.publish("extracting");
    this.options.log?.("extraction.started", { batchId: batch.id, sequence: batch.sequence, waitMs: startedAt - batch.receivedAt });
    try {
      const result = await withAbort(this.options.extract(batch, controller.signal), controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      const fragment = result?.pendingFragment?.trim();
      // Only retain verbatim unfinished speech. Do not re-extract until fresh speech arrives.
      if (fragment && batch.newText.endsWith(fragment)) {
        const context = `${batch.recentContext} ${batch.newText.slice(0, -fragment.length)}`.trim().slice(-4000);
        const input = { text: fragment, receivedAt: batch.newestReceivedAt, speechEndAt: batch.speechEndAt };
        if (this.pending.length) {
          this.pending.unshift({ ...input, receivedAt: this.pending[0].receivedAt });
          this.contextBeforePending = context;
        } else this.fragment = { input, context };
      }
      this.options.log?.("extraction.completed", { batchId: batch.id, sequence: batch.sequence, durationMs: this.now() - startedAt });
    } catch (error) {
      if (this.disposed) return;
      const status = error instanceof PipelineRequestError ? error.status : 0;
      const retryable = [0, 408, 429, 500, 502, 503, 504].includes(status)
        && (!(error instanceof PipelineRequestError) || error.retryable !== false);
      this.failed = { batch, attempt: retryable ? attempt + 1 : 2 };
      this.nextStartAt = Math.max(this.nextStartAt, this.now() + (error instanceof PipelineRequestError ? error.retryAfterMs : 1000));
      this.options.log?.("extraction.failed", { batchId: batch.id, status, attempt: attempt + 1 });
    } finally {
      this.clearTimer(timeout);
      this.active = undefined;
      this.schedule();
    }
  }
}
