import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { deltaAngle } from "maath/misc";
import * as THREE from "three";
import { EventDispatcher, type PerspectiveCamera, TOUCH } from "three";

type ControlsEventMap = { change: object; start: object; end: object };

class ExtraZoom {
  private _ctrl: CameraControls;
  /** True while inside extra-zoom range (radius < minDistance) */
  active = false;
  /** True when camera is at minDistance — visual indicator only */
  ready = false;
  _activeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  _normalZoomTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  _cooldownTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(ctrl: CameraControls) {
    this._ctrl = ctrl;
  }

  get minR() {
    const c = this._ctrl;
    return this.active ? c.minDistance / c.extraZoom : c.minDistance;
  }

  get maxR() {
    const c = this._ctrl;
    return this.active ? c.minDistance : c.maxDistance;
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.startCooldown();
      this.setReady(true);
    }
    this._ctrl.domElement.dispatchEvent(new CustomEvent("extrazoomchange", { detail: { active }, bubbles: true }));
  }

  setReady(ready: boolean) {
    if (this.ready === ready) return;
    this.ready = ready;
    this._ctrl.domElement.dispatchEvent(new CustomEvent("extrazoomready", { detail: { ready }, bubbles: true }));
  }

  startCooldown() {
    clearTimeout(this._cooldownTimer);
    this._cooldownTimer = setTimeout(() => {
      this._cooldownTimer = undefined;
    }, 150);
  }

  /** Returns false if blocked (tween-back in progress) */
  handleWheelIn(event: WheelEvent, zoomScale: number): boolean {
    const ctrl = this._ctrl;
    if (this.active && this._activeTimer === undefined) return false;
    if (ctrl.extraZoom > 1 && (this.active || ctrl.spherical.radius <= ctrl.minDistance * 1.05)) {
      if (!this.active) ctrl.u.panOffset.set(0, 0, 0); // freeze target on entry
      this.setActive(true);
      this.setReady(false);
      clearTimeout(this._normalZoomTimer);
      ctrl.updateMouseParameters(event);
      ctrl.dollyIn(zoomScale);
      clearTimeout(this._activeTimer);
      this._activeTimer = setTimeout(() => {
        this._activeTimer = undefined;
        ctrl.dispatchEvent(changeEvent); // kick frame chain in demand frameloop
      }, 300);
    } else {
      ctrl.updateMouseParameters(event);
      ctrl.dollyIn(zoomScale);
      if (ctrl.extraZoom > 1) {
        clearTimeout(this._normalZoomTimer);
        this._normalZoomTimer = setTimeout(() => {
          this._normalZoomTimer = undefined;
          this.setReady(ctrl.spherical.radius <= ctrl.minDistance * 1.05);
        }, 50);
      }
    }
    return true;
  }

  handleWheelOut(): void {
    clearTimeout(this._normalZoomTimer);
    if (this.active) {
      clearTimeout(this._activeTimer);
      this._activeTimer = undefined;
    }
    if (this._cooldownTimer !== undefined) {
      this.startCooldown(); // keep extending — delay showing "ready" indicator
    } else {
      this.setReady(false);
    }
  }

  handleTouchDolly(ratio: number) {
    const ctrl = this._ctrl;
    if (ratio > 1) {
      // spreading fingers (zoom in)
      if (this.active || ctrl.spherical.radius / ratio <= ctrl.minDistance * 1.05) {
        if (!this.active) {
          ctrl.u.panOffset.set(0, 0, 0);
          this.setActive(true);
          this.setReady(false);
        }
      }
    } else if (ratio < 1) {
      // pinching fingers (zoom out)
      this.setReady(false);
    }
  }

  applyClamp(spherical: THREE.Spherical, u: CameraControls["u"]) {
    const ctrl = this._ctrl;
    const minR = ctrl.minDistance / ctrl.extraZoom;
    spherical.radius = Math.max(minR, Math.min(ctrl.minDistance, spherical.radius * u.scale));
    if (spherical.radius >= ctrl.minDistance) {
      this.setActive(false);
    }
  }

  applyTween(spherical: THREE.Spherical, u: CameraControls["u"]) {
    const ctrl = this._ctrl;
    if (spherical.radius >= ctrl.minDistance) {
      this.setActive(false);
      return;
    }
    const tweenTarget = ctrl.minDistance * 1.06;
    const remaining = tweenTarget - spherical.radius;
    const step = remaining < 0.05 ? remaining : remaining * 0.05;
    if (u.dollyDirection.lengthSq() > 0) {
      // wheel/mouse: drive via handleZoomToCursor so cursor stays pinned
      u.scale = (spherical.radius + step) / spherical.radius;
      u.zoomingToCursor = true;
    } else {
      // touch: apply step directly — u.scale is reset before next run
      spherical.radius = Math.min(tweenTarget, spherical.radius + step);
    }
    ctrl.dispatchEvent(changeEvent); // keep frame chain alive during slow tween
  }

  onPointerUp() {
    if (this.active && this._activeTimer === undefined) {
      this._ctrl.dispatchEvent(changeEvent);
    }
  }
}

/**
 * Based on:
 * > https://github.com/pmndrs/three-stdlib/blob/main/src/controls/OrbitControls.ts
 */
export class CameraControls extends EventDispatcher<ControlsEventMap> {
  object: PerspectiveCamera;
  domElement: HTMLElement;
  /** Set to false to disable this control */
  enabled = true;
  /** "target" sets the location of focus, where the object orbits around */
  target = new THREE.Vector3();
  /** How far you can dolly in and out ( PerspectiveCamera only ) */
  minDistance = 0;
  maxDistance = Infinity;
  /** How far you can orbit vertically, upper and lower limits.
   * Range is 0 to Math.PI radians. */
  minPolarAngle = 0;
  maxPolarAngle = Math.PI;
  /** How far you can orbit horizontally, upper and lower limits.
   * If set, the interval [ min, max ] must be a sub-interval of [ - 2 PI, 2 PI ], with ( max - min < 2 PI ) */
  minAzimuthAngle = -Infinity;
  maxAzimuthAngle = Infinity;
  panDampingFactor = defaultDampingFactor;
  azimuthalDampingFactor = defaultDampingFactor * (isTouchDevice() ? 2 : 1);
  polarDampingFactor = defaultDampingFactor * (isTouchDevice() ? 2 : 1);
  /**
   * This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
   * Set to false to disable zooming.
   */
  enableZoom = true;
  zoomSpeed = 1.0;
  /** Set to false to disable rotating */
  enableRotate = true;
  rotateSpeed = 1.0;
  /** Set to false to disable panning */
  enablePan = true;
  panSpeed = 1.0;
  keyPanSpeed = 7.0;
  zoomToCursor = true;

  target0 = new THREE.Vector3();
  position0 = new THREE.Vector3();
  zoom0 = 1;

  spherical = new THREE.Spherical();
  sphericalDelta = new THREE.Spherical();

  ray = new THREE.Ray();
  plane = new THREE.Plane();
  TILT_LIMIT = Math.cos(70 * (Math.PI / 180));
  EPS = 1e-6;

  STATE = {
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_PAN: 4,
    TOUCH_DOLLY_PAN: 5,
    TOUCH_DOLLY_ROTATE: 6,
    TOUCH_POLAR: 7,
  } as const;

  state: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = this.STATE.NONE;

  /** Update state */
  u = {
    dollyDelta: new THREE.Vector2(),
    dollyEnd: new THREE.Vector2(),
    dollyStart: new THREE.Vector2(),
    dollyDirection: new THREE.Vector3(),
    lastPosition: new THREE.Vector3(),
    lastQuaternion: new THREE.Quaternion(),
    mouse: new THREE.Vector2(),
    offset: new THREE.Vector3(),
    panOffset: new THREE.Vector3(),
    /** pointer delta */
    panDelta: new THREE.Vector2(),
    /** pointer end */
    panEnd: new THREE.Vector2(),
    /** pointer start */
    panStart: new THREE.Vector2(),
    rotateEnd: new THREE.Vector2(),
    rotateDelta: new THREE.Vector2(),
    rotateStart: new THREE.Vector2(),
    scale: 1,
    up: new THREE.Vector3(0, 1, 0),
    zoomingToCursor: false,
  };

  pointers: PointerEvent[] = [];
  pointerPositions: { [key: string]: THREE.Vector2 } = {};

  //#region MapControls
  /** if false, pan orthogonal to world-space direction camera.up */
  screenSpacePanning = false;

  touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.ROTATE,
  };
  //#endregion

  //#region Custom
  params = { fixedPolar: false, fixedAzimuth: false, snapAzimuth: false };

  rotateAxis: "none" | "horizontal" | "vertical" = "none";
  /** `(clientX, clientY)` of first pointerdown */
  pointerFirstDown = { x: 0, y: 0 };
  /** `(clientX, clientY)` of last pointerup */
  pointerLastUp = { x: 0, y: 0 };
  /** Length of "last" `|this.pointerLastUp - this.pointerFirstDown|` */
  lastPointerDistance = 0;
  /** Allow zooming in beyond minDistance by this factor; tweens back when released */
  extraZoom = 1;
  _ez: ExtraZoom;

  snapAzimuth = {
    target: 0,
    accum: 0,
    lastSign: 0,
    animating: false,
  };

  twoFinger = {
    gesture: "undecided" as "undecided" | "rotate" | "zoom",
    start: {} as Record<number, { x: number; y: number }>,
  };

  get extraZoomActive() {
    return this._ez.active;
  }
  get readyForExtraZoom() {
    return this._ez.ready;
  }
  //#endregion

  constructor(object: PerspectiveCamera, domElement: HTMLElement) {
    super();

    this.object = object;
    this.domElement = domElement;

    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
    this._ez = new ExtraZoom(this);
  }

  addPointer(event: PointerEvent) {
    this.pointers.push(event);
  }

  connect(domElement: HTMLElement) {
    this.domElement = domElement;

    // disables touch scroll
    // touch-action needs to be defined for pointer events to work on mobile
    // https://stackoverflow.com/a/48254578
    this.domElement.style.touchAction = "none";

    this.domElement.addEventListener("contextmenu", this.onContextMenu);
    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointercancel", this.onPointerUp);
    this.domElement.addEventListener("wheel", this.onMouseWheel);
  }

  clampDistance(dist: number) {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  dispose() {
    this.domElement.style.touchAction = "auto"; // 🚧
    this.domElement.removeEventListener("contextmenu", this.onContextMenu);
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointercancel", this.onPointerUp);
    this.domElement.removeEventListener("wheel", this.onMouseWheel);
    this.domElement.ownerDocument.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
  }

  dollyIn(dollyScale: number) {
    this.u.scale = this.u.scale * dollyScale;
  }

  dollyOut(dollyScale: number) {
    this.u.scale = this.u.scale / dollyScale;
  }

  getAzimuthalAngle() {
    return this.spherical.theta;
  }

  getBasis() {
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const z = new THREE.Vector3();
    this.object.matrixWorld.extractBasis(x, y, z);
    return { x: x.normalize(), y: y.normalize(), z: z.normalize() };
  }

  getDistance() {
    return this.object.position.distanceTo(this.target);
  }

  getDirection() {
    const dir = new THREE.Vector3();
    return this.object.getWorldDirection(dir);
  }

  getPolarAngle() {
    return this.spherical.phi;
  }

  getSecondPointerPosition(event: PointerEvent) {
    const pointer = event.pointerId === this.pointers[0].pointerId ? this.pointers[1] : this.pointers[0];
    return this.pointerPositions[pointer.pointerId];
  }

  getZoomScale() {
    // closer to 1 is slower
    return 0.95 ** this.zoomSpeed;
  }

  handleMouseDownDolly(event: MouseEvent) {
    this.updateMouseParameters(event);
    this.u.dollyStart.set(event.clientX, event.clientY);
  }

  handleMouseDownPan(event: MouseEvent) {
    this.u.panStart.set(event.clientX, event.clientY);
  }

  handleMouseDownRotate(event: MouseEvent) {
    this.u.rotateStart.set(event.clientX, event.clientY);
  }

  handleMouseMoveDolly(event: MouseEvent) {
    this.u.dollyEnd.set(event.clientX, event.clientY);
    this.u.dollyDelta.subVectors(this.u.dollyEnd, this.u.dollyStart);

    if (this.u.dollyDelta.y > 0) {
      this.dollyOut(this.getZoomScale());
    } else if (this.u.dollyDelta.y < 0) {
      this.dollyIn(this.getZoomScale());
    }

    this.u.dollyStart.copy(this.u.dollyEnd);
    this.update();
  }

  handleMouseMovePan(event: MouseEvent) {
    // if (this.extraZoomActive) return;
    this.u.panEnd.set(event.clientX, event.clientY);
    this.u.panDelta.subVectors(this.u.panEnd, this.u.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.u.panDelta.x, this.u.panDelta.y);
    this.u.panStart.copy(this.u.panEnd);
    this.update();
  }

  handleMouseMoveRotate(event: MouseEvent) {
    if (this._ez.active) this.u.dollyDirection.set(0, 0, 0);
    this.u.rotateEnd.set(event.clientX, event.clientY);
    this.u.rotateDelta.subVectors(this.u.rotateEnd, this.u.rotateStart).multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    if (element) {
      if (this.params.snapAzimuth) {
        this.handleDirectionalSnap(event.clientX, event.clientY);
      } else {
        const isFree = !this.params.fixedPolar;
        if (isFree && this.rotateAxis === "none") {
          const ax = Math.abs(this.u.rotateDelta.x);
          const ay = Math.abs(this.u.rotateDelta.y);
          if (ax > 2 || ay > 2) {
            this.rotateAxis = ax >= ay ? "horizontal" : "vertical";
          }
        }
        const horiz = !isFree || this.rotateAxis !== "vertical";
        const vert = isFree && this.rotateAxis !== "horizontal";
        if (horiz) this.rotateLeft((2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight);
        if (vert) this.rotateUp((2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight);
      }
    }
    this.u.rotateStart.copy(this.u.rotateEnd);
    this.update();
  }

  handleMouseWheel(event: WheelEvent) {
    if (event.shiftKey && this.params.snapAzimuth) {
      this.rotateUp(shiftWheelPolarStep * Math.sign(event.deltaY));
      this.update();
      return;
    }
    const zoomScale = this.getZoomScale();
    if (event.deltaY < 0) {
      if (!this._ez.handleWheelIn(event, zoomScale)) return;
    } else if (event.deltaY > 0) {
      this._ez.handleWheelOut();
      this.updateMouseParameters(event);
      this.dollyOut(zoomScale);
    }
    this.update();
  }

  handleTouchMoveDolly(event: PointerEvent) {
    const position = this.getSecondPointerPosition(event);
    const distance = Math.hypot(event.pageX - position.x, event.pageY - position.y);

    this.u.dollyEnd.set(0, distance);
    this.u.dollyDelta.set(0, (this.u.dollyEnd.y / this.u.dollyStart.y) ** this.zoomSpeed);
    const ratio = this.u.dollyDelta.y;

    if (this.extraZoom > 1) this._ez.handleTouchDolly(ratio);

    this.dollyOut(ratio);
    this.u.dollyStart.copy(this.u.dollyEnd);
  }

  handleTouchMoveDollyPan(event: PointerEvent) {
    if (this.enableZoom === true) this.handleTouchMoveDolly(event);
    if (this.enablePan === true) this.handleTouchMovePan(event);
  }

  handleTouchMoveDollyRotate(event: PointerEvent) {
    if (this.enableZoom === true) this.handleTouchMoveDolly(event);
    if (this.enableRotate === true) this.handleTouchMoveRotate(event);
  }

  handleTwoFingerMove(event: PointerEvent) {
    const pos0 = this.pointerPositions[this.pointers[0].pointerId];
    const pos1 = this.pointerPositions[this.pointers[1].pointerId];
    if (!pos0 || !pos1) return;

    const start0 = this.twoFinger.start[this.pointers[0].pointerId];
    const start1 = this.twoFinger.start[this.pointers[1].pointerId];
    if (!start0 || !start1) return;

    const dx0 = pos0.x - start0.x,
      dy0 = pos0.y - start0.y;
    const dx1 = pos1.x - start1.x,
      dy1 = pos1.y - start1.y;
    const len0 = Math.hypot(dx0, dy0);
    const len1 = Math.hypot(dx1, dy1);

    const minMove = this.twoFinger.gesture === "undecided" ? twoFingerMinMove : 1;
    if (len0 < minMove || len1 < minMove) return;

    const dot = (dx0 * dx1 + dy0 * dy1) / (len0 * len1);

    if (this.twoFinger.gesture === "undecided") {
      if (dot > twoFingerSameDirThreshold) {
        this.twoFinger.gesture = "rotate";
        this.handleTouchStartRotate();
      } else if (dot < -twoFingerSameDirThreshold) {
        this.twoFinger.gesture = "zoom";
        this.handleTouchStartDolly();
      }
      return;
    }

    const directionChanged =
      (this.twoFinger.gesture === "rotate" && dot < twoFingerStopThreshold) ||
      (this.twoFinger.gesture === "zoom" && dot > twoFingerZoomStopThreshold);

    if (directionChanged) {
      this.twoFinger.gesture = "undecided";
      for (const p of this.pointers) {
        const pos = this.pointerPositions[p.pointerId];
        if (pos) this.twoFinger.start[p.pointerId] = { x: pos.x, y: pos.y };
      }
      return;
    }

    if (this.twoFinger.gesture === "rotate") {
      this.handleTouchMoveRotate(event);
    } else {
      const other = this.getSecondPointerPosition(event)!;
      const dist = Math.hypot(event.pageX - other.x, event.pageY - other.y);
      this.u.dollyEnd.set(0, dist);
      const baseRatio = (dist / this.u.dollyStart.y) ** this.zoomSpeed;
      const ratio = 1 + (baseRatio - 1) * twoFingerZoomBoost;
      if (this.extraZoom > 1) this._ez.handleTouchDolly(ratio);
      this.dollyOut(ratio);
      this.u.dollyStart.copy(this.u.dollyEnd);
    }
  }

  handleTouchMovePan(event: PointerEvent) {
    if (this._ez.active && this.pointers.length !== 1) return;
    if (this.pointers.length == 1) {
      this.u.panEnd.set(event.pageX, event.pageY);
    } else {
      const position = this.getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this.u.panEnd.set(x, y);
    }

    this.u.panDelta.subVectors(this.u.panEnd, this.u.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.u.panDelta.x, this.u.panDelta.y);
    this.u.panStart.copy(this.u.panEnd);
  }

  handleTouchMoveRotate(event: PointerEvent) {
    if (this.pointers.length === 1) {
      this.u.rotateEnd.set(event.pageX, event.pageY);
    } else if (this.pointers.length === 2) {
      const position = this.getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this.u.rotateEnd.set(x, y);
    } else {
      let cx = 0,
        cy = 0;
      for (const pos of Object.values(this.pointerPositions)) {
        cx += pos.x;
        cy += pos.y;
      }
      const n = Object.keys(this.pointerPositions).length;
      this.u.rotateEnd.set(cx / n, cy / n);
    }

    this.u.rotateDelta.subVectors(this.u.rotateEnd, this.u.rotateStart).multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    if (element) {
      if (this.params.snapAzimuth) {
        const cx = this.pointers.length === 1 ? event.pageX : this.u.rotateEnd.x;
        const cy = this.pointers.length === 1 ? event.pageY : this.u.rotateEnd.y;
        this.handleDirectionalSnap(cx, cy);
      } else {
        const isFree = !this.params.fixedPolar;
        if (isFree && this.rotateAxis === "none") {
          const ax = Math.abs(this.u.rotateDelta.x);
          const ay = Math.abs(this.u.rotateDelta.y);
          if (ax > 2 || ay > 2) {
            this.rotateAxis = ax >= ay ? "horizontal" : "vertical";
          }
        }
        const horiz = !isFree || this.rotateAxis !== "vertical";
        const vert = isFree && this.rotateAxis !== "horizontal";
        if (horiz) this.rotateLeft((2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight);
        if (vert) this.rotateUp((2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight);
      }
    }
    this.u.rotateStart.copy(this.u.rotateEnd);
  }

  handleTouchStartDollyRotate() {
    if (this.enableZoom === true) {
      this.handleTouchStartDolly();
    }
    if (this.enableRotate === true) {
      this.handleTouchStartRotate();
    }
  }

  handleTouchStartDollyPan() {
    if (this.enableZoom === true) {
      this.handleTouchStartDolly();
    }
    if (this.enablePan === true) {
      this.handleTouchStartPan();
    }
  }

  handleTouchStartDolly() {
    const p0 = this.pointerPositions[this.pointers[0].pointerId];
    const p1 = this.pointerPositions[this.pointers[1].pointerId];
    const x0 = p0?.x ?? this.pointers[0].pageX;
    const y0 = p0?.y ?? this.pointers[0].pageY;
    const x1 = p1?.x ?? this.pointers[1].pageX;
    const y1 = p1?.y ?? this.pointers[1].pageY;
    this.u.dollyStart.set(0, Math.hypot(x0 - x1, y0 - y1));
  }

  handleTouchStartPan() {
    if (this.pointers.length == 1) {
      this.u.panStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
    } else {
      const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
      const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
      this.u.panStart.set(x, y);
    }
  }

  handleTouchStartRotate() {
    if (this.pointers.length === 1) {
      this.u.rotateStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
    } else {
      let cx = 0,
        cy = 0;
      for (const p of this.pointers) {
        const pos = this.pointerPositions[p.pointerId];
        cx += pos?.x ?? p.pageX;
        cy += pos?.y ?? p.pageY;
      }
      this.u.rotateStart.set(cx / this.pointers.length, cy / this.pointers.length);
    }
  }

  handleZoomToCursor() {
    const prevRadius = this.u.offset.length();
    const minR = this._ez.minR;
    const maxR = this._ez.maxR;
    const newRadius = Math.max(minR, Math.min(maxR, prevRadius * this.u.scale));

    const radiusDelta = prevRadius - newRadius;
    this.object.position.addScaledVector(this.u.dollyDirection, radiusDelta);
    this.object.updateMatrixWorld();

    if (this.screenSpacePanning === true) {
      this.target
        .set(0, 0, -1)
        .transformDirection(this.object.matrix)
        .multiplyScalar(newRadius)
        .add(this.object.position);
    } else {
      this.ray.origin.copy(this.object.position);
      this.ray.direction.set(0, 0, -1).transformDirection(this.object.matrix);
      if (Math.abs(this.object.up.dot(this.ray.direction)) < this.TILT_LIMIT) {
        this.object.lookAt(this.target);
      } else {
        this.plane.setFromNormalAndCoplanarPoint(this.object.up, this.target);
        this.ray.intersectPlane(this.plane, this.target);
      }
    }
  }

  onContextMenu = (event: MouseEvent) => {
    if (this.enabled === false) return;
    event.preventDefault();
  };

  onMouseDown = (event: MouseEvent) => {
    if (this.enabled === false) return;
    event.preventDefault();

    let mouseAction: number;
    switch (event.button) {
      case 0:
        mouseAction = THREE.MOUSE.PAN;
        break;
      case 1:
        mouseAction = THREE.MOUSE.DOLLY;
        break;
      case 2:
        mouseAction = THREE.MOUSE.ROTATE;
        break;
      default:
        mouseAction = -1;
    }

    switch (mouseAction) {
      case THREE.MOUSE.DOLLY:
        if (this.enableZoom === false) return;
        this.handleMouseDownDolly(event);
        this.state = this.STATE.DOLLY;
        break;
      case THREE.MOUSE.ROTATE:
        if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) {
          if (this.enablePan === false) return;
          this.handleMouseDownPan(event);
          this.state = this.STATE.PAN;
        } else {
          if (this.enableRotate === false) return;
          this.handleMouseDownRotate(event);
          this.state = this.STATE.ROTATE;
        }
        break;
      case THREE.MOUSE.PAN:
        if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) {
          if (this.enableRotate === false) return;
          this.handleMouseDownRotate(event);
          this.state = this.STATE.ROTATE;
        } else {
          if (this.enablePan === false) return;
          this.handleMouseDownPan(event);
          this.state = this.STATE.PAN;
        }
        break;
      default:
        this.state = this.STATE.NONE;
        break;
    }

    if (this.state !== this.STATE.NONE) {
      this.dispatchEvent(startEvent);
    }
  };

  onMouseMove(event: MouseEvent) {
    if (this.enabled === false) return;

    switch (this.state) {
      case this.STATE.ROTATE:
        if (this.enableRotate === false) return;
        this.handleMouseMoveRotate(event);
        break;

      case this.STATE.DOLLY:
        if (this.enableZoom === false) return;
        this.handleMouseMoveDolly(event);
        break;

      case this.STATE.PAN:
        if (this.enablePan === false) return;
        this.handleMouseMovePan(event);
        break;
    }
  }

  onMouseWheel = (event: WheelEvent) => {
    if (
      this.enabled === false ||
      this.enableZoom === false ||
      !(this.state === this.STATE.NONE || this.state === this.STATE.TOUCH_DOLLY_PAN)
    ) {
      return;
    }
    event.preventDefault();

    this.dispatchEvent(startEvent);
    this.handleMouseWheel(event);
    this.dispatchEvent(endEvent);
  };

  onPointerDown = (event: PointerEvent) => {
    if (this.enabled === false) return;

    if (this.pointers.length === 0) {
      this.domElement?.ownerDocument.addEventListener("pointermove", this.onPointerMove);
      this.domElement?.ownerDocument.addEventListener("pointerup", this.onPointerUp);
      this.pointerFirstDown.x = event.clientX;
      this.pointerFirstDown.y = event.clientY;
    }

    this.addPointer(event);

    if (event.pointerType === "touch") {
      this.onTouchStart(event);
    } else {
      this.onMouseDown(event);
    }
  };

  onPointerMove = (event: PointerEvent) => {
    if (this.enabled === false) return;

    if (event.pointerType === "touch") {
      this.onTouchMove(event);
    } else {
      this.onMouseMove(event);
    }
  };

  onPointerUp = (event: PointerEvent) => {
    if (this.enabled === false) {
      return;
    }

    this.removePointer(event);

    if (this.pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);
      this.domElement.ownerDocument.removeEventListener("pointermove", this.onPointerMove);
      this.domElement.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
      this.pointerLastUp.x = event.clientX;
      this.pointerLastUp.y = event.clientY;
      this.lastPointerDistance = Math.hypot(
        this.pointerLastUp.x - this.pointerFirstDown.x,
        this.pointerLastUp.y - this.pointerFirstDown.y,
      );
    }

    if (this.params.snapAzimuth) {
      this.snapAzimuth.accum = 0;
      this.snapAzimuth.lastSign = 0;
    }
    this.rotateAxis = "none";

    this._ez.onPointerUp();

    this.dispatchEvent(endEvent);
    this.state = this.STATE.NONE;
  };

  onTouchMove = (event: PointerEvent) => {
    this.trackPointer(event);

    switch (this.state) {
      case this.STATE.TOUCH_ROTATE:
        if (this.enableRotate === false) return;
        this.handleTouchMoveRotate(event);
        this.update();
        break;

      case this.STATE.TOUCH_PAN:
        if (this.enablePan === false) return;
        this.handleTouchMovePan(event);
        this.update();
        break;

      case this.STATE.TOUCH_DOLLY_PAN:
        if (this.enableZoom === false && this.enablePan === false) return;
        this.handleTouchMoveDollyPan(event);
        this.update();
        break;

      case this.STATE.TOUCH_DOLLY_ROTATE:
        this.handleTwoFingerMove(event);
        this.update();
        break;

      case this.STATE.TOUCH_POLAR: {
        let cy = 0,
          n = 0;
        for (const pos of Object.values(this.pointerPositions)) {
          cy += pos.y;
          n++;
        }
        if (n === 0) break;
        const avg = cy / n;
        this.rotateUp((avg - this.u.rotateStart.y) * threeFingerPolarSensitivity);
        this.u.rotateStart.set(0, avg);
        this.update();
        break;
      }

      default:
        this.state = this.STATE.NONE;
    }
  };

  onTouchStart = (event: PointerEvent) => {
    this.trackPointer(event);

    if (this.pointers.length === 1) {
      switch (this.touches.ONE) {
        case TOUCH.ROTATE:
          if (this.enableRotate === false) return;
          this.handleTouchStartRotate();
          this.state = this.STATE.TOUCH_ROTATE;
          break;
        case TOUCH.PAN:
          if (this.enablePan === false) return;
          this.handleTouchStartPan();
          this.state = this.STATE.TOUCH_PAN;
          break;
        default:
      }

      this.dispatchEvent(startEvent);
    } else if (this.pointers.length === 2) {
      this.twoFinger.gesture = "undecided";
      this.twoFinger.start = {};
      for (const p of this.pointers) {
        const pos = this.pointerPositions[p.pointerId];
        this.twoFinger.start[p.pointerId] = pos ? { x: pos.x, y: pos.y } : { x: p.pageX, y: p.pageY };
      }
      this.state = this.STATE.TOUCH_DOLLY_ROTATE;
      this.dispatchEvent(startEvent);
    } else if (this.pointers.length === 3 && this.params.snapAzimuth) {
      let cy = 0;
      for (const p of this.pointers) cy += p.pageY;
      this.u.rotateStart.set(0, cy / 3);
      this.state = this.STATE.TOUCH_POLAR;
      this.dispatchEvent(startEvent);
    } else {
      this.state = this.STATE.NONE;
    }
  };

  pan(deltaX: number, deltaY: number) {
    const element = this.domElement;
    const offset = tempVector3One;

    if (!element) {
      return;
    }

    const position = this.object.position;
    offset.copy(position).sub(this.target);
    let targetDistance = offset.length();

    // half of the fov is center to top of screen
    targetDistance *= Math.tan(((this.object.fov / 2) * Math.PI) / 180.0);

    // we use only clientHeight here so aspect ratio does not distort speed
    this.panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.object.matrix);
    this.panUp((2 * deltaY * targetDistance) / element.clientHeight, this.object.matrix);
  }

  panLeft(distance: number, objectMatrix: THREE.Matrix4) {
    const v = tempVector3Two;
    v.setFromMatrixColumn(objectMatrix, 0); // get X column of objectMatrix
    v.multiplyScalar(-distance);

    this.u.panOffset.add(v);
  }

  panUp(distance: number, objectMatrix: THREE.Matrix4) {
    const v = tempVector3Two;
    if (this.screenSpacePanning === true) {
      v.setFromMatrixColumn(objectMatrix, 1);
    } else {
      v.setFromMatrixColumn(objectMatrix, 0);
      v.crossVectors(this.object.up, v);
    }

    v.multiplyScalar(distance);

    this.u.panOffset.add(v);
  }

  removePointer(event: PointerEvent) {
    delete this.pointerPositions[event.pointerId];
    const index = this.pointers.findIndex((p) => p.pointerId === event.pointerId);
    if (index >= 0) {
      this.pointers.splice(index, 1);
    }
  }

  reset() {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.zoom = this.zoom0;
    this.object.updateProjectionMatrix();

    this.dispatchEvent(changeEvent);

    this.update();

    this.state = this.STATE.NONE;
  }

  snapAzimuthBy(delta: number) {
    if (this.snapAzimuth.animating || Math.abs(delta) < 0.01) return;
    this.snapAzimuth.target = normalizeAngle(this.snapAzimuth.target + delta);
    this.snapAzimuth.accum = 0;
    this.snapAzimuth.animating = true;
    this.sphericalDelta.theta = deltaAngle(this.spherical.theta, this.snapAzimuth.target);
  }

  handleDirectionalSnap(clientX: number, clientY: number) {
    const dx = clientX - this.pointerFirstDown.x;
    const dy = clientY - this.pointerFirstDown.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const threshold = this.pointers.length > 1 ? 120 : 20;
    if (dist < threshold) return;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    // require dominant axis to be at least 2x the other
    if (Math.min(ax, ay) * 2 > Math.max(ax, ay)) return;
    const delta = ay > ax ? (dy > 0 ? Math.PI : 0) : dx > 0 ? -halfPi : halfPi;
    this.snapAzimuthBy(delta);
  }

  rotateLeft(angle: number) {
    if (this.params.snapAzimuth) {
      const sign = Math.sign(angle);
      if (sign !== 0 && sign !== this.snapAzimuth.lastSign) {
        this.snapAzimuth.accum = 0;
        this.snapAzimuth.lastSign = sign;
      }
      this.snapAzimuth.accum += Math.abs(angle);
      return;
    }
    this.sphericalDelta.theta -= angle;
  }

  rotateUp(angle: number) {
    this.sphericalDelta.phi -= angle;
  }

  setParams(params: Partial<typeof this.params>) {
    Object.assign(this.params, params);
  }

  saveState() {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  setAzimuthalAngle(angle: number) {
    this.sphericalDelta.theta = deltaAngle(this.spherical.theta, angle);
    this.update();
  }

  setPolarAngle(angle: number) {
    this.sphericalDelta.phi = deltaAngle(this.spherical.phi, angle);
    this.update();
  }

  trackPointer(event: PointerEvent) {
    let position = this.pointerPositions[event.pointerId];

    if (position === undefined) {
      position = new THREE.Vector2();
      this.pointerPositions[event.pointerId] = position;
    }

    position.set(event.pageX, event.pageY);
  }

  update() {
    const u = this.u;
    const object = this.object;
    const position = object.position;

    const fixedAzimuth = this.params.fixedAzimuth === true ? this.getAzimuthalAngle() : null;
    const fixedPolar = this.params.fixedPolar === true ? this.getPolarAngle() : null;

    u.offset.copy(position).sub(this.target);

    // (x, y, z) -> { r, theta, phi }
    this.spherical.setFromVector3(u.offset);

    // approach target via damped delta
    this.spherical.theta += this.sphericalDelta.theta * this.azimuthalDampingFactor;
    this.spherical.phi += this.sphericalDelta.phi * this.polarDampingFactor;

    // restrict theta to be between desired limits
    let min = fixedAzimuth ?? this.minAzimuthAngle;
    let max = fixedAzimuth ?? this.maxAzimuthAngle;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      if (min < -Math.PI) min += twoPI;
      else if (min > Math.PI) min -= twoPI;
      if (max < -Math.PI) max += twoPI;
      else if (max > Math.PI) max -= twoPI;

      if (min <= max) {
        this.spherical.theta = Math.max(min, Math.min(max, this.spherical.theta));
      } else {
        this.spherical.theta =
          this.spherical.theta > (min + max) / 2
            ? Math.max(min, this.spherical.theta)
            : Math.min(max, this.spherical.theta);
      }
    }

    if (this.params.snapAzimuth) {
      if (this.snapAzimuth.animating) {
        const remaining = deltaAngle(this.spherical.theta, this.snapAzimuth.target);
        if (Math.abs(remaining) < 0.005) {
          this.spherical.theta = this.snapAzimuth.target;
          this.sphericalDelta.theta = 0;
          this.snapAzimuth.animating = false;
          this.snapAzimuth.accum = 0;
        } else {
          this.sphericalDelta.theta = Math.sign(remaining) * Math.max(Math.abs(remaining) * 0.6, 0.08);
        }
      } else if (this.snapAzimuth.accum > Math.PI / 4) {
        this.snapAzimuthBy(this.snapAzimuth.lastSign * halfPi);
      } else {
        this.sphericalDelta.theta = 0;
        this.spherical.theta = this.snapAzimuth.target;
      }
    }

    // restrict phi to be between desired limits
    this.spherical.phi = fixedPolar ?? Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
    this.spherical.makeSafe();

    this.target.addScaledVector(this.u.panOffset, this.panDampingFactor);

    if (this.zoomToCursor === true && this.u.zoomingToCursor === true) {
      this.spherical.radius = Math.max(this._ez.minR, Math.min(this.maxDistance, this.spherical.radius));
    } else if (this._ez.active) {
      this._ez.applyClamp(this.spherical, u);
    } else {
      this.spherical.radius = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.spherical.radius * this.u.scale),
      );
    }

    if (this._ez.active && this._ez._activeTimer === undefined && this.pointers.length === 0) {
      this._ez.applyTween(this.spherical, u);
    }

    this.u.offset.setFromSpherical(this.spherical);
    position.copy(this.target).add(this.u.offset);

    if (this.object.matrixAutoUpdate === false) {
      this.object.updateMatrix();
    }
    this.object.lookAt(this.target);

    this.sphericalDelta.theta *= 1 - this.azimuthalDampingFactor;
    this.sphericalDelta.phi *= 1 - this.polarDampingFactor;
    this.u.panOffset.multiplyScalar(1 - this.panDampingFactor);

    if (this.zoomToCursor === true && this.u.zoomingToCursor === true) {
      this.handleZoomToCursor();
    }

    this.u.scale = 1;
    this.u.zoomingToCursor = false;

    if (
      this.u.lastPosition.distanceToSquared(this.object.position) > this.EPS ||
      8 * (1 - this.u.lastQuaternion.dot(this.object.quaternion)) > this.EPS
    ) {
      this.dispatchEvent(changeEvent);
      this.u.lastPosition.copy(this.object.position);
      this.u.lastQuaternion.copy(this.object.quaternion);
      return true;
    }

    return false;
  }

  /** Update `u.zoomingToCursor`, `u.mouse`, `u.dollyDirection` */
  updateMouseParameters(event: MouseEvent) {
    if (!this.zoomToCursor) {
      return;
    }
    this.u.zoomingToCursor = true;
    const { left, top, width, height } = this.domElement.getBoundingClientRect();
    this.u.mouse.set(
      2 * ((event.clientX - left) / width) - 1, // [-1, 1]
      1 - 2 * ((event.clientY - top) / height), // [-1, 1]
    );
    this.u.dollyDirection
      .set(this.u.mouse.x, this.u.mouse.y, 1)
      .unproject(this.object) // 🚧
      .sub(this.object.position)
      .normalize();
  }
}

const startEvent = { type: "start" } as const;
const endEvent = { type: "end" } as const;
const changeEvent = { type: "change" } as const;

const defaultDampingFactor = 0.05;
const twoFingerMinMove = 8;
const twoFingerSameDirThreshold = 0.7;
const twoFingerStopThreshold = 0.3;
const twoFingerZoomStopThreshold = 0.5;
const twoFingerZoomBoost = 3.0;
const shiftWheelPolarStep = Math.PI / 96;
const threeFingerPolarSensitivity = 0.006;

const halfPi = Math.PI / 2;
const twoPI = 2 * Math.PI;

function normalizeAngle(a: number) {
  return a - Math.round(a / twoPI) * twoPI;
}
const tempVector3One = new THREE.Vector3();
const tempVector3Two = new THREE.Vector3();
