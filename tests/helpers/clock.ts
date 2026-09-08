/** Deterministic timers for pipeline state tests; no browser or model required. */
export class TestClock {
  now = 10_000;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  private id = 0;
  setTimer = (callback: () => void, delay = 0): ReturnType<typeof setTimeout> => {
    const id = ++this.id;
    this.tasks.set(id, { at: this.now + Number(delay), callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimer = (id: ReturnType<typeof setTimeout> | undefined) => { this.tasks.delete(Number(id)); };

  async advance(ms: number) {
    const end = this.now + ms;
    for (let count = 0; count < 10_000; count++) {
      const next = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { this.now = end; await settle(); return; }
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
      await settle();
    }
    throw new Error("Timer loop did not settle");
  }


}

export async function settle() { for (let index = 0; index < 15; index++) await Promise.resolve(); }
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
