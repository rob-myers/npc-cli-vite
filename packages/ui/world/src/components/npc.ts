import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import type { buildGraph } from "@react-three/fiber";
import {
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  type FindNearestPolyResult,
  findNearestPoly,
  getNodeByRef,
  moveAlongSurface,
  type NavMesh,
  type QueryFilter,
  type Vec3,
} from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import type { mrt, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  defaultIdleAnimationClipKey,
  defaultNpcLabelColor,
  npcLabelWeight,
  npcMaterialConfig,
  npcScale,
  otherNpcLabelColor,
} from "../const.npc";
import { helper } from "../service/helper";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";
import type { AnimationClipKey } from "./NPCs";
import { NpcAnimation } from "./npc-animation";

export class Npc {
  key: string;
  /** for render cache bust */
  epochMs = 0;

  anim = new NpcAnimation(this);
  w: UseStateRef<import("./World").State>;

  agentId: string | null = null;
  /** physics body */
  bodyUid: number;
  /** Object-picking id, which also indexes the label texture array. The UNIFORM is the state */
  pickIdUniform: THREE.UniformNode<"float", number>;
  /** navigation strategy */
  queryFilter!: QueryFilter;
  /** As `queryFilter`, but without the exemption for the node they stand on */
  strictQueryFilter!: QueryFilter;

  bubbleOffset = new THREE.Vector3(0, 0, 0);
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  group: THREE.Group | null = null;
  material: THREE.MeshStandardNodeMaterial;
  /** npc outlines only i.e. `npcMask` output */
  maskMrt: ReturnType<typeof mrt>;
  /** synced with crowd agent */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;

  colorScale: THREE.UniformNode<"float", number>;
  labelRectUniform: THREE.UniformNode<"vec4", THREE.Vector4>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  /** The shift their pose asks of their label, and the least world height it hangs at — see `setLabelYShift` */
  labelShift: undefined | number;
  labelFloor: null | number = null;
  /** Their label's move to a new shift, `t` from `0` to `1`, whilst under way — see `easeLabel` */
  labelMove: null | { from: number; to: number; t: number } = null;
  /** `1` whilst they are lit up — see `setNpcLit` and the `lit` getter */
  npcLit: THREE.UniformNode<"float", number>;
  /** `1` draws their body as a dot screen, but not their label or outline — see `NpcGhost` */
  dotScreen: THREE.UniformNode<"float", number>;
  roomSlot: THREE.UniformNode<"float", number>;
  /** skin selection */
  skinIndexUniform: ReturnType<typeof uniform<"float", number>>;
  /** The slice their eyes show — see `NpcAnimation.tickEyes` */
  eyesUniform: THREE.UniformNode<"float", number>;

  doorKeys = {} as { [key: `g${number}d${number}`]: boolean };
  labelStyle: JshCli.NpcLabelStyle = { color: defaultNpcLabelColor, speaking: false };
  last: JshCli.NpcLast = {
    /** Seen blocking area in navmesh */
    blockingArea: -1,
    /** Target ground point */
    dst: { x: 0, y: 0 },
    /** Target room */
    dstGrId: null as Geomorph.GmRoomId | null,
    /** World time (seconds) when NPC last became idle */
    idleTime: 0,
    /** Look target, a point or a world angle */
    look: { x: 0, y: 0 },
    /** World time (seconds) when the current move started */
    moveTime: 0,
    /** Position (used in stuck detection)  */
    point: { x: 0, y: 0 },
    stuckAccum: 0,
    nearest: Infinity,
    nearestAccum: 0,
    /** Distance to `dst` when the current move started */
    targetDistance: 0,
    /** Non-null iff `dst` was unreachable at time of plan  */
    unreachableResult: null,
  };
  spawns = 0;

  resolve = {
    fade: (_k: string): void => {},
    look: (_k: string): void => {},
    move: (_k: string): void => {},
    /** First spawn only */
    spawn: (_k: string): void => {},
  };
  reject = {
    spawn: rejectNoop,
    move: rejectNoop,
    scale: rejectNoop,
    look: rejectNoop,
    worker: rejectNoop,
  };

  get agent() {
    return this.agentId === null ? null : (this.w.npc.crowd.agents[this.agentId] ?? null);
  }

  get clips() {
    return this.w.npc.clips;
  }

  /** Which layer of the label texture array is theirs: their pick id */
  get labelLayerIndex() {
    return this.pickIdUniform.value;
  }

  /** Whether they are lit up — the uniform IS the state, so there is nothing to keep in step */
  get lit() {
    return this.npcLit.value === 1;
  }

  /** The way their head faces, as a rotation about the vertical: not always their body's, e.g. sat and turned, or lain on a side */
  get lookY() {
    return this.anim.getLookY();
  }

  /** Their pick id, which `compactPickIds` renumbers. The uniform IS the state */
  get pickId() {
    return this.pickIdUniform.value;
  }

  get point() {
    return { x: this.position.x, y: this.position.z };
  }

  /** Whether their current clip has them stood, sat or lain */
  get posture() {
    return this.anim.posture;
  }

  /** The move's intent, not the gait on show: it picks the arrival radii */
  get running() {
    return this.anim.fast;
  }

  get skinIndex() {
    return this.skinIndexUniform.value;
  }

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;

    // Object.assign(this, init);
    this.key = init.key;
    this.colorScale = init.colorScale;
    this.geometry = init.geometry;
    this.graph = init.graph;
    this.labelRectUniform = init.labelRectUniform;
    this.labelYShiftUniform = init.labelYShiftUniform;
    this.npcLit = init.npcLit;
    this.dotScreen = init.dotScreen;
    this.roomSlot = init.roomSlot;
    this.material = init.material;
    this.maskMrt = init.maskMrt;
    this.pickIdUniform = init.pickIdUniform;
    this.position = init.position;
    this.rotation = init.rotation;
    this.skinnedMesh = init.skinnedMesh;
    this.skinIndexUniform = init.skinIndexUniform;
    this.eyesUniform = init.eyesUniform;

    this.bodyUid = addBodyKeyUidRelation(npcToBodyKey(this.key), w.npc.physics);
    this.anim.moveClip = this.clips.walk;
    this.anim.idleClip = this.clips[defaultIdleAnimationClipKey];
  }

  /**
   * Whether this npc may use a nav node — the door areas of doors they cannot pass are refused.
   *
   * `exemptStanding` keeps the node under their own feet passable: they can be standing inside
   * such an area (spawned in a doorway, or a door locked whilst they stood in it) and the crowd
   * refuses to move an agent whose own node fails its filter. Searches only ever filter
   * NEIGHBOURS, so this lets them walk out of the doorway without letting them walk through it.
   * `w.e.move` uses `strictQueryFilter` — the same test without the exemption — to ask whether
   * they are standing somewhere they should not be
   */
  canPassNode(nodeRef: number, navMesh: NavMesh, exemptStanding: boolean): boolean {
    const node = getNodeByRef(navMesh, nodeRef);

    if (isDoorAreaId(node.area) === true) {
      const gmDoorId = decodeDoorAreaId(node.area);
      if (!this.w.e.npcCanAccess(this.key, gmDoorId.gdKey)) {
        if (exemptStanding === true && nodeRef === this.agent?.corridor.path[0]) {
          return true;
        }
        this.last.blockingArea = node.area;
        return false;
      }
    }

    return true;
  }

  distanceTo(point: JshCli.PointAnyFormat) {
    const groundPoint = helper.parseGroundPoint(point);
    return Math.hypot(this.position.x - groundPoint.x, this.position.z - groundPoint.y);
  }

  drawLabel(partialStyle?: Partial<JshCli.NpcLabelStyle>) {
    Object.assign(this.labelStyle, partialStyle);

    const { ct } = this.w.texNpcLabel;
    const { width, height } = ct.canvas;
    ct.clearRect(0, 0, width, height);

    // lighter unless they are the player: grey rather than the default yellow, thinner, and part see-through.
    // `system-ui` has the lighter weights, which plain `sans-serif` may not
    const isPlayer = this.w.player.is(this.key);
    const { color } = this.labelStyle;
    ct.fillStyle = isPlayer === false && color === defaultNpcLabelColor ? otherNpcLabelColor : color;
    const weight = npcLabelWeight[this.w.touchDevice ? "touch" : "desktop"];
    ct.font = `${isPlayer ? weight.player : weight.other} 36px system-ui, sans-serif`;
    ct.globalAlpha = isPlayer ? 1 : 0.35;
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    ct.letterSpacing = "0.1em";
    // ct.strokeStyle = "black";
    // ct.lineWidth = 2;

    const labelText = this.labelStyle.speaking ? `[ ${this.key} ]` : this.key;
    ct.fillText(labelText, width / 2, height / 2);
    ct.globalAlpha = 1;
    const m = ct.measureText(labelText);
    this.labelRectUniform.value.set(
      (width / 2 - m.actualBoundingBoxLeft - labelPickPadPx) / width,
      (height / 2 - m.actualBoundingBoxAscent - labelPickPadPx) / height,
      (width / 2 + m.actualBoundingBoxRight + labelPickPadPx) / width,
      (height / 2 + m.actualBoundingBoxDescent + labelPickPadPx) / height,
    );
    // ct.strokeText(labelText, width / 2, height / 2);

    this.w.texNpcLabel.updateIndex(this.labelLayerIndex);
  }

  /** Moves their label on along `labelMove`, at a steady speed, e.g. as they crouch. Nothing once it is there */
  easeLabel(delta: number) {
    const move = this.labelMove;
    if (move == null) return; // `undefined` on an npc made before a hot reload
    move.t = Math.min(1, move.t + delta / labelMoveSecs);
    this.labelYShiftUniform.value = move.from + (move.to - move.from) * move.t;
    if (move.t === 1) this.labelMove = null;
    this.w.r3f?.invalidate(); // still on its way: the frameloop is on demand
  }

  /**
   * Fades them onto the nearest ground `strictQueryFilter` allows, if they stand inside the area of
   * a door they cannot pass — spawned in a doorway, or it locked whilst they stood there. No move
   * can start until they are off it: the crowd will not steer an agent whose own node fails its
   * filter.
   *
   * @returns whether they had to be moved
   */
  async ensureLegalPosition(): Promise<boolean> {
    if (this.agentId === null) {
      return false;
    }

    const { x, y, z } = this.position;
    const allowed = findNearestPoly(
      createFindNearestPolyResult(),
      this.w.nav.navMesh,
      [x, y, z],
      legalPositionHalfExtents,
      this.strictQueryFilter,
    );

    const dx = allowed.position[0] - x;
    const dz = allowed.position[2] - z;
    const dist = Math.hypot(dx, dz);

    if (allowed.success !== true || dist < legalPositionEpsilon) {
      return false; // nowhere legal within reach, or they are standing somewhere legal already
    }

    // a little beyond it, since the nearest allowed point is ON the edge they must leave
    const beyond = (dist + legalPositionMargin) / dist;
    await this.fadeSpawn({ at: { x: x + dx * beyond, y: z + dz * beyond } });
    return true;
  }

  async fadeIn(speed = 4) {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("fade in"));
      this.resolve.fade = resolve;
      this.reject.scale = reject;
      this.anim.fadeState.target = 1;
      this.anim.fadeState.delta = Math.abs(speed);
    });
  }

  async fadeOut(speed = 8) {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("fade out"));
      this.resolve.fade = resolve;
      this.reject.scale = reject;
      this.anim.fadeState.target = 0;
      this.anim.fadeState.delta = -Math.abs(speed);
    });
  }

  async fadeSpawn({
    at,
    angle,
    facing,
    facingTarget,
  }: {
    at: MaybeMeta<JshCli.PointAnyFormat>;
    /** Explicit spawn angle — overrides `facingTarget` */
    angle?: number;
    facing?: JshCli.PointAnyFormat;
    facingTarget?: boolean;
  }) {
    const groundTarget = helper.parseGroundPoint(at);

    // when doable, ring is centered/heighted at the doable's own position rather than the raw target
    const doResult = this.w.npc.findFreeDoMeta(at.meta ?? {}, this.key, groundTarget);
    const ringAt = doResult.meta.groundPoint ?? groundTarget;
    const ringHeight = doResult.meta.y;

    try {
      this.w.bubble.setShown(this.key, false);
      this.w.rings.showSpawnRing(this.key, ringAt, ringHeight);
      await this.fadeOut();

      await this.w.npc.spawn({
        npcKey: this.key,
        at,
        angle:
          angle ??
          (facingTarget
            ? geomService.getThreeRotationY(groundTarget.y - this.position.z, groundTarget.x - this.position.x)
            : undefined),
        facing,
      });
      this.anim.faceAhead(); // unseen, else the follow swings round after their head

      this.w.rings.fadeOutSpawnRing(this.key);
      await this.fadeIn();
    } catch (e) {
      // teleport (or the fade preceding it) failed — drop the ring immediately, no fade
      this.w.rings.removeSpawnRing(this.key);
      throw e;
    } finally {
      // guarded in case of re-fade midway
      if (this.anim.fadeState.delta === 0) {
        this.colorScale.value = 1;
        this.w.bubble.setShown(this.key, true);
      }
      this.material.depthWrite = true;
      this.material.needsUpdate = true;
      this.skinnedMesh.computeBoundingSphere();
    }
  }

  /**
   * An npc with an agent and a target has corners.
   * We provide: `[currentGroundPoint, ...cornerGroundPoints]`
   */
  getCornersPath(): Geom.VectJson[] | null {
    const cornerGroundPoints = (this.agent?.corners ?? []).map(({ position }) => ({ x: position[0], y: position[2] }));
    return cornerGroundPoints.length > 0 ? [this.point, ...cornerGroundPoints] : null;
  }

  /** Just below the middle of their label's text, as `camera` sees it: the label faces it, so is offset along its up */
  getLabelBase(out: THREE.Vector3, camera: THREE.Camera) {
    /** Its text's bottom, as a share of the label's half-height up from its middle: its `uv` runs down */
    const below = 1 - 2 * this.labelRectUniform.value.w;
    const up = tmpUp.setFromMatrixColumn(camera.matrixWorld, 1);
    return this.getLabelPosition(out).addScaledVector(up, below * npcMaterialConfig.labelHalfHeight - labelBaseGap);
  }

  /** Where their label hangs, in world space */
  getLabelPosition(out = new THREE.Vector3()) {
    return out.copy(this.position).setY(this.position.y + this.labelYShiftUniform.value * npcScale);
  }

  /** Slide by `delta` from where they stand, stopped by walls and doors they cannot pass — `null` without an agent */
  getSlideResult(delta: Geom.VectJson) {
    const agent = this.agent;
    if (agent === null) return null;
    const { x, z } = this.position;
    const result = moveAlongSurface(
      this.w.nav.navMesh,
      this.w.npc.getNodeRef(agent),
      [x, 0, z],
      [x + delta.x, 0, z + delta.y],
      this.queryFilter,
    );
    return { ...result, groundPoint: { x: result.position[0], y: result.position[2] } };
  }

  groupRef = (group: THREE.Group | null): void => {
    if (!group) {
      this.anim.mixer.stopAllAction();
      return;
    }
    this.group = group;

    // overwrite
    this.skinnedMesh = group.children[0] as THREE.SkinnedMesh;
    this.position = this.skinnedMesh.position;
    this.rotation = this.skinnedMesh.rotation;
    this.anim.mixer = new THREE.AnimationMixer(group);
    this.anim.setGroup(group);

    this.resolve.spawn("spawned");

    // fresh mixer needs pose + handle gltf hot-reload (?)
    const clipKey = this.anim.moving === true ? (this.anim.moveClip.name as AnimationClipKey) : this.anim.restKey;
    this.anim.setPose(clipKey, { fade: 0, force: true });
    this.anim.mixer.update(0);
    this.anim.tickUpper(0); // an upper pose too, e.g. whilst paused
  };

  hasRing() {
    return this.w.rings.selectRingByNpc.has(this.key);
  }

  init() {
    this.skinnedMesh.computeBoundingSphere();

    this.queryFilter = {
      ...createDefaultQueryFilter(),
      passFilter: (nodeRef, navMesh) => this.canPassNode(nodeRef, navMesh, true),
    };

    this.strictQueryFilter = {
      ...createDefaultQueryFilter(),
      passFilter: (nodeRef, navMesh) => this.canPassNode(nodeRef, navMesh, false),
    };
  }

  isFading() {
    return this.anim.fadeState.delta !== 0;
  }

  isLooking() {
    return this.anim.face.turn !== null;
  }

  isMoving() {
    return this.anim.moving;
  }

  /** Whether their current clip has them off their feet, i.e. `sit` or `lie` */
  isNotStanding() {
    return this.anim.posture !== "stand";
  }

  isStrafing() {
    return this.anim.strafe;
  }

  /**
   * Can look at `npcKey`, point or angle.
   */
  async look({ at, minMs = 0, immediate = false, rate = 1 }: JshCli.LookOpts) {
    this.last.look =
      typeof at === "number" ? at : helper.parseGroundPoint(typeof at === "string" ? this.w.npc.get(at).position : at);

    if (this.anim.hurt !== null) throw Error("hurt");
    const cannotLook = npcCannotLookForClip[this.anim.idleClip.name];
    if (cannotLook !== undefined) {
      throw Error(cannotLook);
    }

    const target = this.anim.bearingOf(this.last.look);
    if (immediate) {
      this.skinnedMesh.rotation.y = target;
      return;
    }
    if (this.anim.strafe === true && this.isMoving() === true) {
      this.anim.face.aim = { at: target, rate, untilRest: true }; // on the move: eased round, the move kept
      return;
    }

    try {
      await new Promise<string>((resolve, reject) => {
        const moving = this.isMoving();
        const fromRate = this.anim.getTurnRate(); // before `rejectAll` drops the turn
        this.rejectAll(new Error("look again"));
        if (moving === true) {
          // not strafing so come to stop
          this.w.npc.clearMomentum(this);
          this.anim.startIdle({ force: true });
        }
        this.resolve.look = resolve;
        this.reject.look = reject;
        this.anim.lookAt(target, minMs, rate, fromRate);
      });
    } catch (e) {
      if (e instanceof Error && e.message === "look again") {
        return; // the look which interrupted us owns the animation now
      }
      this.anim.startIdle({ force: true });
      throw e;
    }
  }

  pinTo(result: FindNearestPolyResult, overrideGroundPoint?: JshCli.GroundPoint): boolean {
    if (this.agentId === null || result.success === false) {
      return false;
    }
    return crowdApi.requestMoveTarget(
      this.w.npc.crowd,
      this.agentId,
      result.nodeRef,
      overrideGroundPoint ? helper.groundPointToTuple(overrideGroundPoint) : result.position,
    );
  }

  preventArrival() {
    if (this.isMoving()) {
      this.anim.arrive = false;
    }
  }

  rejectAll(err: Error) {
    const { reject } = this;
    this.reject = {
      spawn: rejectNoop,
      move: rejectNoop,
      scale: rejectNoop,
      look: rejectNoop,
      worker: rejectNoop,
    };
    // synchronously stop scale or look
    this.anim.fadeState.delta = 0;
    this.anim.face.turn = null;
    reject.worker(err); // stop waiting on the worker
    reject.spawn(err);
    reject.move(err);
    reject.scale(err);
    reject.look(err);
  }

  setBubbleHeight(y: number) {
    this.bubbleOffset.y = y;
  }

  /** The least world height their label hangs at, else `null` — see `w.npc.liftBunkLabels` */
  setLabelFloor(y: null | number) {
    this.labelFloor = y;
    this.setLabelYShift(this.labelShift ?? this.labelYShiftUniform.value);
  }

  setLabelYShift(shift: number) {
    // no lower than its floor, e.g. above a top bunk over them
    const target = Math.max(shift, ((this.labelFloor ?? -Infinity) - this.position.y) / npcScale);
    const u = this.labelYShiftUniform;
    const first = this.labelShift === undefined;
    this.labelShift = shift;
    if (first || this.colorScale.value === 0) {
      // at once their first time, or whilst faded out: nobody sees it move
      u.value = target;
      this.labelMove = null;
    } else if (target !== (this.labelMove?.to ?? u.value)) {
      this.labelMove = { from: u.value, to: target, t: 0 }; // most poses keep the height: no move
    }
  }

  /** Selector ring */
  setRing(color?: THREE.ColorRepresentation) {
    if (color) {
      this.w.rings.showSelectRing(this.key, color);
    } else {
      this.w.rings.hideSelectRing(this.key);
    }
    this.w.view.forceUpdate();
  }

  setSkin(skinKey?: string) {
    const skinIndex = this.w.npc.getSkinIndexBySkinKey(skinKey ?? "medic-0");
    console.warn(`${this.key}: skin "${skinKey}" not found`);
    this.skinIndexUniform.value = skinIndex;
  }
}

export type NpcInit = {
  key: string;
  colorScale: THREE.UniformNode<"float", number>;
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  labelRectUniform: THREE.UniformNode<"vec4", THREE.Vector4>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  npcLit: THREE.UniformNode<"float", number>;
  dotScreen: THREE.UniformNode<"float", number>;
  roomSlot: THREE.UniformNode<"float", number>;
  material: THREE.MeshStandardNodeMaterial;
  maskMrt: ReturnType<typeof mrt>;
  /** Object-picking id, which also indexes the label texture array */
  pickIdUniform: THREE.UniformNode<"float", number>;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;
  skinIndexUniform: THREE.UniformNode<"float", number>;
  eyesUniform: THREE.UniformNode<"float", number>;
};

/** Pixels the label's pick box reaches beyond its text */
const labelPickPadPx = 2;

/** How far `ensureLegalPosition` looks for ground the npc is allowed to stand on */
const legalPositionHalfExtents: Vec3 = [1.5, 1, 1.5];
/** Nearer than this and they are already standing legally */
const legalPositionEpsilon = 0.01;
/** How far past the edge `ensureLegalPosition` puts them */
const legalPositionMargin = 0.05;

const npcCannotLookForClip: Record<string, string | undefined> = {
  sit: "not while sitting",
  lie: "not while lying",
  lie_left: "not while lying",
  lie_right: "not while lying",
};

export function rejectNoop(_e: Error): void {}

/** Seconds their label takes to move to a new height */
const labelMoveSecs = 0.3;
/** Metres below their label's text its base is */
const labelBaseGap = 0.04;

const tmpUp = new THREE.Vector3();
