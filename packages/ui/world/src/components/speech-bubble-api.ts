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

  scale = 1;
  isResizing = false;
  resizeStartClient = { x: 0, y: 0 };
  resizeScaleAtStart = 1;
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
    this.offset.x = 0;
    this.offset.y = defaultBubbleYOffset;
    this.offset.z = 0;
  }

  isMounted() {
    return this.offsetInitialized;
  }

  onDragStart(e: PointerEvent) {
    this.isDragging = true;
    this.dragStartClient = { x: e.clientX, y: e.clientY };
    this.dragWorldOffsetAtStart = { x: this.offset.x, y: this.offset.y, z: this.offset.z };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  onDragMove(e: PointerEvent) {
    if (!this.isDragging || !this.tracked) return;
    const { camera } = this.w.r3f;
    const { width, height } = this.w.r3f.get().size;

    // NDC depth of tracked anchor
    tmpVec.setFromMatrixPosition(this.tracked.object.matrixWorld).add(this.tracked.offset);
    const ndcZ = tmpVec2.copy(tmpVec).project(camera).z;

    // Unproject drag-start and current pointer positions at anchor depth
    tmpVec
      .set((this.dragStartClient.x / width) * 2 - 1, -(this.dragStartClient.y / height) * 2 + 1, ndcZ)
      .unproject(camera);

    tmpVec2.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1, ndcZ).unproject(camera);

    // Constrain to vertical only — bubble stays directly above NPC
    this.offset.y = this.dragWorldOffsetAtStart.y + tmpVec2.y - tmpVec.y;

    this.html3d?.onFrame();
  }

  onDragEnd(_e: PointerEvent) {
    this.isDragging = false;
  }

  onResizeStart(e: PointerEvent) {
    this.isResizing = true;
    this.resizeStartClient = { x: e.clientX, y: e.clientY };
    this.resizeScaleAtStart = this.scale;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  onResizeMove(e: PointerEvent) {
    if (!this.isResizing || !this.bubbleDiv) return;
    const dx = e.clientX - this.resizeStartClient.x;
    const dy = e.clientY - this.resizeStartClient.y;
    this.scale = Math.min(Math.max(this.resizeScaleAtStart * Math.exp((dx + dy) * 0.005), 0.4), 4);
    this.bubbleDiv.style.transform = `scale(${this.scale})`;
    this.html3d?.onFrame();
  }

  onResizeEnd(_e: PointerEvent) {
    this.isResizing = false;
  }

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
const defaultBubbleYOffset = 0.5; // world meters above the bubble anchor
