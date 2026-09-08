import { areClaimsEquivalent, claimFactsDiffer } from "./claimComparison";
import type { FactCheck, StructuredFactCheck } from "./types";

export interface ClaimCandidate {
  claim: string;
  relationship: "new" | "repeat" | "revision";
  relatedClaimId?: string;
  forceCheck?: boolean;
}

export interface ClaimSubmission {
  context: string;
  sequence: number;
  speechEndAt?: number;
  urgent?: boolean;
  forceCheck?: boolean;
}

interface ClaimJob {
  id: string;
  claim: string;
  context: string;
  revision: number;
  sequence: number;
  status: "queued" | "checking" | "retrying" | "done" | "failed";
  result: StructuredFactCheck | null;
  error?: string;
  updatedAt: number;
  lastMentionedAt: number;
  queuedAt: number;
  speechEndAt?: number;
  retryAt: number;
  attempts: number;
  urgent: boolean;
}

interface ClaimQueueOptions {
  verify: (claim: string, context: string, signal: AbortSignal, metadata: {
    claimId: string; revision: number; sequence: number;
  }) => Promise<StructuredFactCheck>;
  onChange: (checks: FactCheck[]) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  createId?: () => string;
  concurrency?: number;
}

export class PipelineRequestError extends Error {
  constructor(message: string, public status: number, public retryAfterMs = 0, public retryable?: boolean) {
    super(message);
    this.name = "PipelineRequestError";
  }
}

export function retryAfterMs(response: Response, now = Date.now()): number {
  const value = response.headers.get("Retry-After");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export async function withAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([task, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/** Session-local evidence jobs. Repetition never invalidates useful in-flight work. */
export class ClaimQueue {
  private jobs = new Map<string, ClaimJob>();
  private active = new Map<string, { revision: number; controller: AbortController }>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private blockedUntil = 0;
  private now: () => number;
  private setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private clearTimer: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  private createId: () => string;

  constructor(private options: ClaimQueueOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  knownClaims() {
    return [...this.jobs.values()]
      .filter(job => job.status !== "failed")
      .sort((a, b) => b.lastMentionedAt - a.lastMentionedAt)
      .slice(0, 80)
      .map(({ id, claim }) => ({ id, claim }));
  }

  snapshot() {
    return {
      queuedCount: [...this.jobs.values()].filter(job => job.status === "queued" || job.status === "retrying").length,
      activeCount: this.active.size,
      knownClaimCount: this.jobs.size,
    };
  }

  submit(candidate: ClaimCandidate, submission: ClaimSubmission): string | undefined {
    if (this.disposed || !candidate.claim.trim()) return;
    const claim = candidate.claim.trim();
    const now = this.now();
    const force = submission.forceCheck || candidate.forceCheck;
    let job = candidate.relatedClaimId ? this.jobs.get(candidate.relatedClaimId) : undefined;
    // A semantic repeat is allowed to bridge paraphrases, but never changed factual anchors.
    if (job && candidate.relationship === "repeat" && claimFactsDiffer(job.claim, claim)) job = undefined;
    if (candidate.relationship === "new") job = undefined;
    job ??= [...this.jobs.values()].find(record => areClaimsEquivalent(record.claim, claim));

    if (job && submission.sequence < job.sequence) {
      this.log("claim.stale_candidate_ignored", { claimId: job.id, sequence: submission.sequence });
      return job.id;
    }
    if (job) {
      const equivalent = areClaimsEquivalent(job.claim, claim) || candidate.relationship === "repeat";
      job.lastMentionedAt = now;
      // Explicit requests reuse an active check; after completion they request fresh evidence.
      if (equivalent && job.status !== "failed" && (!force || job.status !== "done")) {
        job.sequence = Math.max(job.sequence, submission.sequence);
        this.log("claim.reused", { claimId: job.id, revision: job.revision, status: job.status });
        return job.id;
      }
      this.active.get(job.id)?.controller.abort();
      job.revision += 1;
      Object.assign(job, {
        claim, context: submission.context, sequence: submission.sequence,
        status: "queued", result: null, error: undefined, updatedAt: now,
        queuedAt: now, speechEndAt: submission.speechEndAt, retryAt: 0, attempts: 0,
        urgent: true,
      });
    } else {
      job = {
        id: this.createId(), claim, context: submission.context, revision: 1,
        sequence: submission.sequence, status: "queued", result: null,
        updatedAt: now, lastMentionedAt: now, queuedAt: now,
        speechEndAt: submission.speechEndAt, retryAt: 0, attempts: 0,
        urgent: Boolean(submission.urgent || force),
      };
      this.jobs.set(job.id, job);
    }
    this.log("claim.queued", {
      claimId: job.id, revision: job.revision, sequence: job.sequence,
      recognitionMs: job.speechEndAt === undefined ? undefined : Math.max(0, now - job.speechEndAt),
    });
    this.publish();
    this.pump();
    return job.id;
  }

  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "failed") return;
    this.submit({ claim: job.claim, relationship: "revision", relatedClaimId: id }, {
      context: job.context, sequence: job.sequence, urgent: true, forceCheck: true,
    });
  }

  dispose() {
    this.disposed = true;
    this.clearTimer(this.retryTimer);
    for (const task of this.active.values()) task.controller.abort();
  }

  private log(event: string, data: Record<string, unknown>) {
    this.options.log?.(event, data);
  }

  private publish() {
    if (this.disposed) return;
    this.options.onChange([...this.jobs.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(job => ({
        id: job.id, claim: job.claim, result: job.result, error: job.error,
        isLoading: ["queued", "checking", "retrying"].includes(job.status),
        status: job.status, timestamp: new Date(job.updatedAt),
      })));
  }

  private pump() {
    if (this.disposed) return;
    this.clearTimer(this.retryTimer);
    if (this.blockedUntil > this.now()) {
      this.retryTimer = this.setTimer(() => this.pump(), this.blockedUntil - this.now());
      return;
    }
    const pending = [...this.jobs.values()]
      .filter(job => (job.status === "queued" || job.status === "retrying") && !this.active.has(job.id))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.queuedAt - b.queuedAt);
    for (const job of pending) {
      if (this.active.size >= (this.options.concurrency ?? 2)) break;
      if (job.retryAt <= this.now()) void this.run(job);
    }
    const retryAt = pending.filter(job => job.retryAt > this.now()).reduce((at, job) => Math.min(at, job.retryAt), Infinity);
    if (Number.isFinite(retryAt)) this.retryTimer = this.setTimer(() => this.pump(), Math.max(1, retryAt - this.now()));
  }

  private async run(job: ClaimJob) {
    const revision = job.revision;
    const controller = new AbortController();
    this.active.set(job.id, { revision, controller });
    job.status = "checking";
    job.attempts += 1;
    const startedAt = this.now();
    const timeout = this.setTimer(() => controller.abort(new PipelineRequestError("Verification timed out. Try again.", 504)), 48_000);
    this.log("fact_check.started", {
      claimId: job.id, revision, sequence: job.sequence,
      queueWaitMs: startedAt - job.queuedAt,
      speechToResearchMs: job.speechEndAt === undefined ? undefined : Math.max(0, startedAt - job.speechEndAt),
    });
    this.publish();
    try {
      const result = await withAbort(this.options.verify(job.claim, job.context, controller.signal, {
        claimId: job.id, revision, sequence: job.sequence,
      }), controller.signal);
      if (this.disposed || job.revision !== revision || controller.signal.aborted) return;
      job.result = result;
      job.status = "done";
      job.error = undefined;
      this.log("fact_check.completed", { claimId: job.id, revision, durationMs: this.now() - startedAt });
    } catch (error) {
      if (this.disposed || job.revision !== revision) return;
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      const status = failure instanceof PipelineRequestError ? failure.status : 0;
      const canRetry = job.attempts < 2 && [0, 429, 502, 503].includes(status)
        && (!(failure instanceof PipelineRequestError) || failure.retryable !== false);
      if (status === 429) this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(1000,
        failure instanceof PipelineRequestError ? failure.retryAfterMs : 0));
      if (canRetry) {
        job.status = "retrying";
        job.retryAt = this.now() + Math.max(1000, failure instanceof PipelineRequestError ? failure.retryAfterMs : 0);
      } else {
        job.status = "failed";
        job.error = failure instanceof Error ? failure.message : "Verification failed. Try again.";
      }
      this.log("fact_check.failed", { claimId: job.id, revision, status, retrying: canRetry });
    } finally {
      this.clearTimer(timeout);
      if (this.active.get(job.id)?.revision === revision) this.active.delete(job.id);
      this.publish();
      this.pump();
    }
  }
}
