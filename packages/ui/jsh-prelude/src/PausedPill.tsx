import type { PausedPillProps } from "@npc-cli/ui__world/paused-pill";
import { cn, Tip, useStateRef } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, PlayIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { preludeApi } from "./store";
import { WorldPrelude } from "./WorldPrelude";

/** The shell, which autorun and reboot drive, loads only once a World has mounted */
const loadRun = () => import("./run");

/** The World's paused pill, which runs its prelude on a page load and reboots on a remount. Its chevron shows autorun */
export function PausedPill({ w, paused, resumeProps }: PausedPillProps) {
  const state = useStateRef(
    (): State => ({
      open: false,
      step: null,

      async boot(task) {
        try {
          await task();
        } catch (e) {
          error(e);
        } finally {
          state.set({ step: null });
        }
      },
      reboot() {
        state.boot(async () => (await loadRun()).rebootWorld(w.key, (step) => state.set({ step })));
      },
    }),
  );

  useEffect(() => {
    void loadRun().then(({ getMountStatus, runPrelude }) => {
      const mount = getMountStatus(w.key, w);
      if (mount === "remount") {
        state.reboot(); // its ttys' world jobs and listeners are the old World's
      } else if (mount === "load" && preludeApi.get(w.key).autorun === true) {
        state.set({ step: "booting" });
        state.boot(() => runPrelude(w.key));
      }
    }, error);
  }, [w]);

  useEffect(() => {
    const sub = w.events.subscribe({
      next: (e) => (e.key === "map-changing" || e.key === "map-settled") && state.update(),
    });
    return () => sub.unsubscribe();
  }, [w]);

  const label = state.step ?? (w.isMapChanging() ? "loading" : "paused");
  const ready = label === "paused";

  return (
    <div
      className={cn(
        // over npc focus's labels (`z-20`)
        "absolute left-1/2 top-[40%] z-30 -translate-x-1/2 -translate-y-1/2 select-none",
        // its content's width: from `left-1/2` alone it gets half the World's, clipping "confirm" when narrow
        "w-max max-w-[calc(100%-1rem)]",
        "flex flex-col items-center rounded-xl transition-[opacity,background-color] duration-500",
        state.open ? "bg-black/60" : "bg-black/35",
        // it stays mounted for the fade out, so it must stop taking clicks the moment it is not paused
        paused ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="flex items-center">
        <Tip content={ready ? "resume" : label}>
          <button
            type="button"
            // a press is still the camera's, so a pinch begun there still pinches. Only once ready does a tap resume
            {...(ready ? resumeProps : { onPointerDown: resumeProps.onPointerDown, onWheel: resumeProps.onWheel })}
            className={cn(
              "flex items-center gap-3 pl-5 pr-2 py-2 touch-none",
              "font-mono text-yellow-200/80 text-xs uppercase tracking-[0.4em]",
              ready ? "cursor-pointer hover:text-yellow-100" : "opacity-60",
            )}
          >
            {state.step === null ? (
              <PlayIcon className="size-4 shrink-0" weight="fill" />
            ) : (
              <div className="size-3.5 shrink-0 rounded-full border-2 border-current border-b-transparent animate-spin" />
            )}
            {label}
          </button>
        </Tip>
        <Tip content={state.open ? "hide autorun" : "autorun"}>
          <button
            type="button"
            className="mr-3 p-1 rounded cursor-pointer outline-none text-yellow-200/50 hover:text-yellow-100 focus-visible:ring-1 focus-visible:ring-yellow-200/50"
            onClick={() => state.set({ open: !state.open })}
          >
            <CaretDownIcon className={cn("size-3.5 transition-transform duration-300", state.open && "rotate-180")} />
          </button>
        </Tip>
      </div>

      {/* grows from no height, so it slides open rather than appearing */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          state.open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
        )}
        inert={!state.open}
      >
        {/* closed, it takes the pill's width rather than giving it its own, so the pill stays snug */}
        <div className={cn("min-h-0 overflow-hidden", !state.open && "w-0 min-w-full")}>
          <div className="px-5 pt-1 pb-2">
            <WorldPrelude worldKey={w.key} container={w.rootEl} booting={state.step !== null} onReboot={state.reboot} />
          </div>
        </div>
      </div>
    </div>
  );
}

type State = {
  /** Is the autorun row shown? */
  open: boolean;
  /** What runs, e.g. "booting" or a reboot's step, shown with a spinner */
  step: null | string;
  /** Runs `task` with a spinner, cleared after */
  boot(task: () => Promise<void>): Promise<void>;
  reboot(): void;
};
