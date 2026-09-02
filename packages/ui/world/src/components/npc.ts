import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import type { buildGraph } from "@react-three/fiber";
import { deltaAngle } from "maath/misc";
import {
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  type FindNearestPolyResult,
  findNearestPoly,
  getNodeByRef,
  type NavMesh,
  type QueryFilter,
  type Vec3,
} from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import type { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { defaultIdleAnimationClipKey, defaultSkinKey } from "../const";
import { helper } from "../service/helper";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";
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
  /**
   * Whether `prod` has wiped them away, so their group is not drawn at all — set by the
   * `npc-hidden` / `npc-shown` events rather than written to directly
   */
  hidden = false;
  material: THREE.MeshStandardNodeMaterial;
  /** synced with crowd agent */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;

  brightness: THREE.UniformNode<"float", number>;
  colorScale: THREE.UniformNode<"float", number>;
  labelVisible!: THREE.UniformNode<"float", number>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  /** `1` whilst they are lit up — see `setNpcLit` and the `lit` getter */
  npcLit: THREE.UniformNode<"float", number>;
  roomSlot: THREE.UniformNode<"float", number>;
  /** skin selection */
  skinIndexUniform: ReturnType<typeof uniform<"float", number>>;

  doorKeys = {} as { [key: `g${number}d${number}`]: boolean };
  labelStyle: JshCli.NpcLabelStyle = { color: "#ff9", speaking: false };
  last: JshCli.NpcLast = {
    /** Seen blocking area in navmesh */
    blockingArea: -1,
    /** Target ground point */
    dst: { x: 0, y: 0 },
    /** Target room */
    dstGrId: null as Geomorph.GmRoomId | null,
    /** World time (seconds) when NPC last became idle */
    idleTime: 0,
    /** Look target */
    look: { x: 0, y: 0 },
    /** World time (seconds) when the current move started */
    moveTime: 0,
    /** Position (used in stuck detection)  */
    point: { x: 0, y: 0 },
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

  get point() {
    return { x: this.position.x, y: this.position.z };
  }

  get running() {
    return this.anim.moveClip.name === "run";
  }

  get skinIndex() {
    return this.skinIndexUniform.value;
  }

  /** Whether they are lit up — the uniform IS the state, so there is nothing to keep in step */
  get lit() {
    return this.npcLit.value === 1;
  }

  /** ...likewise their pick id, which `compactPickIds` renumbers */
  get pickId() {
    return this.pickIdUniform.value;
  }

  /** Which layer of the label texture array is theirs — the same number */
  get labelLayerIndex() {
    return this.pickIdUniform.value;
  }

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;

    // Object.assign(this, init);
    this.key = init.key;
    this.brightness = init.brightness;
    this.colorScale = init.colorScale;
    this.geometry = init.geometry;
    this.graph = init.graph;
    this.labelVisible = init.labelVisible;
    this.labelYShiftUniform = init.labelYShiftUniform;
    this.npcLit = init.npcLit;
    this.roomSlot = init.roomSlot;
    this.material = init.material;
    this.pickIdUniform = init.pickIdUniform;
    this.position = init.position;
    this.rotation = init.rotation;
    this.skinnedMesh = init.skinnedMesh;
    this.skinIndexUniform = init.skinIndexUniform;

    this.bodyUid = addBodyKeyUidRelation(npcToBodyKey(this.key), w.npc.physics);
    this.anim.moveClip = this.clips.walk;
    this.anim.idleClip = this.clips[defaultIdleAnimationClipKey];
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

    ct.fillStyle = this.labelStyle.color;
    ct.font = "400 36px sans-serif";
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    ct.letterSpacing = "0.1em";
    // ct.strokeStyle = "black";
    // ct.lineWidth = 2;

    const labelText = this.labelStyle.speaking ? `[ ${this.key} ]` : this.key;
    ct.fillText(labelText, width / 2, height / 2);
    // ct.strokeText(labelText, width / 2, height / 2);

    this.w.texNpcLabel.updateIndex(this.labelLayerIndex);
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
    facing,
    facingTarget,
  }: {
    at: MaybeMeta<JshCli.PointAnyFormat>;
    facing?: JshCli.PointAnyFormat;
    facingTarget?: boolean;
  }) {
    const groundTarget = helper.parseGroundPoint(at);

    // when doable, ring is centered/heighted at the doable's own position rather than the raw target
    const doResult = this.w.npc.findFreeDoMeta(at.meta ?? {}, this.key);
    const ringAt = doResult.meta.groundPoint ?? groundTarget;
    const ringHeight = doResult.meta.y;

    try {
      this.w.bubble.setShown(this.key, false);
      this.w.rings.showSpawnRing(this.key, ringAt, ringHeight);
      await this.fadeOut();

      await this.w.npc.spawn({
        npcKey: this.key,
        at,
        angle: facingTarget
          ? geomService.getThreeRotationY(groundTarget.y - this.position.z, groundTarget.x - this.position.x)
          : undefined,
        facing,
      });

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

  /**
   * An npc with an agent and a target has corners.
   * We provide: `[currentGroundPoint, ...cornerGroundPoints]`
   */
  getCornersPath(): Geom.VectJson[] | null {
    const cornerGroundPoints = (this.agent?.corners ?? []).map(({ position }) => ({ x: position[0], y: position[2] }));
    return cornerGroundPoints.length > 0 ? [this.point, ...cornerGroundPoints] : null;
  }

  groupRef = (group: THREE.Group | null): void => {
    if (!group) {
      this.anim.mixer.stopAllAction();
      return;
    }
    this.group = group;
    group.visible = this.hidden === false; // a fresh group of a wiped npc starts shown

    // overwrite
    this.skinnedMesh = group.children[0] as THREE.SkinnedMesh;
    this.position = this.skinnedMesh.position;
    this.rotation = this.skinnedMesh.rotation;
    this.anim.mixer = new THREE.AnimationMixer(group);

    this.resolve.spawn("spawned");

    this.anim.mixer.clipAction(this.anim.idleClip).play();
    this.anim.mixer.update(0);
  };

  /**
   * Whether this npc may use a nav node — the door areas of doors they cannot pass are refused.
   *
   * `exemptStanding` keeps the node under their own feet passable: they can be standing inside
   * such an area (spawned in a doorway, or a door locked whilst they stood in it) and the crowd
   * refuses to move an agent whose own node fails its filter. Searches only ever filter
   * NEIGHBOURS, so this lets them walk out of the doorway without letting them walk through it.
   * `w.npc.move` uses `strictQueryFilter` — the same test without the exemption — to ask whether
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

  init() {
    this.skinnedMesh.computeBoundingSphere();

    this.bubbleOffset.y = npcBubbleHeightForClip(this.anim.idleClip.name);

    this.setLabelYShift(npcLabelYShiftForClip(this.anim.idleClip.name));

    this.queryFilter = {
      ...createDefaultQueryFilter(),
      passFilter: (nodeRef, navMesh) => this.canPassNode(nodeRef, navMesh, true),
    };

    this.strictQueryFilter = {
      ...createDefaultQueryFilter(),
      passFilter: (nodeRef, navMesh) => this.canPassNode(nodeRef, navMesh, false),
    };

    const skinKey = this.w.npc.getSkinKeyBySkinIndex(this.skinIndex) ?? defaultSkinKey;
    const skinMeta = this.w.npc.getSkinMeta(skinKey);
    const brightnessMeta = skinMeta?.brightness;
    this.brightness.value = typeof brightnessMeta === "number" ? brightnessMeta : 0.4;
  }

  isFading() {
    return this.anim.fadeState.delta !== 0;
  }

  isLooking() {
    return this.anim.lookState.active;
  }

  isMoving() {
    return this.anim.moving;
  }

  /** Whether their current clip has them off their feet, i.e. `sit` or `lie` */
  isNotStanding() {
    const clipName = this.anim.moving === true ? this.anim.moveClip.name : this.anim.idleClip.name;
    return clipName === "sit" || clipName === "lie";
  }

  /**
   * Can look at `npcKey` or point.
   */
  async look({ at, minMs = 0, immediate = false }: JshCli.LookOpts) {
    const groundPoint = helper.parseGroundPoint(typeof at === "string" ? this.w.npc.get(at).position : at);
    this.last.look = groundPoint;

    const cannotLook = npcCannotLookForClip[this.anim.idleClip.name];
    if (cannotLook !== undefined) {
      throw Error(cannotLook);
    }

    const target = geomService.getThreeRotationY(groundPoint.y - this.position.z, groundPoint.x - this.position.x);
    if (immediate) {
      this.skinnedMesh.rotation.y = target;
      return;
    }

    const startAngle = this.skinnedMesh.rotation.y;
    const totalDiff = deltaAngle(startAngle, target);
    const arc = Math.abs(totalDiff);
    const longLook = arc > longLookAngle;
    const { lookState } = this.anim;

    try {
      await new Promise<string>((resolve, reject) => {
        this.rejectAll(new Error("look again"));
        this.resolve.look = resolve;
        this.reject.look = reject;

        Object.assign(lookState, {
          active: true,
          startAngle,
          totalDiff,
          // quadratic ease-out: T = 2|arc| / v0 so initial speed equals angularVelocity
          duration: arc < 0.001 ? 0 : Math.max(minLookSecs, (2 * arc) / (2 * Math.PI), minMs / 1000),
          elapsed: 0,
          longLook,
        } satisfies typeof lookState);

        if (longLook === true) {
          this.anim.startLookShuffle();
        } else {
          this.anim.stopLookShuffle(); // in case we superseded a `longLook`
        }
      });
    } catch (e) {
      if (e instanceof Error && e.message === "look again") {
        return; // the look which interrupted us owns the animation now
      }
      this.anim.startIdle({ force: true });
      this.anim.stopLookShuffle();
      throw e;
    }

    this.anim.stopLookShuffle();
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
    this.anim.lookState.active = false;
    reject.worker(err); // stop waiting on the worker
    reject.spawn(err);
    reject.move(err);
    reject.scale(err);
    reject.look(err);
  }

  setBubbleHeight(y: number) {
    this.bubbleOffset.y = y;
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

  setLabelYShift(shift: number) {
    this.labelYShiftUniform.value = shift;
  }

  setSkin(skinKey?: string) {
    const skinIndex = this.w.npc.getSkinIndexBySkinKey(skinKey ?? "medic-0");
    console.warn(`${this.key}: skin "${skinKey}" not found`);
    this.skinIndexUniform.value = skinIndex;
  }
}

export type NpcInit = {
  key: string;
  brightness: THREE.UniformNode<"float", number>;
  colorScale: THREE.UniformNode<"float", number>;
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  labelVisible: THREE.UniformNode<"float", number>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  npcLit: THREE.UniformNode<"float", number>;
  roomSlot: THREE.UniformNode<"float", number>;
  material: THREE.MeshStandardNodeMaterial;
  /** Object-picking id, which also indexes the label texture array */
  pickIdUniform: THREE.UniformNode<"float", number>;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;
  skinIndexUniform: THREE.UniformNode<"float", number>;
};

/** How far `ensureLegalPosition` looks for ground the npc is allowed to stand on */
const legalPositionHalfExtents: Vec3 = [1.5, 1, 1.5];
/** Nearer than this and they are already standing legally */
const legalPositionEpsilon = 0.01;
/** How far past the edge `ensureLegalPosition` puts them */
const legalPositionMargin = 0.05;

/** Beyond this angle a look gets its own idle animation */
const longLookAngle = 15 * (Math.PI / 180);

/**
 * No look is quicker than this, however small the angle. The turn's peak rate is `2 * arc /
 * duration`, so a floor eases small turns off the 2π a bare `arc / π` would always give them —
 * and it meets that curve exactly at `arc = 0.3π`, so nothing jumps at the crossover.
 */
const minLookSecs = 0.3;

const npcCannotLookForClip: Record<string, string | undefined> = {
  sit: "not while sitting",
  lie: "not while lying",
};

export function npcBubbleHeightForClip(clipName: string): number {
  if (clipName === "sit") return 1.4;
  if (clipName === "lie") return 0.9;
  return 2;
}

export function npcLabelYShiftForClip(clipName: string): number {
  if (clipName === "sit") return 1.6;
  if (clipName === "lie") return 0.75;
  return 2.2;
}

export function rejectNoop(_e: Error): void {}
