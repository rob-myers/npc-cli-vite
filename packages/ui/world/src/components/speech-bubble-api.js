import * as THREE from "three";

/**
 * 🔔 Avoid function-valued properties: our HMR strategy doesn't handle them,
 * in particular they won't be overwritten when the function is changed.
 */
export class SpeechBubbleApi {
  /** For violating React.memo */
  epochMs = 0;

  /** @type {import('../components/Html3d').State} */
  html3d = /** @type {*} */ (null);
  uiRootEl = /** @type {null | HTMLDivElement} */ (null);

  position = new THREE.Vector3();
  tracked = /** @type {null | import('../components/Html3d').TrackedObject3D} */ (null);
  offset = { x: 0, y: 0, z: 0 };

  resolveOnMount = noop;

  /**
   * @param {string} key
   * @param {import('./World').State} w
   */
  constructor(key, w) {
    /** @type {string} */
    this.key = key;
    /** @type {import('./World').State} */
    this.w = w;
    /** @type {string} */
    this.selectElName = `${key}-bubble-options`;
  }

  dispose() {
    this.tracked = null;
    this.update = noop;
    // @ts-expect-error
    this.w = null;
    this.html3dRef(null);
  }

  /**
   * @param {React.PointerEvent} e
   */
  forwardPointerEvents(e) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new PointerEvent(e.nativeEvent.type, e.nativeEvent));
  }

  /**
   * @param {React.WheelEvent} e
   */
  forwardWheelEvents(e) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  /** @param {null | import('../components/Html3d').State} html3d */
  html3dRef(html3d) {
    if (html3d !== null) {
      this.html3d = html3d;
    } else {
      // @ts-expect-error
      delete this.html3d;
    }
  }

  isMounted() {
    return this.uiRootEl !== null;
  }

  /**
   * @param {import('../components/Html3d').TrackedObject3D} tracked
   */
  setTracked(tracked) {
    this.tracked = tracked;
  }

  /** @param {null | HTMLDivElement} uiRootEl */
  thoughtUiRef(uiRootEl) {
    if (uiRootEl !== null) {
      this.uiRootEl = uiRootEl;
    } else {
      // @ts-expect-error
      delete this.uiRootEl;
    }
  }

  update = noop;
}

function noop() {}
