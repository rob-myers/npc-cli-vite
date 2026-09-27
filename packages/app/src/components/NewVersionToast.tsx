import { useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { ArrowClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

/** Served by `buildIdPlugin` */
const versionJsonPath = "/version.json";
/** A returning tab need not hammer the check */
const minCheckMs = 60 * 1000;
const touchDevice = isTouchDevice();

/**
 * A tab left open across a deploy runs superseded code, which no cache header can fix.
 * We compare our baked-in `__BUILD_ID__` against the deployed one whenever the tab resurfaces.
 */
export function NewVersionToast() {
  const state = useStateRef(() => ({
    stale: false,
    lastCheckMs: 0,

    async check(force = false) {
      const now = Date.now();
      if (state.stale || (!force && now - state.lastCheckMs < minCheckMs)) return;
      state.lastCheckMs = now;
      try {
        const res = await fetch(versionJsonPath, { cache: "no-store" });
        const { id } = await res.json();
        if (typeof id === "string" && id !== __BUILD_ID__) state.set({ stale: true });
      } catch {} // offline, or mid-deploy
    },
    onVisible() {
      if (document.visibilityState === "visible") state.check();
    },
    /** A chunk deleted by a deploy cannot be fetched, so the tab is provably stale */
    onPreloadError() {
      state.set({ stale: true });
    },
    reload() {
      window.location.reload();
    },
  }));

  useEffect(() => {
    // DEV would only ever report the server's own id, so opt in
    if (import.meta.env.DEV && !new URLSearchParams(location.search).has("checkVersion")) return;

    document.addEventListener("visibilitychange", state.onVisible);
    window.addEventListener("pageshow", state.onVisible); // bfcache restore
    window.addEventListener("vite:preloadError", state.onPreloadError as EventListener);
    return () => {
      document.removeEventListener("visibilitychange", state.onVisible);
      window.removeEventListener("pageshow", state.onVisible);
      window.removeEventListener("vite:preloadError", state.onPreloadError as EventListener);
    };
  }, []);

  useEffect(() => {
    Object.assign(window, { showNewVersion: () => state.set({ stale: true }) });
  }, []);

  return (
    <AnimatePresence>
      {state.stale && (
        <motion.div
          className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 rounded bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-lg shadow-black/40"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          initial={{ opacity: 0, x: "-50%", y: 8 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          exit={{ opacity: 0, x: "-50%" }}
          transition={{ duration: 0.2 }}
        >
          <ArrowClockwiseIcon className="size-4 shrink-0" />
          <span className={touchDevice ? "text-sm" : "text-xs"}>New version available</span>
          <button
            type="button"
            className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            onClick={state.reload}
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-neutral-400 hover:text-neutral-100"
            onClick={() => state.set({ stale: false })}
          >
            <XIcon className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
