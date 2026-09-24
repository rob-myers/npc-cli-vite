import { cn, useStateRef } from "@npc-cli/util";
import { DotsSixIcon, ResizeIcon, XIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { Html3d, type TrackedObject3D } from "./Html3d";
import { WorldContext } from "./world-context";

/**
 * Keyed React content at a point, or following an object, e.g. a decor's editor once clicked — an
 * `Html3d` each, centred above its anchor. It always takes the pointer, and has a close button, a
 * grip to drag it up and down, and a corner handle to set its width (as `--html-width`, for the
 * content to flow into), both remembered by key once closed
 */
export default function WorldHtml() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: new Map(),

      show(key, at, node, opts) {
        const prev = state.byKey.get(key);
        const kept = prev === undefined ? remembered.get(`${w.key}:${key}`) : undefined;
        let tracked: TrackedObject3D;
        if ("object" in at) {
          tracked = at; // follows it e.g. an npc
        } else {
          const object = prev?.tracked.object ?? new THREE.Object3D();
          object.position.set(at.x, at.y3d ?? 0, at.y);
          object.updateMatrixWorld();
          tracked = prev?.tracked ?? { object, offset: zero };
        }
        state.byKey.set(key, {
          tracked,
          node,
          visible: prev?.visible ?? true,
          onHide: opts?.onHide,
          frame: prev?.frame ?? null,
          offset: prev?.offset ?? kept?.offset ?? new THREE.Vector3(),
          width: prev?.width ?? kept?.width ?? null,
          // only as it opens: a re-show, e.g. after an edit, must not take focus from a field
          wantsFocus: prev === undefined && opts?.focus === true && w.touchDevice === false,
        });
        state.update();
        w.view.forceUpdate();
      },
      hide(...keys) {
        let removed = false;
        let hadFocus = false;
        for (const key of keys) {
          const entry = state.byKey.get(key);
          if (entry === undefined) continue;
          hadFocus ||= entry.frame?.contains(document.activeElement) === true;
          state.byKey.delete(key);
          remembered.set(`${w.key}:${key}`, { offset: entry.offset, width: entry.width });
          entry.onHide?.();
          removed = true;
        }
        if (removed === false) return;
        if (hadFocus === true) w.view.focus(); // else it falls to the body, and keys miss the World
        state.update();
        w.view.forceUpdate();
      },
      focus(key) {
        const entry = state.byKey.get(key);
        if (entry === undefined || w.touchDevice === true) return;
        entry.wantsFocus = true;
        state.update();
      },
      toggle(key, at, node, opts) {
        state.byKey.has(key) ? state.hide(key) : state.show(key, at, node, opts);
      },
      setShown(key, shown) {
        const entry = state.byKey.get(key);
        if (entry === undefined || entry.visible === shown) return;
        entry.visible = shown;
        state.update();
      },
      onDragStart(key, clientX, clientY) {
        const entry = state.byKey.get(key);
        if (entry === undefined) return;
        const { camera } = w.r3f;
        const { width, height } = w.r3f.get().size;
        // screen to world at the anchor's depth
        const ndcZ = tmpVec.setFromMatrixPosition(entry.tracked.object.matrixWorld).project(camera).z;
        const worldAt = (x: number, y: number) =>
          tmpVec.set((x / width) * 2 - 1, -(y / height) * 2 + 1, ndcZ).unproject(camera).y;
        const startY = worldAt(clientX, clientY);
        const offsetY = entry.offset.y;
        track((x, y) => {
          entry.offset.y = offsetY + worldAt(x, y) - startY; // up and down only
          w.view.forceUpdate();
        });
      },
      onResizeStart(key, clientX) {
        const entry = state.byKey.get(key);
        if (entry === undefined || entry.frame === null) return;
        const { frame } = entry;
        const startWidth = frame.offsetWidth; // CSS px
        const screenPerCss = frame.getBoundingClientRect().width / startWidth;
        track((x) => {
          // doubled: centred on the point, the edge under the handle moves by half the change
          entry.width = Math.max(minWidth, startWidth + (2 * (x - clientX)) / screenPerCss);
          frame.style.setProperty("--html-width", `${entry.width}px`);
        });
      },
    }),
  );

  w.html = state;

  /** Follows the pointer until it is let go, mouse or touch */
  function track(onMove: (clientX: number, clientY: number) => void) {
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => e.touches[0] && onMove(e.touches[0].clientX, e.touches[0].clientY);
    const onEnd = () => {
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
    const { tracked, node, offset, width, visible } = entry;
    return (
      <Html3d
        key={key}
        className="pointer-events-none absolute top-0 left-0"
        offset={offset}
        position={zeroVec}
        r3f={w.r3f}
        tracked={tracked}
        visible={visible}
      >
        <div
          ref={(el) => void (entry.frame = el)}
          tabIndex={-1} // a click anywhere in it focuses it too
          // `Html3d` puts us INSIDE the canvas's own wrapper, which takes every press for the World's
          // — and on release takes the focus, so a field clicked here would lose it at once
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          // no text selection, bar inside a focused field
          className="pointer-events-auto relative transform-[translate(-50%,-100%)] select-none outline-none [&_:is(input,textarea,[contenteditable]):focus]:select-text"
          style={{ zoom: htmlZoom, ...(width !== null && { "--html-width": `${width}px` }) }}
        >
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
          <button
            type="button"
            ref={(el) => {
              if (el !== null && entry.wantsFocus === true) {
                entry.wantsFocus = false;
                el.focus({ preventScroll: true });
              }
            }}
            className={cn(
              handleClass,
              "right-0 bottom-full mb-2 size-9 cursor-pointer outline-none hover:border-red-400/70 hover:text-red-300",
              "focus:outline-2 focus:outline-solid focus:outline-offset-2 focus:outline-white/30", // Enter closes it
            )}
            onClick={() => state.hide(key)}
            // the World reads keys off its root, and Enter there unpauses
            onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
          >
            <XIcon className="size-6" weight="bold" />
          </button>
          {node}
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
        </div>
      </Html3d>
    );
  });
}

export type State = {
  byKey: Map<string, WorldHtmlEntry>;
  /** Show `node` at the point, or tracking the object, replacing what the key showed */
  show(key: string, at: WorldHtmlAnchor, node: React.ReactNode, opts?: WorldHtmlOpts): void;
  hide(...keys: string[]): void;
  /** Desktop: focus its close button, so Enter closes it — as `show`'s `focus`, but open already too */
  focus(key: string): void;
  toggle(key: string, at: WorldHtmlAnchor, node: React.ReactNode, opts?: WorldHtmlOpts): void;
  /** Hidden but kept e.g. whilst its npc fades */
  setShown(key: string, shown: boolean): void;
  /** Drag the grip to move it up and down */
  onDragStart(key: string, clientX: number, clientY: number): void;
  /** Drag the corner handle to set the width */
  onResizeStart(key: string, clientX: number): void;
};

export type WorldHtmlAnchor = { x: number; y: number; y3d?: number } | TrackedObject3D;
export type WorldHtmlOpts = {
  onHide?: () => void;
  /** Desktop: focus its close button as it opens, so Enter closes it */
  focus?: boolean;
};

type WorldHtmlEntry = {
  tracked: TrackedObject3D;
  node: React.ReactNode;
  visible: boolean;
  onHide?: () => void;
  frame: HTMLDivElement | null;
  offset: THREE.Vector3;
  /** CSS px, or the content's own */
  width: number | null;
  /** Focus the close button once it mounts */
  wantsFocus: boolean;
};

/** Where each key was dragged to and how wide, kept over close and World HMR alike */
const remembered = new Map<string, Pick<WorldHtmlEntry, "offset" | "width">>();
const handleClass =
  "pointer-events-auto absolute grid place-items-center rounded-lg border-2 border-white/40 bg-black/80 text-white/90";
const zero = new THREE.Vector3();
const zeroVec = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
/** `Html3d` scales the content down, as `NpcBubble` compensates with large rem sizes */
const htmlZoom = 2;
const minWidth = 240;
