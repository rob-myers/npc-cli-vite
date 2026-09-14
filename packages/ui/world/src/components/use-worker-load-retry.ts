import { useEffect } from "react";

/**
 * Dev only: a worker whose module failed to load never speaks, and cannot hear the fix via hmr.
 * Respawns one that errors before speaking. Call after the spawning effect, with its deps
 */
export function useWorkerLoadRetry(getWorker: () => null | Worker, respawn: () => void, deps: unknown[]) {
  useEffect(() => {
    const worker = getWorker();
    if (!import.meta.hot || worker === null) return; // not spawned yet
    const abort = new AbortController();
    let timer = 0;
    const opts = { once: true, signal: abort.signal };
    worker.addEventListener("message", () => abort.abort(), opts); // spoke, so it loaded
    worker.addEventListener("error", () => void (timer = window.setTimeout(respawn, retryMs)), opts);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, deps);
}

const retryMs = 2000;
