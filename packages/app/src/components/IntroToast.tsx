import { cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { findSkipNet, isIntroSeen, openIntro, setIntroSeen } from "./intro-service";

/** Waits for the World to boot first */
const showAfterMs = 4000;
const touchDevice = isTouchDevice();

/** Points to SkipNet's demo video until dismissed. Watch hides it until the next visit. `?intro` shows it anyway */
export function IntroToast() {
  const state = useStateRef(() => ({
    shown: false,

    dismiss() {
      setIntroSeen();
      state.set({ shown: false });
    },
    watch() {
      state.set({ shown: false });
      openIntro();
    },
  }));

  useEffect(() => {
    const forced = new URLSearchParams(location.search).has("intro");
    if (!forced && isIntroSeen()) return;
    const timeoutId = setTimeout(() => findSkipNet() !== null && state.set({ shown: true }), showAfterMs);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-2 top-3 z-50 flex justify-center">
      {state.shown && (
        <div
          className={cn(
            "pointer-events-auto flex w-full items-center gap-3 rounded bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-lg shadow-black/40 sm:w-auto",
            "transition-[opacity,translate] duration-200 starting:opacity-0 starting:-translate-y-2",
          )}
        >
          <PlayIcon className="size-4 shrink-0 text-amber-300" weight="fill" />
          <span className={touchDevice ? "flex-1 text-sm" : "flex-1 text-xs"}>New here? Watch the demo in SkipNet</span>
          <button
            type="button"
            className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-white cursor-pointer"
            onClick={state.watch}
          >
            Watch
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-neutral-400 hover:text-neutral-100 cursor-pointer"
            onClick={state.dismiss}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
