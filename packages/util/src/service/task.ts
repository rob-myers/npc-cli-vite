import { pause } from "../legacy/generic";

/**
 * Async steps that `cancel` ends at once, e.g. on a jsh kill. Each wait rejects once it is cancelled,
 * and `run` then resolves quietly. Time waited on counts only whilst not `isPaused`
 */
export class Task {
  private readonly controller = new AbortController();
  /** Rejects once cancelled */
  private readonly cancelled = new Promise<never>((_, reject) =>
    this.controller.signal.addEventListener("abort", () => reject(cancelledReason)),
  );

  private readonly isPaused: () => boolean;

  constructor(isPaused = () => false) {
    this.isPaused = isPaused;
    this.cancelled.catch(() => {}); // cancelled with no wait under way
  }

  get isCancelled() {
    return this.controller.signal.aborted;
  }

  cancel() {
    this.controller.abort();
  }

  /** Runs `steps`, which end quietly once cancelled */
  async run(steps: () => Promise<unknown>) {
    try {
      await steps();
    } catch (e) {
      if (e !== cancelledReason) throw e;
    }
  }

  /** Resolves once `done`, else after `ms` not paused, polled every `stepMs` */
  async until(done: () => boolean, ms = Number.POSITIVE_INFINITY, stepMs = 50) {
    for (let left = ms; done() === false && left > 0; ) {
      const at = performance.now();
      await Promise.race([this.cancelled, pause(stepMs)]);
      if (this.isPaused() === false) left -= performance.now() - at;
    }
  }

  /** Resolves with `promise`, else after `ms` not paused. Given neither, it waits until cancelled */
  wait<T>(promise?: Promise<T>, ms?: number): Promise<T | undefined> {
    const racers: Promise<T | undefined>[] = [this.cancelled];
    let settled = false;
    if (promise !== undefined) racers.push(promise.finally(() => void (settled = true)));
    if (ms !== undefined) racers.push(this.until(() => settled, ms).then(() => undefined));
    return Promise.race(racers);
  }
}

const cancelledReason = Symbol("task cancelled");
