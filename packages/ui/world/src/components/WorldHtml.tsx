import { cn, useStateRef } from "@npc-cli/util";
import { DotsSixIcon, LockIcon, LockOpenIcon, ResizeIcon, XIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { Html3d, type TrackedObject3D } from "./Html3d";
import { WorldContext } from "./world-context";

/**
 * Keyed React content at a point, e.g. a route node's editor once clicked — an `Html3d` each,
 * centred above the point, with a close button. Its lock button lets the content take the
 * pointer, and shows a grip to drag it up and down and a corner handle to set its width (as
 * `--html-width`, for the content to flow into), both kept whilst the key is shown. It locks again `unlockMs` later, unless something inside it has focus
 */
export default function WorldHtml() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: new Map(),

      show(key, at, node, opts) {
        const prev = state.byKey.get(key);
        const object = prev?.tracked.object ?? new THREE.Object3D();
        object.position.set(at.x, at.y3d ?? 0, at.y);
        object.updateMatrixWorld();
        state.byKey.set(key, {
          tracked: prev?.tracked ?? { object, offset: zero },
          node,
          onHide: opts?.onHide,
          frame: prev?.frame ?? null,
          offset: prev?.offset ?? new THREE.Vector3(),
          width: prev?.width ?? null,
          unlocked: prev?.unlocked ?? false,
          lockTimer: prev?.lockTimer ?? 0,
        });
        state.update();
        w.view.forceUpdate();
      },
      hide(...keys) {
        let removed = false;
        for (const key of keys) {
          const entry = state.byKey.get(key);
          if (entry === undefined) continue;
          window.clearTimeout(entry.lockTimer);
          state.byKey.delete(key);
          entry.onHide?.();
          removed = true;
        }
        if (removed === false) return;
        state.update();
        w.view.forceUpdate();
      },
      toggle(key, at, node, opts) {
        state.byKey.has(key) ? state.hide(key) : state.show(key, at, node, opts);
      },
      unlock(key) {
        const entry = state.byKey.get(key);
        if (entry === undefined) return;
        entry.unlocked = true;
        state.armLock(key);
        state.update();
      },
      armLock(key) {
        const entry = state.byKey.get(key);
        if (entry === undefined || entry.unlocked === false) return;
        window.clearTimeout(entry.lockTimer);
        entry.lockTimer = window.setTimeout(() => state.lock(key), unlockMs);
      },
      lock(key, force = false) {
        const entry = state.byKey.get(key);
        if (entry === undefined || entry.unlocked === false) return;
        window.clearTimeout(entry.lockTimer);
        if (force === false && entry.frame?.contains(document.activeElement) === true) {
          return state.armLock(key); // still typing
        }
        entry.unlocked = false;
        state.update();
      },
      onDragStart(key, clientX, clientY) {
        const entry = state.byKey.get(key);
        if (entry === undefined) return;
        const { camera } = w.r3f;
        const { width, height } = w.r3f.get().size;
        // screen to world at the anchor's depth, as `SpeechBubbleApi.onDragMove` does
        const ndcZ = tmpVec.setFromMatrixPosition(entry.tracked.object.matrixWorld).project(camera).z;
        const worldAt = (x: number, y: number) =>
          tmpVec.set((x / width) * 2 - 1, -(y / height) * 2 + 1, ndcZ).unproject(camera).y;
        const startY = worldAt(clientX, clientY);
        const offsetY = entry.offset.y;
        track(
          (x, y) => {
            entry.offset.y = offsetY + worldAt(x, y) - startY; // up and down only
            w.view.forceUpdate();
          },
          () => state.armLock(key),
        );
      },
      onResizeStart(key, clientX) {
        const entry = state.byKey.get(key);
        if (entry === undefined || entry.frame === null) return;
        const { frame } = entry;
        const startWidth = frame.offsetWidth; // CSS px
        const screenPerCss = frame.getBoundingClientRect().width / startWidth;
        track(
          (x) => {
            // doubled: centred on the point, the edge under the handle moves by half the change
            entry.width = Math.max(minWidth, startWidth + (2 * (x - clientX)) / screenPerCss);
            frame.style.setProperty("--html-width", `${entry.width}px`);
          },
          () => state.armLock(key),
        );
      },
    }),
  );

  w.html = state;

  /** Follows the pointer until it is let go, mouse or touch */
  function track(onMove: (clientX: number, clientY: number) => void, onDone: () => void) {
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => e.touches[0] && onMove(e.touches[0].clientX, e.touches[0].clientY);
    const onEnd = () => {
      onDone();
      w.rootEl.removeEventListener("mousemove", onMouseMove);
      w.rootEl.removeEventListener("mouseup", onEnd);
      w.rootEl.removeEventListener("mouseleave", onEnd);
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
    };
    w.rootEl.addEventListener("mousemove", onMouseMove);
    w.rootEl.addEventListener("mouseup", onEnd);
    w.rootEl.addEventListener("mouseleave", onEnd);
    document.addEventListener("touchmove", onTouchMove, { capture: true });
    document.addEventListener("touchend", onEnd, { capture: true });
  }

  const pointerOf = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    return "touches" in e ? e.touches[0] : e;
  };

  return [...state.byKey].map(([key, entry]) => {
    const { tracked, node, offset, width, unlocked } = entry;
    return (
      <Html3d
        key={key}
        className="pointer-events-none absolute top-0 left-0"
        offset={offset}
        position={zeroVec}
        r3f={w.r3f}
        tracked={tracked}
        visible
      >
        <div
          ref={(el) => void (entry.frame = el)}
          // no text selection, bar inside a focused field
          className="relative transform-[translate(-50%,-100%)] select-none [&_:is(input,textarea,[contenteditable]):focus]:select-text"
          style={{ zoom: htmlZoom, ...(width !== null && { "--html-width": `${width}px` }) }}
        >
          {unlocked && (
            <div
              className={cn(
                handleClass,
                "bottom-full left-1/2 mb-2 h-9 w-16 -translate-x-1/2 cursor-grab active:cursor-grabbing",
              )}
              onMouseDown={(e) => {
                const p = pointerOf(e);
                state.onDragStart(key, p.clientX, p.clientY);
              }}
              onTouchStart={(e) => {
                const p = pointerOf(e);
                if (p) state.onDragStart(key, p.clientX, p.clientY);
              }}
            >
              <DotsSixIcon className="size-6" weight="bold" />
            </div>
          )}
          <div className="pointer-events-auto absolute right-0 bottom-full mb-2 flex gap-2">
            <div
              className={cn(handleClass, "static size-9 cursor-pointer", unlocked && "border-white/70 bg-white/10")}
              onClick={() => (unlocked ? state.lock(key, true) : state.unlock(key))}
            >
              {unlocked ? (
                <LockOpenIcon className="size-6" weight="bold" />
              ) : (
                <LockIcon className="size-6" weight="bold" />
              )}
            </div>
            <div
              className={cn(handleClass, "static size-9 cursor-pointer hover:border-red-400/70 hover:text-red-300")}
              onClick={() => state.hide(key)}
            >
              <XIcon className="size-6" weight="bold" />
            </div>
          </div>
          <div className={cn("transition-opacity", unlocked === false && "pointer-events-none opacity-70")}>{node}</div>
          {unlocked && (
            <div
              className={cn(handleClass, "-right-3 -bottom-3 size-9 cursor-nwse-resize")}
              onMouseDown={(e) => state.onResizeStart(key, pointerOf(e).clientX)}
              onTouchStart={(e) => {
                const p = pointerOf(e);
                if (p) state.onResizeStart(key, p.clientX);
              }}
            >
              <ResizeIcon className="size-6" weight="bold" />
            </div>
          )}
        </div>
      </Html3d>
    );
  });
}

export type State = {
  byKey: Map<string, WorldHtmlEntry>;
  /** Show `node` at the point, replacing what the key showed */
  show(key: string, at: WorldHtmlPoint, node: React.ReactNode, opts?: WorldHtmlOpts): void;
  hide(...keys: string[]): void;
  toggle(key: string, at: WorldHtmlPoint, node: React.ReactNode, opts?: WorldHtmlOpts): void;
  /** Let the content take the pointer, for `unlockMs` */
  unlock(key: string): void;
  /** The lock starts its `unlockMs` over, e.g. after a drag */
  armLock(key: string): void;
  /** Unless something inside it has focus, in which case it waits another `unlockMs` — bar `force` */
  lock(key: string, force?: boolean): void;
  /** Drag the grip to move it up and down */
  onDragStart(key: string, clientX: number, clientY: number): void;
  /** Drag the corner handle to set the width */
  onResizeStart(key: string, clientX: number): void;
};

export type WorldHtmlPoint = { x: number; y: number; y3d?: number };
export type WorldHtmlOpts = { onHide?: () => void };

type WorldHtmlEntry = {
  tracked: TrackedObject3D;
  node: React.ReactNode;
  onHide?: () => void;
  frame: HTMLDivElement | null;
  offset: THREE.Vector3;
  /** CSS px, or the content's own */
  width: number | null;
  /** Whether its content takes the pointer */
  unlocked: boolean;
  lockTimer: number;
};

const handleClass =
  "pointer-events-auto absolute grid place-items-center rounded-lg border-2 border-white/40 bg-black/80 text-white/90";
const zero = new THREE.Vector3();
const zeroVec = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
/** `Html3d` scales the content down, as `NpcBubble` compensates with large rem sizes */
const htmlZoom = 2;
const minWidth = 240;
const unlockMs = 5000;
