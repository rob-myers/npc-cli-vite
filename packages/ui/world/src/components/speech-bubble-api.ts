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
  tracked: TrackedObject3D | null = null;
  /** 3D world-space offset from the tracked anchor — driven by drag. */
  offset = { x: 0, y: 0, z: 0 };
  resolveOnMount: () => void = noop;

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

  bubbleDiv: HTMLElement | null = null;

  constructor(key: string, w: WorldState) {
    this.key = key;
    this.w = w;
  }

  dispose() {
    this.tracked = null;
    this.update = noop;
    this.w = null as any;
    this.html3dRef(null);
  }

  forwardWheelEvents(e: React.WheelEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  html3dRef(html3d: Html3dState | null) {
    this.html3d = html3d as Html3dState;
  }

  initializeOffset() {
    if (this.offsetInitialized) return;
    this.offsetInitialized = true;
    this.offset.x = this.offset.y = this.offset.z = 0;
  }

  isMounted() {
    return this.offsetInitialized;
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
    this.bubbleDiv.style.width = `${Math.max(512, this.resizeWidthAtStart + dx * 2)}px`;
    this.bubbleDiv.style.height = `${Math.max(256, this.resizeHeightAtStart + dy)}px`;
    this.html3d?.onFrame();
  }

  onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.onDragStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => this.onDragMove(ev.clientX, ev.clientY);
    const onUp = () => {
      this.onDragEnd();
      this.w.rootEl.removeEventListener("mousemove", onMove);
      this.w.rootEl.removeEventListener("mouseup", onUp);
    };
    this.w.rootEl.addEventListener("mousemove", onMove);
    this.w.rootEl.addEventListener("mouseup", onUp);
  };

  onWheel = (e: React.WheelEvent) => {
    this.forwardWheelEvents(e);
  };

  onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.resizeStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => this.resizeMove(ev.clientX, ev.clientY);
    const onUp = () => {
      this.isResizing = false;
      this.w.rootEl.removeEventListener("mousemove", onMove);
      this.w.rootEl.removeEventListener("mouseup", onUp);
    };
    this.w.rootEl.addEventListener("mousemove", onMove);
    this.w.rootEl.addEventListener("mouseup", onUp);
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

  setTracked(tracked: TrackedObject3D) {
    this.tracked = tracked;
  }

  setWords(words: string) {
    this.words = words;
    this.epochMs = Date.now();
    this.w.bubble.update();
  }

  update: () => void = noop;
}

function noop() {}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
