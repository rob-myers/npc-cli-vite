import * as THREE from "three";
import type { State as Html3dState, TrackedObject3D } from "../components/Html3d";
import type { State as WorldState } from "./World";

/**
 * 🔔 Avoid function-valued properties: our HMR strategy doesn't handle them,
 * in particular they won't be overwritten when the function is changed.
 */
export class SpeechBubbleApi {
  epochMs = 0;

  html3d: Html3dState = {} as Html3dState;
  position = new THREE.Vector3();
  tracked: TrackedObject3D;
  /** 3D world-space offset from the tracked anchor — driven by drag. */
  offset = { x: 0, y: 0, z: 0 };

  key: string;
  w: WorldState;

  drag = {
    active: false,
    startClient: { x: 0, y: 0 },
    worldOffsetAtStart: { x: 0, y: 0, z: 0 },
  };

  interact = {
    active: false,
    remainingMs: null as number | null,
    timerStartedAt: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
  };

  size = {
    /** Resizing */
    active: false,
    startClient: { x: 0, y: 0 },
    widthAtStart: 0,
    heightAtStart: 0,
    htmlScale: 1,
  };

  initialCssVars: Record<string, string> = {};

  constructor(key: string, tracked: TrackedObject3D, w: WorldState) {
    this.key = key;
    this.tracked = tracked;
    this.w = w;
  }

  deactivateInteractive() {
    this.interact.timer = null;
    this.interact.remainingMs = null;
    this.interact.active = false;
    this.forceRender();
  }

  dispose() {
    if (this.interact.timer !== null) {
      clearTimeout(this.interact.timer);
      this.interact.timer = null;
    }
    //@ts-expect-error
    this.w = null;
    //@ts-expect-error
    this.html3d = null;
    //@ts-expect-error
    this.tracked = null;
  }

  fadeAndDelete() {
    this.setOpacity(0);
    setTimeout(() => this.w?.bubble?.delete(this.key), fadeOutMs);
  }

  forceRender() {
    this.epochMs = Date.now();
    this.w.bubble.update();
  }

  forwardWheelEvents(e: React.WheelEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  getBubbleCssVars(): Record<string, string> {
    const rootDiv = this.html3d?.rootDiv;
    return Object.fromEntries(
      ["--bubble-width", "--bubble-height"]
        .map((varName) => [varName, rootDiv?.style.getPropertyValue(varName)] as const)
        .filter(([, value]) => value),
    );
  }

  html3dRef(html3d: Html3dState | null) {
    if (!html3d) return;

    if (this.html3d !== html3d) {
      // speech bubbles hidden on 1st ever mount
      html3d.rootDiv.style.opacity = "0";
    }

    this.html3d = html3d;
  }

  initializeOpacity() {
    this.setOpacity(1);
  }

  onDragStart(clientX: number, clientY: number) {
    this.drag.active = true;
    this.drag.startClient = { x: clientX, y: clientY };
    this.drag.worldOffsetAtStart = { x: this.offset.x, y: this.offset.y, z: this.offset.z };
  }

  onDragMove(clientX: number, clientY: number) {
    if (!this.drag.active || !this.tracked) return;
    const { camera } = this.w.r3f;
    const { width, height } = this.w.r3f.get().size;
    tmpVec.setFromMatrixPosition(this.tracked.object.matrixWorld).add(this.tracked.offset);
    const ndcZ = tmpVec2.copy(tmpVec).project(camera).z;
    tmpVec
      .set((this.drag.startClient.x / width) * 2 - 1, -(this.drag.startClient.y / height) * 2 + 1, ndcZ)
      .unproject(camera);
    tmpVec2.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1, ndcZ).unproject(camera);
    this.offset.y = this.drag.worldOffsetAtStart.y + tmpVec2.y - tmpVec.y;
    this.html3d?.onFrame();
  }

  onDragEnd() {
    this.drag.active = false;
  }

  onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.onDragStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => this.onDragMove(ev.clientX, ev.clientY);
    const cleanup = () => {
      this.onDragEnd();
      this.w.rootEl.removeEventListener("mousemove", onMove);
      this.w.rootEl.removeEventListener("mouseup", cleanup);
      this.w.rootEl.removeEventListener("mouseleave", cleanup);
    };
    this.w.rootEl.addEventListener("mousemove", onMove);
    this.w.rootEl.addEventListener("mouseup", cleanup);
    this.w.rootEl.addEventListener("mouseleave", cleanup);
  };

  onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.resizeStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => this.resizeMove(ev.clientX, ev.clientY);
    const cleanup = () => {
      this.size.active = false;
      this.w.rootEl.removeEventListener("mousemove", onMove);
      this.w.rootEl.removeEventListener("mouseup", cleanup);
      this.w.rootEl.removeEventListener("mouseleave", cleanup);
    };
    this.w.rootEl.addEventListener("mousemove", onMove);
    this.w.rootEl.addEventListener("mouseup", cleanup);
    this.w.rootEl.addEventListener("mouseleave", cleanup);
  };

  onResizeTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const t = e.touches[0];
    if (!t) return;
    this.resizeStart(t.clientX, t.clientY);
    const onMove = (ev: TouchEvent) => {
      const t2 = ev.touches[0];
      if (t2) this.resizeMove(t2.clientX, t2.clientY);
    };
    const onEnd = () => {
      this.size.active = false;
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
    };
    document.addEventListener("touchmove", onMove, { capture: true });
    document.addEventListener("touchend", onEnd, { capture: true });
  };

  onTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const t = e.touches[0];
    if (!t) return;
    this.onDragStart(t.clientX, t.clientY);
    const onMove = (ev: TouchEvent) => {
      const t2 = ev.touches[0];
      if (t2) this.onDragMove(t2.clientX, t2.clientY);
    };
    const onEnd = () => {
      this.onDragEnd();
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
    };
    document.addEventListener("touchmove", onMove, { capture: true });
    document.addEventListener("touchend", onEnd, { capture: true });
  };

  onWheel = (e: React.WheelEvent) => {
    this.forwardWheelEvents(e);
  };

  pauseInteractiveTimer() {
    if (this.interact.timer === null) return;
    clearTimeout(this.interact.timer);
    this.interact.timer = null;
    if (this.interact.remainingMs !== null) {
      this.interact.remainingMs = Math.max(0, this.interact.remainingMs - (Date.now() - this.interact.timerStartedAt));
    }
  }

  resizeMove(clientX: number, clientY: number) {
    if (!this.size.active) return;
    const dx = (clientX - this.size.startClient.x) / this.size.htmlScale;
    const dy = (clientY - this.size.startClient.y) / this.size.htmlScale;
    // Width change is doubled: translateX(-50%) centres the bubble, so the right edge only
    // moves by half the CSS width change — multiply by 2 to keep the handle under the pointer.
    const rootDiv = this.html3d?.rootDiv;
    rootDiv?.style.setProperty("--bubble-width", `${Math.max(minBubbleWidth, this.size.widthAtStart + dx * 2)}px`);
    rootDiv?.style.setProperty("--bubble-height", `${Math.max(minBubbleHeight, this.size.heightAtStart + dy)}px`);
    this.html3d?.onFrame();
  }

  resizeStart(clientX: number, clientY: number) {
    this.size.active = true;
    this.size.startClient = { x: clientX, y: clientY };
    const innerDiv = this.html3d?.innerDiv;
    this.size.widthAtStart = innerDiv?.offsetWidth ?? defaultBubbleWidth;
    this.size.heightAtStart = innerDiv?.offsetHeight ?? defaultBubbleHeight;
    // getBoundingClientRect gives screen pixels; offsetWidth gives CSS pixels — ratio is Html3d scale
    const rect = innerDiv?.getBoundingClientRect();
    this.size.htmlScale = rect && this.size.widthAtStart > 0 ? rect.width / this.size.widthAtStart : 1;
  }

  resumeInteractiveTimer() {
    if (!this.interact.active || this.interact.remainingMs === null || this.interact.timer !== null) return;
    this.interact.timerStartedAt = Date.now();
    this.interact.timer = setTimeout(() => this.deactivateInteractive(), this.interact.remainingMs);
  }

  setOpacity(opacity: number) {
    const rootDiv = this.html3d?.rootDiv;
    if (rootDiv) {
      rootDiv.style.transition = `opacity ${fadeOutMs}ms`;
      rootDiv.style.opacity = `${opacity}`;
    }
  }

  startInteractiveTimer() {
    if (this.interact.timer !== null) {
      clearTimeout(this.interact.timer);
    }
    this.interact.remainingMs = interactiveDurationMs;

    if (!this.w?.disabled) {
      this.interact.timerStartedAt = Date.now();
      this.interact.timer = setTimeout(() => this.deactivateInteractive(), this.interact.remainingMs);
    } // else timer started/paused on enabled/disabled world
  }

  stopInteractiveTimer() {
    if (this.interact.timer !== null) {
      clearTimeout(this.interact.timer);
      this.interact.timer = null;
    }
    this.interact.remainingMs = null;
  }

  toggleInteractive() {
    this.interact.active = !this.interact.active;
    if (this.interact.active) {
      this.startInteractiveTimer();
    } else {
      this.stopInteractiveTimer();
    }
    this.forceRender();
  }
}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const interactiveDurationMs = 5_000;
const minBubbleWidth = 200;
const minBubbleHeight = 72;
const defaultBubbleWidth = 320; // w-80
const defaultBubbleHeight = 96; // h-24
const fadeOutMs = 300;
