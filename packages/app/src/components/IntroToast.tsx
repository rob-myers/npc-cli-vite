import { cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { findSkipNet, isIntroSeen, openIntro, setIntroSeen } from "./intro-service";

/**
 * Points to SkipNet's demo video until dismissed. Watch, or on touch a swipe, hides it until the next visit.
 * `?intro` shows it anyway
 */
export function IntroToast() {
  const state = useStateRef(() => ({
    /** The last touch dragged it, so its buttons take no tap from it */
    dragged: false,
    /** Swiped, where it slides to as it fades: gone once there */
    leaving: null as null | { x: number; y: number },
    shown: false,
    /** Whilst a touch is down: where it began, and how far it has dragged it, sideways or up */
    swipe: null as null | { fromX: number; fromY: number; x: number; y: number },

    dismiss() {
      if (state.dragged) return;
      setIntroSeen();
      state.set({ shown: false });
    },
    onPointerDown(e: React.PointerEvent) {
      if (e.pointerType !== "touch" || state.leaving !== null) return;
      state.dragged = false;
      state.set({ swipe: { fromX: e.clientX, fromY: e.clientY, x: 0, y: 0 } });
    },
    onPointerMove(e: React.PointerEvent) {
      const { swipe } = state;
      if (swipe === null) return;
      // never down, into the page
      const [x, y] = [e.clientX - swipe.fromX, Math.min(0, e.clientY - swipe.fromY)];
      state.dragged ||= Math.hypot(x, y) > tapSlopPx;
      state.set({ swipe: { ...swipe, x, y } });
    },
    onPointerUp() {
      const { swipe } = state;
      if (swipe === null) return;
      const dist = Math.hypot(swipe.x, swipe.y);
      if (dist <= swipeAwayPx) return state.set({ swipe: null }); // springs back
      // on the way it went, then gone until the next visit: not dismissed
      state.set({ swipe: null, leaving: { x: (swipe.x / dist) * swipeOffPx, y: (swipe.y / dist) * swipeOffPx } });
    },
    watch() {
      if (state.dragged) return;
      state.set({ shown: false });
      openIntro();
    },
  }));

  /** Where it is dragged or sliding to: none at rest */
  const moved = state.leaving ?? state.swipe;

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
          onPointerDown={state.onPointerDown}
          onPointerMove={state.onPointerMove}
          onPointerUp={state.onPointerUp}
          onPointerCancel={state.onPointerUp}
          onTransitionEnd={() => state.leaving !== null && state.set({ shown: false, leaving: null })}
          // a drag follows the finger at once, fading to none at `swipeOffPx`; a release springs back or slides off
          style={
            moved === null
              ? undefined
              : {
                  translate: `${moved.x}px ${moved.y}px`,
                  opacity: 1 - Math.min(1, Math.hypot(moved.x, moved.y) / swipeOffPx),
                  transition: state.swipe ? "none" : undefined,
                }
          }
          className={cn(
            "pointer-events-auto flex w-full touch-none items-center gap-3 rounded bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-lg shadow-black/40 sm:w-auto",
            "transition-[opacity,translate] duration-200 starting:opacity-0 starting:-translate-y-2",
            state.leaving !== null && "pointer-events-none",
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

/** Waits for the World to boot first */
const showAfterMs = 4000;
const touchDevice = isTouchDevice();
/** Pixels a touch travels, sideways or up, to swipe it away */
const swipeAwayPx = 60;
/** Pixels a touch may move and still be a tap */
const tapSlopPx = 10;
/** Pixels it slides on, swiped */
const swipeOffPx = 240;
