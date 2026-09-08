export const FACT_CHECK_DEADLINE_MS = 45_000;

export class FactCheckServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "timeout" | "cancelled" | "unavailable" | "not_configured",
    public readonly providerStatus?: number,
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "FactCheckServiceError";
  }
}

/** One deadline for the entire operation, including response body reads and
 * transports that fail to observe AbortSignal. Always releases listeners/timers.
 */
export async function withResearchDeadline<T>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = FACT_CHECK_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new FactCheckServiceError("Request cancelled", "cancelled"));
  requestSignal.addEventListener("abort", cancel, { once: true });
  if (requestSignal.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(new FactCheckServiceError("Fact-check timed out", "timeout")), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
