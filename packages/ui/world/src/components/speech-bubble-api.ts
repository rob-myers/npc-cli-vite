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
  selectElName: string;

  // Screen-pixel initial offset hint — converted to world units in initializeOffset().
  initOffset = { x: 60, y: -20 };
  offsetInitialized = false;
  isDragging = false;
  dragStartClient = { x: 0, y: 0 };
  dragWorldOffsetAtStart = { x: 0, y: 0, z: 0 };

  connectorSvg: SVGSVGElement | null = null;
  connectorPolyline: SVGPolylineElement | null = null;

  constructor(key: string, w: WorldState) {
    this.key = key;
    this.w = w;
    this.selectElName = `${key}-bubble-options`;
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

  /**
   * Convert initOffset (screen pixels) to a world-space delta and store in this.offset.
   * Call once after mount when the camera is ready.
   */
  initializeOffset() {
    if (this.offsetInitialized || !this.tracked || !this.w?.r3f) return;
    this.offsetInitialized = true;
    const { camera } = this.w.r3f;
    const { width, height } = this.w.r3f.get().size;

    // Anchor: NPC world pos + tracked offset
    tmpVec.setFromMatrixPosition(this.tracked.object.matrixWorld).add(this.tracked.offset);

    // Project to get NDC depth and screen position
    tmpVec2.copy(tmpVec).project(camera);
    const ndcZ = tmpVec2.z;
    const screenX = (tmpVec2.x * width) / 2 + width / 2;
    const screenY = (-tmpVec2.y * height) / 2 + height / 2;

    // Unproject target screen position (anchor + initOffset) at same depth
    tmpVec2
      .set(
        ((screenX + this.initOffset.x) / width) * 2 - 1,
        -((screenY + this.initOffset.y) / height) * 2 + 1,
        ndcZ,
      )
      .unproject(camera);

    this.offset.x = tmpVec2.x - tmpVec.x;
    this.offset.y = tmpVec2.y - tmpVec.y;
    this.offset.z = tmpVec2.z - tmpVec.z;
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
    tmpVec.set(
      (this.dragStartClient.x / width) * 2 - 1,
      -(this.dragStartClient.y / height) * 2 + 1,
      ndcZ,
    ).unproject(camera);

    tmpVec2.set(
      (e.clientX / width) * 2 - 1,
      -(e.clientY / height) * 2 + 1,
      ndcZ,
    ).unproject(camera);

    this.offset.x = this.dragWorldOffsetAtStart.x + tmpVec2.x - tmpVec.x;
    this.offset.y = this.dragWorldOffsetAtStart.y + tmpVec2.y - tmpVec.y;
    this.offset.z = this.dragWorldOffsetAtStart.z + tmpVec2.z - tmpVec.z;

    this.html3d?.onFrame();
  }

  onDragEnd(_e: PointerEvent) {
    this.isDragging = false;
  }

  setTracked(tracked: TrackedObject3D) {
    this.tracked = tracked;
  }

  updateConnector() {
    if (!this.connectorPolyline || !this.tracked || !this.html3d.domTarget) return;

    const cr = this.html3d.domTarget.getBoundingClientRect();
    const br = this.html3d.innerDiv.getBoundingClientRect();

    tmpVec
      .setFromMatrixPosition(this.tracked.object.matrixWorld)
      .addScaledVector(this.tracked.offset, labelCenterFrac);
    const [nx, ny] = toScreen(tmpVec, this.w.r3f);

    const bLeft = br.left - cr.left;
    const bRight = br.right - cr.left;
    const bTop = br.top - cr.top;
    const bBottom = br.bottom - cr.top;

    // Nearest point on bubble rect to label center
    const bx = Math.max(bLeft, Math.min(bRight, nx));
    const by = Math.max(bTop, Math.min(bBottom, ny));

    this.connectorPolyline.setAttribute("points", `${nx},${ny} ${bx},${by}`);
  }

  update: () => void = noop;
}

function noop() {}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
// fraction along tracked.offset (npcDefaultBubbleHeight=1.8) to reach label center
const labelCenterFrac = 1.6 / 1.8;

function toScreen(v: THREE.Vector3, r3f: WorldState["r3f"]): [number, number] {
  const { camera } = r3f;
  const { width, height } = r3f.get().size;
  tmpVec.copy(v).project(camera);
  return [(tmpVec.x * width) / 2 + width / 2, (-tmpVec.y * height) / 2 + height / 2];
}
