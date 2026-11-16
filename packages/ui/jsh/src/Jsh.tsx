/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */

/**
 * Ways to import JS as shell functions:
 * ```sh
 * source /etc/util.js.sh
 * import util
 * import call from util
 * import call expr from util
 * ```
 */
import { Tty } from "@npc-cli/cli";
import * as modules from "@npc-cli/cli/jsh/modules";
import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import type React from "react";
import { useContext, useEffect } from "react";
import { Jobs } from "./Jobs";
import type { JshUiMeta } from "./schema";
import { shellFunctionFiles } from "./sources";

/** A tty, and beside it its jobs if shown. Only CSS moves the jobs, so the tty never remounts */
export default function Jsh({ meta }: { meta: JshUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);
  const { jobs } = meta;
  const across = acrossOf(jobs.at);

  const state = useStateRef(
    (): State => ({
      drag: null,
      dropAt: null,
      jobsEl: null,
      meta,
      moving: false,
      rootEl: null,

      endDrag() {
        window.removeEventListener("pointermove", state.onPointerMove);
        window.removeEventListener("pointerup", state.onPointerUp);
        window.removeEventListener("pointercancel", state.endDrag);
        window.removeEventListener("keydown", state.onKeyDown);
        // a sash let go unsaved, e.g. by Escape, goes back to its saved size
        if (state.drag?.kind === "sash" && state.jobsEl !== null) {
          state.jobsEl.style.flexBasis = `${state.meta.jobs.size * 100}%`;
        }
        state.drag = null;
        if (state.moving) state.set({ dropAt: null, moving: false });
      },
      onGrip(e) {
        state.startDrag({ kind: "move", x: e.clientX, y: e.clientY });
      },
      onKeyDown(e) {
        if (e.key === "Escape") state.endDrag();
      },
      onPointerMove(e) {
        const { drag, rootEl } = state;
        if (drag === null || rootEl === null) return;
        const rect = rootEl.getBoundingClientRect();
        if (drag.kind === "move") {
          if (!state.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < dragStartPx) return;
          const dropAt = sideAt(rect, e.clientX, e.clientY);
          if (!state.moving || dropAt !== state.dropAt) state.set({ dropAt, moving: true });
          return;
        }
        if (state.jobsEl === null) return;
        const total = drag.across ? rect.width : rect.height;
        const delta = (drag.across ? e.clientX : e.clientY) - drag.from;
        const px = Math.min(Math.max(drag.px + drag.sign * delta, jobsMinPx), total - ttyMinPx);
        drag.size = px / total;
        state.jobsEl.style.flexBasis = `${px}px`; // saved once let go
      },
      onPointerUp() {
        const { drag, dropAt } = state;
        if (drag?.kind === "move" && dropAt !== null) state.setJobs({ at: dropAt });
        if (drag?.kind === "sash" && drag.size !== null) {
          state.setJobs({ size: drag.size });
          state.drag = null; // saved, so `endDrag` keeps its size
        }
        state.endDrag();
      },
      onSash(e) {
        if (state.jobsEl === null) return;
        const { at } = state.meta.jobs;
        const across = acrossOf(at);
        state.startDrag({
          kind: "sash",
          across,
          from: across ? e.clientX : e.clientY,
          px: across ? state.jobsEl.offsetWidth : state.jobsEl.offsetHeight,
          /** Towards the terminal grows the jobs */
          sign: at === "bottom" || at === "right" ? -1 : 1,
          size: null,
        });
      },
      setJobs(patch) {
        const { id, jobs } = state.meta;
        uiStoreApi.setUiMeta(id, (draft) => void ((draft as JshUiMeta).jobs = { ...jobs, ...patch }));
      },
      startDrag(drag) {
        state.endDrag();
        state.drag = drag;
        window.addEventListener("pointermove", state.onPointerMove);
        window.addEventListener("pointerup", state.onPointerUp);
        window.addEventListener("pointercancel", state.endDrag);
        window.addEventListener("keydown", state.onKeyDown);
      },
    }),
  );

  state.meta = meta; // its handlers run long after this render

  useEffect(() => state.endDrag, []);

  return (
    <div ref={state.ref("rootEl")} className={cn("relative size-full flex", flexOf[jobs.at])}>
      <div className="relative flex-1 min-w-40 min-h-40">
        <Tty
          disabled={meta.disabled}
          env={meta.env}
          modules={modules} // actual JS
          onBooted={() => uiStoreApi.setUiMeta(meta.id, (draft) => ((draft as JshUiMeta).sessionBootedAt = Date.now()))}
          originalProfileKey={
            typeof meta.env.PROFILE_KEY === "string" ? meta.env.PROFILE_KEY : ("default_profile" satisfies ProfileKey)
          }
          sessionKey={meta.sessionKey}
          shFiles={shellFunctionFiles} // JS wrapped as shell functions
          zoom={meta.zoom}
        />
      </div>
      {jobs.shown && (
        <>
          <div
            className={cn(
              "shrink-0 touch-none bg-on-background/10 hover:bg-blue-400/50 transition-colors",
              across ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
            )}
            onPointerDown={state.onSash}
          />
          <div
            ref={state.ref("jobsEl")}
            className={cn("shrink-0 overflow-hidden", across ? "min-w-24" : "min-h-24")}
            style={{ flexBasis: `${jobs.size * 100}%` }}
          >
            <Jobs sessionKey={meta.sessionKey} bootedAt={meta.sessionBootedAt} onGrip={state.onGrip} />
          </div>
        </>
      )}
      {state.dropAt !== null && <DropRect at={state.dropAt} size={jobs.size} />}
    </div>
  );
}

/** Where the jobs would go, once dragged near an edge's centre */
function DropRect({ at, size }: { at: JobsAt; size: number }) {
  const pct = `${size * 100}%`;
  const rectOf: Record<JobsAt, React.CSSProperties> = {
    top: { inset: 0, bottom: "auto", height: pct },
    bottom: { inset: 0, top: "auto", height: pct },
    left: { inset: 0, right: "auto", width: pct },
    right: { inset: 0, left: "auto", width: pct },
  };
  return (
    <div
      className="pointer-events-none absolute z-20 outline-2 -outline-offset-4 outline-blue-400 bg-blue-400/20"
      style={rectOf[at]}
    />
  );
}

/** The jobs are left or right of the tty */
function acrossOf(at: JobsAt) {
  return at === "left" || at === "right";
}

/** The side whose edge's centre the point is near, if any */
function sideAt(rect: DOMRect, x: number, y: number): null | JobsAt {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const alongX = Math.abs(fx - 0.5) < zoneAlong / 2;
  const alongY = Math.abs(fy - 0.5) < zoneAlong / 2;
  if (alongX && fy < zoneDepth) return "top";
  if (alongX && fy > 1 - zoneDepth) return "bottom";
  if (alongY && fx < zoneDepth) return "left";
  if (alongY && fx > 1 - zoneDepth) return "right";
  return null;
}

type JobsAt = JshUiMeta["jobs"]["at"];

type State = {
  /** Moving the jobs by their header, or resizing them by the sash */
  drag:
    | null
    | { kind: "move"; x: number; y: number }
    | { kind: "sash"; across: boolean; from: number; px: number; sign: 1 | -1; size: null | number };
  /** The side a move would drop the jobs on */
  dropAt: null | JobsAt;
  jobsEl: null | HTMLDivElement;
  meta: JshUiMeta;
  /** A move has begun */
  moving: boolean;
  rootEl: null | HTMLDivElement;
  endDrag(): void;
  onGrip(e: React.PointerEvent): void;
  onKeyDown(e: KeyboardEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(): void;
  onSash(e: React.PointerEvent): void;
  setJobs(patch: Partial<JshUiMeta["jobs"]>): void;
  startDrag(drag: NonNullable<State["drag"]>): void;
};

/** The tty stays first in the DOM, so the jobs go before it by a reversed direction */
const flexOf: Record<JobsAt, string> = {
  top: "flex-col-reverse",
  bottom: "flex-col",
  left: "flex-row-reverse",
  right: "flex-row",
};
/** An edge's centre, as a share of the Jsh: how far in, and how far along */
const zoneDepth = 0.2;
const zoneAlong = 0.5;
/** Pixels a header moves before it drags */
const dragStartPx = 6;
/** The jobs' least size, as their `min-*-24` */
const jobsMinPx = 96;
/** The tty's least size, as its `min-*-40` */
const ttyMinPx = 160;
