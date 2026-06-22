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

  onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    this.onDragStart(e.nativeEvent);
  };

  onPointerMove = (e: React.PointerEvent) => {
    if (!this.isDragging) return;
    e.stopPropagation();
    this.onDragMove(e.nativeEvent);
  };

  onPointerUp = (e: React.PointerEvent) => {
    if (!this.isDragging) return;
    e.stopPropagation();
    this.onDragEnd(e.nativeEvent);
  };

  onWheel = (e: React.WheelEvent) => {
    this.forwardWheelEvents(e);
  };

  onResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation(); // prevent bubbleDiv's onPointerDown from starting a drag simultaneously
    this.isResizing = true;
    this.resizeStartClient = { x: e.clientX, y: e.clientY };
    this.resizeWidthAtStart = this.bubbleDiv?.offsetWidth ?? 0;
    this.resizeHeightAtStart = this.bubbleDiv?.offsetHeight ?? 0;
    // getBoundingClientRect gives screen pixels; offsetWidth gives CSS pixels — ratio is Html3d scale
    const rect = this.bubbleDiv?.getBoundingClientRect();
    this.resizeHtmlScale = rect && this.resizeWidthAtStart > 0 ? rect.width / this.resizeWidthAtStart : 1;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  onResizeMove = (e: React.PointerEvent) => {
    if (!this.isResizing || !this.bubbleDiv) return;
    const dx = (e.clientX - this.resizeStartClient.x) / this.resizeHtmlScale;
    const dy = (e.clientY - this.resizeStartClient.y) / this.resizeHtmlScale;
    // Width change is doubled: translateX(-50%) centres the bubble, so the right edge only
    // moves by half the CSS width change — multiply by 2 to keep the handle under the pointer.
    this.bubbleDiv.style.width = `${Math.max(512, this.resizeWidthAtStart + dx * 2)}px`;
    this.bubbleDiv.style.height = `${Math.max(256, this.resizeHeightAtStart + dy)}px`;
    this.html3d?.onFrame();
  };

  onResizeEnd = (_e: React.PointerEvent) => {
    this.isResizing = false;
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
