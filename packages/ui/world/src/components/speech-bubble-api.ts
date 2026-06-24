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
  words = "Hello, world!!";

  offsetInitialized = false;
  isDragging = false;
  dragStartClient = { x: 0, y: 0 };
  dragWorldOffsetAtStart = { x: 0, y: 0, z: 0 };

  isResizing = false;
  resizeStartClient = { x: 0, y: 0 };
  resizeWidthAtStart = 0;
  resizeHeightAtStart = 0;
  resizeHtmlScale = 1;

  autoDeleteOpts: AutoDeleteOpts | null = null;
  autoDeleteRemainingMs: number | null = null;
  autoDeleteTimerStartedAt = 0;
  autoDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  bubbleDiv: HTMLElement | null = null;

  constructor(key: string, tracked: TrackedObject3D, w: WorldState) {
    this.key = key;
    this.tracked = tracked;
    this.w = w;
  }

  dispose() {
    if (this.autoDeleteTimer !== null) {
      clearTimeout(this.autoDeleteTimer);
      this.autoDeleteTimer = null;
    }
    this.update = noop;
    //@ts-expect-error
    this.w = null;
    //@ts-expect-error
    this.html3d = null;
    //@ts-expect-error
    this.tracked = null;
  }

  forwardWheelEvents(e: React.WheelEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
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
    const rootDiv = this.html3d.rootDiv;
    if (!rootDiv) return;
    if (this.w.bubble.isTopDown) {
      // keep hidden (opacity already 0 from html3dRef)
    } else if (this.w.disabled) {
      // show immediately if paused
      rootDiv.style.opacity = "";
    } else {
      // commence fade in
      rootDiv.style.transition = "opacity 0.3s";
      rootDiv.style.opacity = "";
      setTimeout(() => {
        rootDiv.style.transition = "";
      }, 300);
    }
  }

  onDragStart(clientX: number, clientY: number) {
    this.isDragging = true;
    this.dragStartClient = { x: clientX, y: clientY };
    this.dragWorldOffsetAtStart = { x: this.offset.x, y: this.offset.y, z: this.offset.z };
  }

  onDragMove(clientX: number, clientY: number) {
    if (!this.isDragging || !this.tracked) return;
    const { camera } = this.w.r3f;
    const { width, height } = this.w.r3f.get().size;
    tmpVec.setFromMatrixPosition(this.tracked.object.matrixWorld).add(this.tracked.offset);
    const ndcZ = tmpVec2.copy(tmpVec).project(camera).z;
    tmpVec
      .set((this.dragStartClient.x / width) * 2 - 1, -(this.dragStartClient.y / height) * 2 + 1, ndcZ)
      .unproject(camera);
    tmpVec2.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1, ndcZ).unproject(camera);
    this.offset.y = this.dragWorldOffsetAtStart.y + tmpVec2.y - tmpVec.y;
    this.html3d?.onFrame();
  }

  onDragEnd() {
    this.isDragging = false;
  }

  resizeStart(clientX: number, clientY: number) {
    this.isResizing = true;
    this.resizeStartClient = { x: clientX, y: clientY };
    this.resizeWidthAtStart = this.bubbleDiv?.offsetWidth ?? 0;
    this.resizeHeightAtStart = this.bubbleDiv?.offsetHeight ?? 0;
    // getBoundingClientRect gives screen pixels; offsetWidth gives CSS pixels — ratio is Html3d scale
    const rect = this.bubbleDiv?.getBoundingClientRect();
    this.resizeHtmlScale = rect && this.resizeWidthAtStart > 0 ? rect.width / this.resizeWidthAtStart : 1;
  }

  resizeMove(clientX: number, clientY: number) {
    if (!this.isResizing || !this.bubbleDiv) return;
    const dx = (clientX - this.resizeStartClient.x) / this.resizeHtmlScale;
    const dy = (clientY - this.resizeStartClient.y) / this.resizeHtmlScale;
    // Width change is doubled: translateX(-50%) centres the bubble, so the right edge only
    // moves by half the CSS width change — multiply by 2 to keep the handle under the pointer.
    this.bubbleDiv.style.width = `${Math.max(minBubbleWidth, this.resizeWidthAtStart + dx * 2)}px`;
    this.bubbleDiv.style.height = `${Math.max(minBubbleHeight, this.resizeHeightAtStart + dy)}px`;
    this.html3d?.onFrame();
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

  onWheel = (e: React.WheelEvent) => {
    this.forwardWheelEvents(e);
  };

  onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.resizeStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => this.resizeMove(ev.clientX, ev.clientY);
    const cleanup = () => {
      this.isResizing = false;
      this.w.rootEl.removeEventListener("mousemove", onMove);
      this.w.rootEl.removeEventListener("mouseup", cleanup);
      this.w.rootEl.removeEventListener("mouseleave", cleanup);
    };
    this.w.rootEl.addEventListener("mousemove", onMove);
    this.w.rootEl.addEventListener("mouseup", cleanup);
    this.w.rootEl.addEventListener("mouseleave", cleanup);
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
      this.isResizing = false;
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
    };
    document.addEventListener("touchmove", onMove, { capture: true });
    document.addEventListener("touchend", onEnd, { capture: true });
  };

  scheduleAutoDelete() {
    if (this.autoDeleteTimer !== null) {
      clearTimeout(this.autoDeleteTimer);
      this.autoDeleteTimer = null;
    }
    if (!this.autoDeleteOpts) return;
    const { baseSeconds, perWordSeconds } = this.autoDeleteOpts;
    const wordCount = this.words.trim() ? this.words.trim().split(/\s+/).length : 0;
    this.autoDeleteRemainingMs = (baseSeconds + perWordSeconds * wordCount) * 1000;
    if (!this.w?.disabled) {
      this.autoDeleteTimerStartedAt = Date.now();
      this.autoDeleteTimer = setTimeout(() => this.fadeAndDelete(), this.autoDeleteRemainingMs);
    }
  }

  pauseAutoDelete() {
    if (this.autoDeleteTimer === null) return;
    clearTimeout(this.autoDeleteTimer);
    this.autoDeleteTimer = null;
    if (this.autoDeleteRemainingMs !== null) {
      this.autoDeleteRemainingMs = Math.max(
        0,
        this.autoDeleteRemainingMs - (Date.now() - this.autoDeleteTimerStartedAt),
      );
    }
  }

  resumeAutoDelete() {
    if (this.autoDeleteRemainingMs === null || this.autoDeleteTimer !== null) return;
    this.autoDeleteTimerStartedAt = Date.now();
    this.autoDeleteTimer = setTimeout(() => this.fadeAndDelete(), this.autoDeleteRemainingMs);
  }

  fadeAndDelete() {
    this.autoDeleteTimer = null;
    this.autoDeleteRemainingMs = null;
    if (this.html3d?.rootDiv) {
      this.html3d.rootDiv.style.transition = "opacity 0.5s";
      this.html3d.rootDiv.style.opacity = "0";
    }
    setTimeout(() => this.w?.bubble?.delete(this.key), 500);
  }

  setWords(words: string) {
    this.words = words;
    this.epochMs = Date.now();
    this.w.bubble.update();

    if (this.autoDeleteOpts) {
      this.scheduleAutoDelete(); // reschedule
    }

    if (words) {
      this.w.events.next({
        key: "speech",
        npcKey: this.key,
        words: this.words,
        epochMs: this.epochMs,
      });
    }
  }

  update = noop;
}

function noop() {}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const minBubbleWidth = 256;
const minBubbleHeight = 256;

export type AutoDeleteOpts = { baseSeconds: number; perWordSeconds: number };
export const defaultAutoDeleteOpts: AutoDeleteOpts = { baseSeconds: 2, perWordSeconds: 0.5 };
