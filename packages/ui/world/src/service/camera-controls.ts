import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { deltaAngle } from "maath/misc";
import * as THREE from "three";
import { EventDispatcher, type PerspectiveCamera, TOUCH } from "three";

type ControlsEventMap = { change: object; start: object; end: object };

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
  } as const;

  state: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 = this.STATE.NONE;

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
    up: new THREE.Vector3(0, 1, 0),
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
  params = { fixedPolar: false, fixedAzimuth: false };

  rotateAxis: "none" | "horizontal" | "vertical" = "none";
  /** `(clientX, clientY)` of first pointerdown */
  pointerFirstDown = { x: 0, y: 0 };
  /** `(clientX, clientY)` of last pointerup */
  pointerLastUp = { x: 0, y: 0 };
  /** Length of "last" `|this.pointerLastUp - this.pointerFirstDown|` */
  lastPointerDistance = 0;
  /**
   * Where the view sits between its two stops: `0` at `maxDistance`, `1` at `minDistance`.
   * Gestures ADD to this rather than scaling a radius, and `update` writes the radius from it —
   * see `syncZoom`. Letting go settles it to whichever stop is nearer, so reversing cancels
   */
  zoomProgress = 0;
  /** When zoom input last arrived, so `syncZoom` can tell a gesture in progress from one let go */
  _zoomInputMs = 0;
  /** Asks for the frame on which the settle begins — see `addZoomProgress` */
  _zoomSettleTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Which way the last input moved the zoom: `1` inwards, `-1` outwards */
  _zoomDirection: 1 | -1 = 1;
  /** Whether anything has aimed `u.dollyDirection` yet — see `setDollyTowards` */
  _zoomAimed = false;
  /** Whether `zoomProgress` has been read off the camera it started at — see `update` */
  _zoomSeeded = false;

  /** Midpoint of the two fingers, whose motion rotates the camera */
  twoFingerCentroid = new THREE.Vector2();
  /** Smoothed 0..1 measure of how much of the gesture is centroid motion, not pinch */
  twoFingerRotateRatio = 1;

  minPanDistance = 0;
  //#endregion

  constructor(object: PerspectiveCamera, domElement: HTMLElement) {
    super();

    this.object = object;
    this.domElement = domElement;

    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  addPointer(event: PointerEvent) {
    this.pointers.push(event);
  }

  /**
   * Where this pointer sits amongst those pressed on us, or `-1` for one that never was —
   * `pointermove`/`pointerup` are bound to the document, so a finger pressed on the UI above
   * the canvas, e.g. the extra zoom button, reports here too.
   */
  pointerIndex(event: PointerEvent) {
    return this.pointers.findIndex((x) => x.pointerId === event.pointerId);
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
    // fires whenever pointer capture is released for ANY reason (including a browser/OS gesture
    // stealing the pointer, or losing window focus mid-drag) — pointerup/pointercancel alone can
    // silently miss these, leaving a "ghost" pointer stuck forever in `this.pointers`
    this.domElement.addEventListener("lostpointercapture", this.onLostPointerCapture);
    this.domElement.addEventListener("wheel", this.onMouseWheel);
    // window losing focus mid-drag (e.g. alt-tab) may never deliver pointerup/pointercancel/
    // lostpointercapture at all — force a full reset so no gesture can get stuck
    window.addEventListener("blur", this.onWindowBlur);
  }

  dispose() {
    this.domElement.style.touchAction = "auto"; // 🚧
    this.domElement.removeEventListener("contextmenu", this.onContextMenu);
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointercancel", this.onPointerUp);
    this.domElement.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    this.domElement.removeEventListener("wheel", this.onMouseWheel);
    this.domElement.ownerDocument.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("blur", this.onWindowBlur);
    clearTimeout(this._zoomSettleTimer);
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

  /** Middle-button drag: the same trip between the stops the wheel makes, measured in pixels */
  handleMouseMoveDolly(event: MouseEvent) {
    this.u.dollyEnd.set(event.clientX, event.clientY);
    this.u.dollyDelta.subVectors(this.u.dollyEnd, this.u.dollyStart);
    this.addZoomProgress(-this.u.dollyDelta.y / wheelDeltaPerStop);
    this.u.dollyStart.copy(this.u.dollyEnd);
    this.update();
  }

  handleMouseMovePan(event: MouseEvent) {
    this.u.panEnd.set(event.clientX, event.clientY);
    this.u.panDelta.subVectors(this.u.panEnd, this.u.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.u.panDelta.x, this.u.panDelta.y);
    this.u.panStart.copy(this.u.panEnd);
    this.update();
  }

  handleMouseMoveRotate(event: MouseEvent) {
    this.u.rotateEnd.set(event.clientX, event.clientY);
    this.u.rotateDelta.subVectors(this.u.rotateEnd, this.u.rotateStart).multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    if (element) {
      const dTheta = (2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight;
      const dPhi = (2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight;

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
      if (horiz) this.rotateLeft(dTheta);
      if (vert) this.rotateUp(dPhi);
    }
    this.u.rotateStart.copy(this.u.rotateEnd);
    this.update();
  }

  /**
   * Each notch moves the view a share of the way between the two stops, rather than scaling the
   * radius: reversing simply subtracts, so a half-finished zoom rewinds and settles back where it
   * began — see `syncZoom`, which does the settling.
   */
  handleMouseWheel(event: WheelEvent) {
    this.updateMouseParameters(event); // aims `u.dollyDirection` at the cursor
    this.addZoomProgress((-event.deltaY * this.zoomSpeed) / wheelDeltaPerStop);
    this.update();
  }

  /**
   * Two-finger motion decomposes into a centroid translation and a change of
   * spread, which are independent — so we apply both every frame, giving
   * azimuth, polar and zoom at once with no gesture to classify.
   *
   * Each has its own deadzone, else a pinch's slight centroid drift would
   * rotate, and a drag's slight spread change would zoom. Baselines only
   * advance when we act, so sub-deadzone motion accumulates rather than being lost.
   *
   * A deadzone alone cannot separate them, because a pinch genuinely moves the
   * centroid — fingers rarely close symmetrically, and one stationary finger moves
   * it by half the other's travel. So rotation is additionally faded out as the
   * change of spread comes to dominate the drift, which reads as wobble otherwise.
   */
  handleTwoFingerMove(event: PointerEvent) {
    const other = this.getSecondPointerPosition(event);
    if (!other) return;

    const element = this.domElement;
    const cx = 0.5 * (event.pageX + other.x);
    const cy = 0.5 * (event.pageY + other.y);
    const dist = Math.hypot(event.pageX - other.x, event.pageY - other.y);

    const drift = Math.hypot(cx - this.twoFingerCentroid.x, cy - this.twoFingerCentroid.y);
    const spread = Math.abs(dist - this.u.dollyStart.y);
    // smoothed, since per-event deltas are only a few px and too noisy to classify
    const driftRatio = drift + spread > 0 ? drift / (drift + spread) : this.twoFingerRotateRatio;
    this.twoFingerRotateRatio += (driftRatio - this.twoFingerRotateRatio) * twoFingerRatioSmoothing;
    // squared, so a one-finger pinch (ratio 1/3) keeps a ninth of its rotation, not a third
    const rotateScale = this.rotateSpeed * this.twoFingerRotateRatio ** 2;

    // Both channels are low-pass filtered rather than gated by a deadzone: a finger resting on
    // glass wanders a pixel or two per event, and a threshold can only withhold that noise and
    // then release it in one jump, which reads as stutter. Easing keeps slow motion responsive
    // and still delivers the full displacement, just a frame or two behind the fingers.
    const prevX = this.twoFingerCentroid.x;
    const prevY = this.twoFingerCentroid.y;
    this.twoFingerCentroid.set(prevX + (cx - prevX) * twoFingerSmoothing, prevY + (cy - prevY) * twoFingerSmoothing);

    this.rotateLeft((2 * Math.PI * (this.twoFingerCentroid.x - prevX) * rotateScale) / element.clientHeight);
    if (this.params.fixedPolar !== true) {
      this.rotateUp((2 * Math.PI * (this.twoFingerCentroid.y - prevY) * rotateScale) / element.clientHeight);
    }

    const prevDist = this.u.dollyStart.y;
    const nextDist = prevDist + (dist - prevDist) * twoFingerSmoothing;
    if (prevDist > 0 && nextDist > 0) {
      // only a PURE pinch zooms: two fingers rotate and pan as well, and a gesture whose centroid
      // is travelling is one of those — `twoFingerRotateRatio` is exactly that measure, smoothed,
      // so a gesture that begins as a rotation still starts zooming once the pinch takes over
      if (this.twoFingerRotateRatio < pinchPurity) {
        // towards the pinch itself, as the wheel zooms towards the cursor. The centroid is in PAGE
        // coordinates, where `setDollyTowards` measures against the element's client rect
        this.setDollyTowards(this.twoFingerCentroid.x - window.scrollX, this.twoFingerCentroid.y - window.scrollY);
        this.addZoomProgress(Math.log(nextDist / prevDist) / pinchLogPerStop);
      }
      this.u.dollyStart.set(0, nextDist);
    }
  }

  handleTouchMovePan(event: PointerEvent) {
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
      // unlike the mouse, touch rotates both axes at once
      this.rotateLeft((2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight);
      if (this.params.fixedPolar !== true) {
        this.rotateUp((2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight);
      }
    }
    this.u.rotateStart.copy(this.u.rotateEnd);
  }

  handleTouchStartDolly() {
    const p0 = this.pointerPositions[this.pointers[0].pointerId];
    const p1 = this.pointerPositions[this.pointers[1].pointerId];
    const x0 = p0?.x ?? this.pointers[0].pageX;
    const y0 = p0?.y ?? this.pointers[0].pageY;
    const x1 = p1?.x ?? this.pointers[1].pageX;
    const y1 = p1?.y ?? this.pointers[1].pageY;
    this.u.dollyStart.set(0, Math.hypot(x0 - x1, y0 - y1));
    this.twoFingerCentroid.set(0.5 * (x0 + x1), 0.5 * (y0 + y1));
    this.twoFingerRotateRatio = 1; // assume rotation until a pinch says otherwise
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

  /**
   * Where the view sits for a given progress: linear, so `setZoomFromRadius` can invert it.
   *
   * The stops arrive as props, which r3f applies AFTER the constructor — so until they do,
   * `maxDistance` is still `Infinity` and the honest answer is the radius the camera already has.
   */
  getZoomRadius() {
    if (Number.isFinite(this.maxDistance) === false) {
      return this.spherical.radius;
    }
    return this.maxDistance + (this.minDistance - this.maxDistance) * this.zoomProgress;
  }

  /** Moves the view between its stops, and marks the gesture as still going */
  addZoomProgress(delta: number) {
    if (delta !== 0) this._zoomDirection = delta > 0 ? 1 : -1;
    this.zoomProgress = Math.max(0, Math.min(1, this.zoomProgress + delta));
    this._zoomInputMs = performance.now();

    // `syncZoom` waits `zoomSettleMs` before easing to a stop, and dispatches nothing whilst it
    // waits — so with a paused world there is no frame left to notice the wait ending, and the
    // zoom would sit wherever the gesture left it. This asks for that one frame
    clearTimeout(this._zoomSettleTimer);
    this._zoomSettleTimer = setTimeout(() => {
      this._zoomSettleTimer = undefined;
      this.dispatchEvent(changeEvent);
    }, zoomSettleMs + 20);
  }

  /** Reads a radius back into `zoomProgress`, `snap` taking it to the nearer stop */
  setZoomFromRadius(radius: number, snap = false) {
    const span = this.maxDistance - this.minDistance;
    if (Number.isFinite(span) === false) {
      return; // the stops are not in yet — see `getZoomRadius`
    }
    const raw = span === 0 ? 0 : (this.maxDistance - radius) / span;
    this.zoomProgress = Math.max(0, Math.min(1, raw));
    if (snap === true) this.zoomProgress = this.zoomProgress < 0.5 ? 0 : 1;
  }

  /**
   * A little travel is enough to commit, and once committed the view sets off for its stop THERE
   * AND THEN — waiting for the gesture to stop first made a zoom feel like it needed permission.
   * Further input in the same direction simply adds to it; reversing flips the direction, and the
   * same small margin then sends it back where it came from, which is how a zoom is cancelled.
   *
   * Short of that margin there is nothing to commit to, so it waits: the gesture still owns the
   * view, and only once that pauses does it fall back to the stop it set out from.
   *
   * The change dispatched per frame is what keeps it moving: under a demand frameloop nothing else
   * would ask for the next frame, and a step below `EPS` would not trigger the check at the end of
   * `update`. The arriving frame deliberately dispatches nothing, so the frames can stop.
   */
  syncZoom() {
    const zoomingIn = this._zoomDirection === 1;
    const committed = zoomingIn ? this.zoomProgress > zoomCommitIn : this.zoomProgress < zoomCommitOut;
    if (committed === false && (this.pointers.length > 0 || performance.now() - this._zoomInputMs < zoomSettleMs)) {
      return; // still theirs to move, and not yet far enough to go anywhere on its own
    }
    // committed: on to the stop it was heading for. Otherwise: back to the one it set out from
    const target = zoomingIn === committed ? 1 : 0;
    const remaining = target - this.zoomProgress;
    if (Math.abs(remaining) < zoomSettleUntil) {
      this.zoomProgress = target;
      return;
    }
    this.zoomProgress += remaining * zoomSettleRate;
    this.dispatchEvent(changeEvent);
  }

  /**
   * Moves the camera along `u.dollyDirection` — aimed at the cursor or the pinch, see
   * `setDollyTowards` — and re-derives `target`, which is what holds that point still whilst the
   * view comes in. Given radii rather than a scale, so the two stops drive it.
   */
  applyZoomTowards(prevRadius: number, newRadius: number) {
    this.object.position.addScaledVector(this.u.dollyDirection, prevRadius - newRadius);
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
      this.rotateAxis = "none";
    }

    this.addPointer(event);
    // ensures this pointer keeps delivering events to domElement (and fires "lostpointercapture"
    // if that guarantee is ever broken) even if released outside it or capture is stolen
    this.domElement.setPointerCapture(event.pointerId);

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
    if (this.enabled === false || this.pointerIndex(event) === -1) {
      return; // never went down on us — see `pointerIndex`
    }

    this.removePointer(event);

    if (event.pointerType === "touch" && this.pointers.length === 2 && this.state === this.STATE.TOUCH_DOLLY_ROTATE) {
      // back to two fingers: re-baseline, else the next move is measured against a spread and
      // centroid that included the finger which just left, and the camera jumps
      this.handleTouchStartRotate();
      this.handleTouchStartDolly();
    }

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

    this.rotateAxis = "none";

    this.dispatchEvent(endEvent);
    this.state = this.STATE.NONE;
  };

  /** Catches releases that pointerup/pointercancel can miss (see `connect`) */
  onLostPointerCapture = (event: PointerEvent) => {
    if (this.pointers.some((p) => p.pointerId === event.pointerId)) {
      this.onPointerUp(event);
    }
  };

  /** Window losing focus mid-gesture may never deliver any pointer-release event at all */
  onWindowBlur = () => {
    if (this.pointers.length === 0) {
      return;
    }
    for (const p of this.pointers) {
      this.domElement.releasePointerCapture(p.pointerId);
    }
    this.pointers = [];
    this.pointerPositions = {};
    this.domElement.ownerDocument.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
    this.rotateAxis = "none";
    this.dispatchEvent(endEvent);
    this.state = this.STATE.NONE;
  };

  onTouchMove = (event: PointerEvent) => {
    const index = this.pointerIndex(event);
    if (index === -1 || index > 1) {
      // only the first two fingers drive the camera: a third would otherwise be paired with one
      // of them by `getSecondPointerPosition`, and the spread and centroid jump across the screen
      return;
    }

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

      case this.STATE.TOUCH_DOLLY_ROTATE:
        this.handleTwoFingerMove(event);
        this.update();
        break;

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
      this.handleTouchStartRotate(); // also uncommits the azimuth snap
      this.handleTouchStartDolly(); // baselines both spread and centroid
      this.state = this.STATE.TOUCH_DOLLY_ROTATE;
      this.dispatchEvent(startEvent);
    }
    // the finger changes nothing else, rather than dropping the pinch it interrupts
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

    if (Math.abs(distance) < this.minPanDistance) {
      return;
    }

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

    if (Math.abs(distance) < this.minPanDistance) {
      return;
    }

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

  rotateLeft(angle: number) {
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

    // restrict phi to be between desired limits
    this.spherical.phi = fixedPolar ?? Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
    this.spherical.makeSafe();

    this.target.addScaledVector(this.u.panOffset, this.panDampingFactor);

    // the camera opens whereever it was restored to, and the zoom takes its progress from that —
    // once the stops are actually in, which is not the case whilst the constructor runs
    if (this._zoomSeeded === false && Number.isFinite(this.maxDistance) === true) {
      this.setZoomFromRadius(this.spherical.radius, true);
      this._zoomSeeded = true;
    }

    this.syncZoom();
    const nextRadius = this.getZoomRadius();
    // an aimed zoom is applied AFTER the position is rebuilt below, by moving the camera along the
    // aim and letting `target` follow — so the radius is deliberately left alone here, else the
    // view would first jump towards the centre of frame and then be dragged back
    const zoomTowards = this.zoomToCursor === true && this._zoomAimed === true;
    if (zoomTowards === false) {
      this.spherical.radius = nextRadius;
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

    if (zoomTowards === true && Math.abs(nextRadius - this.spherical.radius) > zoomRadiusEpsilon) {
      this.applyZoomTowards(this.spherical.radius, nextRadius);
    }

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

  /** Aims the zoom at the cursor — see `setDollyTowards` */
  updateMouseParameters(event: MouseEvent) {
    this.setDollyTowards(event.clientX, event.clientY);
  }

  /** Aims it at a point on screen: the cursor, or the centre of a pinch */
  setDollyTowards(clientX: number, clientY: number) {
    if (!this.zoomToCursor) {
      return;
    }
    this._zoomAimed = true;
    const { left, top, width, height } = this.domElement.getBoundingClientRect();
    this.u.mouse.set(
      2 * ((clientX - left) / width) - 1, // [-1, 1]
      1 - 2 * ((clientY - top) / height), // [-1, 1]
    );
    this.u.dollyDirection
      .set(this.u.mouse.x, this.u.mouse.y, 1)
      .unproject(this.object)
      .sub(this.object.position)
      .normalize();
  }
}

const startEvent = { type: "start" } as const;
const endEvent = { type: "end" } as const;
const changeEvent = { type: "change" } as const;

const defaultDampingFactor = 0.05;
/** Per-event weight of the centroid and spread low-pass; lower is smoother but laggier */
const twoFingerSmoothing = 0.35;
/** Per-event weight of the pinch-vs-rotate measure; lower is steadier but slower to adapt */
const twoFingerRatioSmoothing = 0.25;
/** Wheel travel for a whole trip between the stops, and the `ln` of the pinch spread for one */
const wheelDeltaPerStop = 500;
const pinchLogPerStop = 0.6;
/** Under this much of a two-finger gesture being centroid motion, it counts as a pure pinch */
const pinchPurity = 0.35;
/** How far a zoom must travel to commit to its stop rather than falling back to the one it left */
const zoomCommitIn = 0.1;
const zoomCommitOut = 0.9;
/** How long input must pause before the view settles, how fast it does, and when it has arrived */
const zoomSettleMs = 120;
const zoomSettleRate = 0.12;
const zoomSettleUntil = 0.001;
/** A radius change under this is not worth re-aiming the camera for */
const zoomRadiusEpsilon = 1e-4;

const twoPI = 2 * Math.PI;

function _normalizeAngle(a: number) {
  return a - Math.round(a / twoPI) * twoPI;
}
const tempVector3One = new THREE.Vector3();
const tempVector3Two = new THREE.Vector3();
