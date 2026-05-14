import * as THREE from "three";
import type { State as Html3dState, TrackedObject3D } from "../components/Html3d";
import type { State as WorldState } from "./World";

/**
 * 🔔 Avoid function-valued properties: our HMR strategy doesn't handle them,
 * in particular they won't be overwritten when the function is changed.
 */
export class SpeechBubbleApi {
  epochMs = 0;

  html3d: Html3dState = null!;
  uiRootEl: HTMLDivElement | null = null;

  position = new THREE.Vector3();
  tracked: TrackedObject3D | null = null;
  offset = { x: 0, y: 0, z: 0 };

  resolveOnMount: () => void = noop;

  key: string;
  w: WorldState;
  selectElName: string;

  constructor(key: string, w: WorldState) {
    this.key = key;
    this.w = w;
    this.selectElName = `${key}-bubble-options`;
  }

  dispose() {
    this.tracked = null;
    this.update = noop;
    this.w = null!;
    this.html3dRef(null);
  }

  forwardPointerEvents(e: React.PointerEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new PointerEvent(e.nativeEvent.type, e.nativeEvent));
  }

  forwardWheelEvents(e: React.WheelEvent) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  html3dRef(html3d: Html3dState | null) {
    if (html3d !== null) {
      this.html3d = html3d;
    } else {
      this.html3d = null!;
    }
  }

  isMounted() {
    return this.uiRootEl !== null;
  }

  setTracked(tracked: TrackedObject3D) {
    this.tracked = tracked;
  }

  thoughtUiRef(uiRootEl: HTMLDivElement | null) {
    if (uiRootEl !== null) {
      this.uiRootEl = uiRootEl;
    } else {
      this.uiRootEl = null;
    }
  }

  update: () => void = noop;
}

function noop() {}
