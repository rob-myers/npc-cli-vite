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
  /** 3D world-space offset from the tracked anchor — driven by initOffset and drag. */
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

  connectorSvg: SVGSVGElement | null = null;
  connectorPolyline: SVGPolylineElement | null = null;

  constructor(key: string, w: WorldState) {
    this.key = key;
    this.w = w;
  }

  dispose() {
    this.tracked = null;
    this.update = noop;
    this.w = null as any;
    this.html3dRef(null);
    this.unmountConnector();
  }

  forwardWheelEvents(e: React.WheelEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  html3dRef(html3d: Html3dState | null) {
    if (html3d !== null) {
      this.html3d = html3d;
      const orig = html3d.computePosition.bind(html3d);
      // Only hook in updateConnector — position comes from Html3d via b.offset prop.
      html3d.computePosition = () => {
        const pos = orig();
        this.updateConnector();
        return pos;
      };
    } else {
      this.html3d = null as any;
    }
  }

  initializeOffset() {
    if (this.offsetInitialized) return;
    this.offsetInitialized = true;
    this.offset.x = 0;
    this.offset.y = defaultBubbleYOffset;
    this.offset.z = 0;
  }

  isMounted() {
    return this.connectorSvg !== null;
  }

  mountConnector() {
    const parent = this.html3d?.domTarget;
    if (!parent || this.connectorSvg) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible";

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("stroke", "rgba(255,255,255,0.25)");
    polyline.setAttribute("stroke-width", "1.5");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    parent.appendChild(svg);
    this.connectorSvg = svg;
    this.connectorPolyline = polyline;
  }

  unmountConnector() {
    this.connectorSvg?.remove();
    this.connectorSvg = null;
    this.connectorPolyline = null;
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

  updateConnector() {
    if (!this.connectorPolyline || !this.tracked || !this.html3d.domTarget) return;

    const cr = this.html3d.domTarget.getBoundingClientRect();
    const br = (this.bubbleDiv ?? this.html3d.innerDiv).getBoundingClientRect();

    // Head top in screen space
    tmpVec.setFromMatrixPosition(this.tracked.object.matrixWorld).addScaledVector(this.tracked.offset, headTopFrac);
    const [hx, hy] = toScreen(tmpVec, this.w.r3f);

    // Bubble bottom center in container coords
    const bBottom = br.bottom - cr.top;
    const bCx = (br.left + br.right) / 2 - cr.left;

    // Only draw when bubble is above head top (screen Y increases downward)
    if (bBottom >= hy) {
      this.connectorPolyline.setAttribute("points", "");
      return;
    }

    this.connectorPolyline.setAttribute("points", `${hx},${hy} ${bCx},${bBottom}`);
  }

  update: () => void = noop;
}

function noop() {}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const defaultBubbleYOffset = 0.5; // world meters above the bubble anchor
// fraction along tracked.offset (npcDefaultBubbleHeight=1.8) to reach head top
const headTopFrac = 1.55 / 1.8;

function toScreen(v: THREE.Vector3, r3f: WorldState["r3f"]): [number, number] {
  const { camera } = r3f;
  const { width, height } = r3f.get().size;
  tmpVec.copy(v).project(camera);
  return [(tmpVec.x * width) / 2 + width / 2, (-tmpVec.y * height) / 2 + height / 2];
}
