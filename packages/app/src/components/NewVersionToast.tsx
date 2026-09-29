import { useStateRef } from "@npc-cli/util";
import { fetchLatestBuild, getBuildInfo } from "@npc-cli/util/build-info";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { ArrowClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

const ourBuildId = getBuildInfo()?.id;
/** A returning tab need not hammer the check */
const minCheckMs = 60 * 1000;
const touchDevice = isTouchDevice();

/**
 * A tab left open across a deploy runs superseded code, which no cache header can fix.
 * We compare our html's build id against the deployed one whenever the tab resurfaces.
 */
export function NewVersionToast() {
  const state = useStateRef(() => ({
    stale: false,
    lastCheckMs: 0,

    async check(force = false) {
      const now = Date.now();
      if (!ourBuildId || state.stale || (!force && now - state.lastCheckMs < minCheckMs)) return;
      state.lastCheckMs = now;
      const latest = await fetchLatestBuild();
      if (latest && latest.id !== ourBuildId) state.set({ stale: true });
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
    // full width on a phone, bar a small gap either side
    <div
      className="pointer-events-none fixed inset-x-2 bottom-6 z-50 flex justify-center"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <AnimatePresence>
        {state.stale && (
          <motion.div
            className="pointer-events-auto flex w-full items-center gap-3 rounded bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-lg shadow-black/40 sm:w-auto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ArrowClockwiseIcon className="size-4 shrink-0" />
            <span className={touchDevice ? "flex-1 text-sm" : "flex-1 text-xs"}>New version available</span>
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
    </div>
  );
}
