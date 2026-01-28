import * as THREE from "three";
import { EventDispatcher, PerspectiveCamera, TOUCH } from "three";
import { deltaAngle } from "maath/misc";

/**
 * Based on:
 * > https://github.com/pmndrs/three-stdlib/blob/main/src/controls/OrbitControls.ts
 */
export class CameraControls extends EventDispatcher {
  /** @type {PerspectiveCamera} */
  object;
  /** @type {HTMLElement} */
  domElement;
  /** Set to false to disable this control */
  enabled = true;
  /** "target" sets the location of focus, where the object orbits around */
  target = new THREE.Vector3();
  // scale = 1;
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
  azimuthalDampingFactor = defaultDampingFactor * 0.85;
  polarDampingFactor = defaultDampingFactor;
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

  STATE = /** @type {const} */ ({
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_PAN: 4,
    TOUCH_DOLLY_PAN: 5,
    TOUCH_DOLLY_ROTATE: 6,
  });

  state = /** @type {-1 | 0 | 1 | 2 | 3 | 4 | 5 | 6} */ (
    this.STATE.NONE
  );

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

  pointers = /** @type {PointerEvent[]} */ ([]);
  pointerPositions = /** @type {{ [key: string]: THREE.Vector2 }} */ ({})

  //#region MapControls
  /** if false, pan orthogonal to world-space direction camera.up */
  screenSpacePanning = false; // pan orthogonal to world-space direction camera.up
  
  touches = {
    // ONE: THREE.TOUCH.ROTATE,
    ONE: THREE.TOUCH.PAN,
    // TWO: THREE.TOUCH.DOLLY_PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  }
  //#endregion

  //#region Custom
  params = { fixedPolar: false, fixedAzimuth: false };
  savedParams = { ...this.params };
  /** `(clientX, clientY)` of first pointerdown */
  pointerFirstDown = { x: 0, y: 0 };
  /** `(clientX, clientY)` of last pointerup */
  pointerLastUp = { x: 0, y: 0 };
  /** Length of "last" `|this.pointerLastUp - this.pointerFirstDown|` */
  lastPointerDistance = 0;
  //#endregion

  /**
   * @param {PerspectiveCamera} object 
   * @param {HTMLElement} domElement 
   */
  constructor(object, domElement) {
    super();

    this.object = object;
    this.domElement = domElement;

    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  /** @param {PointerEvent} event */
  addPointer(event) {
    this.pointers.push(event);
  }

  /** @param {HTMLElement} domElement */
  connect(domElement) {
    this.domElement = domElement;

    // disables touch scroll
    // touch-action needs to be defined for pointer events to work on mobile
    // https://stackoverflow.com/a/48254578
    this.domElement.style.touchAction = 'none';

    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.domElement.addEventListener('wheel', this.onMouseWheel);
  }
  
  /** @param {number} dist */
  clampDistance(dist) {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  dispose() {
    this.domElement.style.touchAction = 'auto'; // 🚧
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointercancel', this.onPointerUp);
    this.domElement.removeEventListener('wheel', this.onMouseWheel);
    this.domElement.ownerDocument.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.ownerDocument.removeEventListener('pointerup', this.onPointerUp);
  }

  /** @param {number} dollyScale */
  dollyIn(dollyScale) {
    this.u.scale = this.u.scale * dollyScale;
  }

  /** @param {number} dollyScale */
  dollyOut(dollyScale) {
    this.u.scale = this.u.scale / dollyScale;
  }

  getAzimuthalAngle() {
    return this.spherical.theta;
  }

  getDistance() {
    return this.object.position.distanceTo(this.target);
  }

  getPolarAngle() {
    return this.spherical.phi;
  }

  /** @param {PointerEvent} event */
  getSecondPointerPosition(event) {
    const pointer = event.pointerId === this.pointers[0].pointerId ? this.pointers[1] : this.pointers[0];
    return this.pointerPositions[pointer.pointerId];
  }

  getZoomScale() {// closer to 1 is slower
    return Math.pow(0.95, this.zoomSpeed);
  }

  /** @param {MouseEvent} event */
  handleMouseDownDolly(event) {
    this.updateMouseParameters(event);
    this.u.dollyStart.set(event.clientX, event.clientY);
  }

  /** @param {MouseEvent} event */
  handleMouseDownPan(event) {
    this.u.panStart.set(event.clientX, event.clientY);
  }

  /** @param {MouseEvent} event */
  handleMouseDownRotate(event) {
    this.u.rotateStart.set(event.clientX, event.clientY);
  }

  /** @param {MouseEvent} event */
  handleMouseMoveDolly(event) {
    this.u.dollyEnd.set(event.clientX, event.clientY)
    this.u.dollyDelta.subVectors(this.u.dollyEnd, this.u.dollyStart)

    if (this.u.dollyDelta.y > 0) {
      this.dollyOut(this.getZoomScale())
    } else if (this.u.dollyDelta.y < 0) {
      this.dollyIn(this.getZoomScale())
    }

    this.u.dollyStart.copy(this.u.dollyEnd)
    this.update()
  }

  /** @param {MouseEvent} event */
  handleMouseMovePan(event) {
    this.u.panEnd.set(event.clientX, event.clientY)
    this.u.panDelta.subVectors(this.u.panEnd, this.u.panStart).multiplyScalar(this.panSpeed)
    this.pan(this.u.panDelta.x, this.u.panDelta.y)
    this.u.panStart.copy(this.u.panEnd)
    this.update()
  }

  /** @param {MouseEvent} event */
  handleMouseMoveRotate(event) {
    this.u.rotateEnd.set(event.clientX, event.clientY)
    this.u.rotateDelta.subVectors(this.u.rotateEnd, this.u.rotateStart).multiplyScalar(this.rotateSpeed)

    const element = this.domElement

    if (element) {
      this.rotateLeft((2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight) // yes, height
      this.rotateUp((2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight)
    }
    this.u.rotateStart.copy(this.u.rotateEnd)
    this.update()
  }

  /** @param {WheelEvent} event */
  handleMouseWheel(event) {
    this.updateMouseParameters(event);
    const zoomScale = this.getZoomScale();
    if (event.deltaY < 0) {
      this.dollyIn(zoomScale);
    } else if (event.deltaY > 0) {
      this.dollyOut(zoomScale);
    }
    this.update();
  }

  /** @param {PointerEvent} event */
  handleTouchMoveDolly(event) {
    const position = this.getSecondPointerPosition(event)
    const dx = event.pageX - position.x
    const dy = event.pageY - position.y
    const distance = Math.hypot(dx, dy)

    this.u.dollyEnd.set(0, distance)
    this.u.dollyDelta.set(0, Math.pow(this.u.dollyEnd.y / this.u.dollyStart.y, this.zoomSpeed));
    this.dollyOut(this.u.dollyDelta.y)
    this.u.dollyStart.copy(this.u.dollyEnd)
  }

  /**
   * @param {PointerEvent} event 
   */
  handleTouchMoveDollyPan(event) {
    if (this.enableZoom === true) this.handleTouchMoveDolly(event)
    if (this.enablePan === true) this.handleTouchMovePan(event)
  }

  /** @param {PointerEvent} event */
  handleTouchMoveDollyRotate(event) {
    if (this.enableZoom === true) this.handleTouchMoveDolly(event)
    if (this.enableRotate === true) this.handleTouchMoveRotate(event)
  }

  /** @param {PointerEvent} event */
  handleTouchMovePan(event) {
    if (this.pointers.length == 1) {
      this.u.panEnd.set(event.pageX, event.pageY)
    } else {
      const position = this.getSecondPointerPosition(event)
      const x = 0.5 * (event.pageX + position.x)
      const y = 0.5 * (event.pageY + position.y)
      this.u.panEnd.set(x, y)
    }

    this.u.panDelta.subVectors(this.u.panEnd, this.u.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.u.panDelta.x, this.u.panDelta.y)
    this.u.panStart.copy(this.u.panEnd)
  }

  /** @param {PointerEvent} event */
  handleTouchMoveRotate(event) {
    if (this.pointers.length == 1) {
      this.u.rotateEnd.set(event.pageX, event.pageY)
    } else {
      const position = this.getSecondPointerPosition(event)
      const x = 0.5 * (event.pageX + position.x)
      const y = 0.5 * (event.pageY + position.y)
      this.u.rotateEnd.set(x, y)
    }

    this.u.rotateDelta.subVectors(this.u.rotateEnd, this.u.rotateStart).multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    if (element) {
      this.rotateLeft((2 * Math.PI * this.u.rotateDelta.x) / element.clientHeight) // yes, height
      this.rotateUp((2 * Math.PI * this.u.rotateDelta.y) / element.clientHeight)
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
    const dx = this.pointers[0].pageX - this.pointers[1].pageX;
    const dy = this.pointers[0].pageY - this.pointers[1].pageY;
    const distance = Math.hypot(dx, dy);
    this.u.dollyStart.set(0, distance);
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
    if (this.pointers.length == 1) {
      this.u.rotateStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
    } else {
      const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
      const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
      this.u.rotateStart.set(x, y);
    }
  }

  handleZoomToCursor() {
    let newRadius = null;
    const prevRadius = this.u.offset.length();
    newRadius = this.clampDistance(prevRadius * this.u.scale);
    const radiusDelta = prevRadius - newRadius;

    this.object.position.addScaledVector(this.u.dollyDirection, radiusDelta);
    this.object.updateMatrixWorld();

    if (newRadius !== null) {
      if (this.screenSpacePanning === true) {
        this.target.set(0, 0, -1).transformDirection(this.object.matrix).multiplyScalar(newRadius).add(this.object.position);
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
  }

  /** @param {MouseEvent} event */
  onContextMenu = (event) => {
    if (this.enabled === false) return;
    event.preventDefault();
  }

  /** @param {MouseEvent} event */
  onMouseDown = (event) => {
    if (this.enabled === false) return;
    event.preventDefault();

    let mouseAction;
    switch (event.button) {
      case 0: mouseAction = THREE.MOUSE.PAN; break;
      case 1: mouseAction = THREE.MOUSE.DOLLY; break;
      case 2: mouseAction = THREE.MOUSE.ROTATE; break;
      default: mouseAction = -1;
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
  }

  /** @param {MouseEvent} event */
  onMouseMove(event)  {
    if (this.enabled === false) return;

    switch (this.state) {
      case this.STATE.ROTATE:
        if (this.enableRotate === false) return
        this.handleMouseMoveRotate(event)
        break

      case this.STATE.DOLLY:
        if (this.enableZoom === false) return
        this.handleMouseMoveDolly(event)
        break

      case this.STATE.PAN:
        if (this.enablePan === false) return
        this.handleMouseMovePan(event)
        break
    }
  }

  /** @param {WheelEvent} event */
  onMouseWheel = (event) => {
    if (
      this.enabled === false
      || this.enableZoom === false
      || !(
        this.state === this.STATE.NONE
        || this.state === this.STATE.TOUCH_DOLLY_PAN
      )
    ) {
      return;
    }
    event.preventDefault();

    this.dispatchEvent(startEvent);
    this.handleMouseWheel(event);
    this.dispatchEvent(endEvent);
  }

  /** @param {PointerEvent} event */
  onPointerDown = (event) => {
    if (this.enabled === false) return;
    
    if (this.pointers.length === 0) {
      this.domElement?.ownerDocument.addEventListener('pointermove', this.onPointerMove)
      this.domElement?.ownerDocument.addEventListener('pointerup', this.onPointerUp)
      this.pointerFirstDown.x = event.clientX;
      this.pointerFirstDown.y = event.clientY;
    }

    this.addPointer(event);

    if (event.pointerType === 'touch') {
      this.onTouchStart(event)
    } else {
      this.onMouseDown(event)
    }
  }

  /** @param {PointerEvent} event */
  onPointerMove = (event) => {
    if (this.enabled === false) return;

    if (event.pointerType === 'touch') {
      this.onTouchMove(event)
    } else {
      this.onMouseMove(event);
    }
  }

  /** @param {PointerEvent} event */
  onPointerUp = (event) => {
    if (this.enabled === false) {
      return;
    }

    this.removePointer(event);

    if (this.pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);
      this.domElement.ownerDocument.removeEventListener('pointermove', this.onPointerMove)
      this.domElement.ownerDocument.removeEventListener('pointerup', this.onPointerUp)
      this.pointerLastUp.x = event.clientX;
      this.pointerLastUp.y = event.clientY;
      this.lastPointerDistance = Math.hypot(this.pointerLastUp.x - this.pointerFirstDown.x, this.pointerLastUp.y - this.pointerFirstDown.y);
    }
    
    this.dispatchEvent(endEvent);
    this.state = this.STATE.NONE;
  }

  /** @param {PointerEvent} event */
  onTouchMove = (event) => {
    this.trackPointer(event)

    switch (this.state) {
      case this.STATE.TOUCH_ROTATE:
        if (this.enableRotate === false) return
        this.handleTouchMoveRotate(event)
        this.update()
        break

      case this.STATE.TOUCH_PAN:
        if (this.enablePan === false) return
        this.handleTouchMovePan(event)
        this.update()
        break

      case this.STATE.TOUCH_DOLLY_PAN:
        if (this.enableZoom === false && this.enablePan === false) return
        this.handleTouchMoveDollyPan(event)
        this.update()
        break

      case this.STATE.TOUCH_DOLLY_ROTATE:
        if (this.enableZoom === false && this.enableRotate === false) return
        this.handleTouchMoveDollyRotate(event)
        this.update()
        break

      default:
        this.state = this.STATE.NONE;
    }
  }

  /** @param {PointerEvent} event */
  onTouchStart = (event) => {
    this.trackPointer(event)

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

      switch (this.touches.TWO) {
        case TOUCH.DOLLY_PAN:
          if (this.enableZoom === false && this.enablePan === true) return;
          this.handleTouchStartDollyPan();
          this.state = this.STATE.TOUCH_DOLLY_PAN;
        break;
        case TOUCH.DOLLY_ROTATE:
          if (this.enableZoom === false && this.enableRotate === false) return;
          this.handleTouchStartDollyRotate();
          this.state = this.STATE.TOUCH_DOLLY_ROTATE;
          break;
        default:

      }

      this.dispatchEvent(startEvent);

    } else {
      this.state = this.STATE.NONE;
    }
  }

  /**
   * @param {number} deltaX pointer delta x
   * @param {number} deltaY pointer delta y
   */
  pan(deltaX, deltaY) {
    const element = this.domElement;
    const offset = tempVector3One;

    if (!element) {
      return;
    }

    const position = this.object.position;
    offset.copy(position).sub(this.target)
    let targetDistance = offset.length();

    // half of the fov is center to top of screen
    targetDistance *= Math.tan(((this.object.fov / 2) * Math.PI) / 180.0);

    // we use only clientHeight here so aspect ratio does not distort speed
    this.panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.object.matrix);
    this.panUp((2 * deltaY * targetDistance) / element.clientHeight, this.object.matrix);
  }

  /**
   * @param {number} distance 
   * @param {THREE.Matrix4} objectMatrix 
   */
  panLeft(distance, objectMatrix) {
    const v = tempVector3Two;
    v.setFromMatrixColumn(objectMatrix, 0) // get X column of objectMatrix
    v.multiplyScalar(-distance)

    this.u.panOffset.add(v)
  }

  /**
   * @param {number} distance 
   * @param {THREE.Matrix4} objectMatrix 
   */
  panUp(distance, objectMatrix) {
    const v = tempVector3Two;
    if (this.screenSpacePanning === true) {
      v.setFromMatrixColumn(objectMatrix, 1)
    } else {
      v.setFromMatrixColumn(objectMatrix, 0)
      v.crossVectors(this.object.up, v)
    }

    v.multiplyScalar(distance)

    this.u.panOffset.add(v)
  }

  /** @param {PointerEvent} event */
  removePointer(event) {
    delete this.pointerPositions[event.pointerId];
    const index = this.pointers.findIndex(p => p.pointerId === event.pointerId);
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

  restoreParams() {
    Object.assign(this.params, this.savedParams);
  }

  /**
   * @param {number} angle
   * @returns {void}
   */
  rotateLeft(angle) {
    this.sphericalDelta.theta -= angle;
  }

  /**
   * @param {number} angle 
   * @returns {void}
   */
  rotateUp(angle) {
    this.sphericalDelta.phi -= angle;
  }

  saveParams() {
    Object.assign(this.savedParams, this.params);
  }

  /** @param {Partial<{ fixedAzimuth: boolean, fixedPolar: boolean }>} params */
  setParams(params) {
    Object.assign(this.params, params);
  }
  
  saveState() {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  /** @param {number} angle */
  setAzimuthalAngle(angle) {
    this.sphericalDelta.theta = deltaAngle(this.spherical.theta, angle);
    this.update();
  }

  /** @param {number} angle */
  setPolarAngle(angle) {
    this.sphericalDelta.phi = deltaAngle(this.spherical.phi, angle);
    this.update();
  }

  /** @param {PointerEvent} event */
  trackPointer(event) {
    let position = this.pointerPositions[event.pointerId]

    if (position === undefined) {
      position = new THREE.Vector2();
      this.pointerPositions[event.pointerId] = position
    }

    position.set(event.pageX, event.pageY)
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
    if (isFinite(min) && isFinite(max)) {
      if (min < -Math.PI) min += twoPI;
      else if (min > Math.PI) min -= twoPI;
      if (max < -Math.PI) max += twoPI;
      else if (max > Math.PI) max -= twoPI;

      if (min <= max) {
        this.spherical.theta = Math.max(min, Math.min(max, this.spherical.theta));
      } else {
        this.spherical.theta = this.spherical.theta > (min + max) / 2 ? Math.max(min, this.spherical.theta) : Math.min(max, this.spherical.theta);
      }
    }

    // restrict phi to be between desired limits
    this.spherical.phi = fixedPolar ?? Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
    this.spherical.makeSafe();

    this.target.addScaledVector(this.u.panOffset, this.panDampingFactor);

    if (this.zoomToCursor === true && this.u.zoomingToCursor === true) {
      this.spherical.radius = this.clampDistance(this.spherical.radius);
    } else {
      this.spherical.radius = this.clampDistance(this.spherical.radius * this.u.scale);
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
      this.u.lastPosition.distanceToSquared(this.object.position) > this.EPS
      || 8 * (1 - this.u.lastQuaternion.dot(this.object.quaternion)) > this.EPS
    ) {
      this.dispatchEvent(changeEvent);
      this.u.lastPosition.copy(this.object.position);
      this.u.lastQuaternion.copy(this.object.quaternion);
      return true;
    }

    return false;
  }

  /**
   * Update `u.zoomingToCursor`, `u.mouse`, `u.dollyDirection`
   * @param {MouseEvent} event
   */
  updateMouseParameters(event) {
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
      .normalize()
    ;
  }
}

const startEvent = /** @type {const} */ ({ type: 'start' });
const endEvent = /** @type {const} */ ({ type: 'end' });
const changeEvent = /** @type {const} */ ({ type: 'change' });

const defaultDampingFactor = 0.05;

const twoPI = 2 * Math.PI;
const tempVector3One = new THREE.Vector3();
const tempVector3Two = new THREE.Vector3();
