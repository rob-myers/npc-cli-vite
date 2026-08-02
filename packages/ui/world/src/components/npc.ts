import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import type { buildGraph } from "@react-three/fiber";
import { deltaAngle } from "maath/misc";
import { createDefaultQueryFilter, type FindNearestPolyResult, getNodeByRef, type QueryFilter } from "navcat";
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
  /** object-picking id*/
  pickId: number;
  /** navigation strategy */
  queryFilter!: QueryFilter;

  bubbleOffset = new THREE.Vector3(0, 0, 0);
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  group: THREE.Group | null = null;
  material: THREE.MeshStandardNodeMaterial;
  /** synced with crowd agent */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;

  brightness: THREE.UniformNode<"float", number>;
  colorScale: THREE.UniformNode<"float", number>;
  /** points into ArrayTexture */
  labelLayerIndex: number;
  labelVisible!: THREE.UniformNode<"float", number>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
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
    /** Seen nav node ref */
    navNodeRef: -1,
    /** Seconds elapsed */
    pinTime: 0,
    /** Position (used in stuck detection)  */
    point: { x: 0, y: 0 },
  };
  /**
   * Number of times current nav node changed during current/last navigation.
   *
   * Inaccessible nav nodes (polygons of doorways of locked doors) are set
   * initially accessible to prevent npc getting stuck just beyond locked door.
   */
  nodeCount = 0;
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

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;

    // Object.assign(this, init);
    this.key = init.key;
    this.brightness = init.brightness;
    this.colorScale = init.colorScale;
    this.geometry = init.geometry;
    this.graph = init.graph;
    this.labelLayerIndex = init.labelLayerIndex;
    this.labelVisible = init.labelVisible;
    this.labelYShiftUniform = init.labelYShiftUniform;
    this.material = init.material;
    this.pickId = init.pickId;
    this.position = init.position;
    this.rotation = init.rotation;
    this.skinnedMesh = init.skinnedMesh;
    this.skinIndexUniform = init.skinIndexUniform;

    this.bodyUid = addBodyKeyUidRelation(npcToBodyKey(this.key), w.npc.physics);
    this.anim.moveClip = this.clips.walk;
    this.anim.idleClip = this.clips[defaultIdleAnimationClipKey];
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
      this.rejectAll(new Error("interrupted"));
      this.resolve.fade = resolve;
      this.reject.scale = reject;
      this.anim.fadeState.target = 1;
      this.anim.fadeState.delta = Math.abs(speed);
    });
  }

  async fadeOut(speed = 8) {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("interrupted"));
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

    // overwrite
    this.skinnedMesh = group.children[0] as THREE.SkinnedMesh;
    this.position = this.skinnedMesh.position;
    this.rotation = this.skinnedMesh.rotation;
    this.anim.mixer = new THREE.AnimationMixer(group);

    this.resolve.spawn("spawned");

    this.anim.mixer.clipAction(this.anim.idleClip).play();
    this.anim.mixer.update(0);
  };

  init() {
    this.skinnedMesh.computeBoundingSphere();

    this.bubbleOffset.y = npcBubbleHeightForClip(this.anim.idleClip.name);

    this.setLabelYShift(npcLabelYShiftForClip(this.anim.idleClip.name));

    this.queryFilter = {
      ...createDefaultQueryFilter(),

      passFilter: (nodeRef, navMesh) => {
        const node = getNodeByRef(navMesh, nodeRef);
        if (nodeRef !== this.last.navNodeRef) {
          this.last.navNodeRef = nodeRef;
          this.nodeCount++;
        }

        if (this.nodeCount > 2 && isDoorAreaId(node.area) === true) {
          const gmDoorId = decodeDoorAreaId(node.area);
          if (!this.w.e.npcCanAccess(this.key, gmDoorId.gdKey)) {
            this.last.blockingArea = node.area;
            return false;
          }
        }

        return true;
      },
    };

    const skinKey = this.w.npc.getSkinKeyBySkinIndex(this.skinIndex) ?? defaultSkinKey;
    const skinMeta = this.w.npc.getSkinMeta(skinKey);
    const brightnessMeta = skinMeta?.brightness;
    this.brightness.value = typeof brightnessMeta === "number" ? brightnessMeta : 0.4;
  }

  isLooking() {
    return this.anim.lookState.active;
  }

  isMoving() {
    return this.anim.moving;
  }

  /**
   * Can look at `npcKey` or point.
   */
  async look(at: string | MaybeMeta<JshCli.PointAnyFormat>, { angularVelocity = 2 * Math.PI, immediate = false } = {}) {
    const p = helper.parseGroundPoint(typeof at === "string" ? this.w.npc.get(at).position : at);
    this.last.look = p;

    const cannotLook = npcCannotLookForClip[this.anim.idleClip.name];
    if (cannotLook !== undefined) {
      throw Error(cannotLook);
    }

    const target = geomService.getThreeRotationY(p.y - this.position.z, p.x - this.position.x);
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
        this.rejectAll(new Error("interrupted"));
        this.resolve.look = resolve;
        this.reject.look = reject;

        Object.assign(lookState, {
          active: true,
          startAngle,
          totalDiff,
          // quadratic ease-out: T = 2|arc| / v0 so initial speed equals angularVelocity
          duration: arc < 0.001 ? 0 : (2 * arc) / Math.abs(angularVelocity),
          elapsed: 0,
          longLook,
        } satisfies typeof lookState);

        if (longLook) {
          this.anim.moveClip = this.clips.idle; // different from breathe?
          this.anim.mixer.existingAction(this.anim.idleClip)?.fadeOut(0.15);
          this.anim.mixer.clipAction(this.anim.moveClip).reset().fadeIn(0.15).play();
          this.anim.mixer.timeScale = 0.75;
        }
      });
    } finally {
      lookState.longLook = false;
      this.anim.mixer.timeScale = 1;
      this.anim.moveClip = this.clips.walk;
    }
  }

  pinTo(result: FindNearestPolyResult, overrideGroundPoint?: JshCli.GroundPoint): boolean {
    if (this.agentId === null || result.success === false) {
      return false;
    }
    this.last.pinTime = this.w.timer.getElapsedTime();
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
    this.reject = { spawn: rejectNoop, move: rejectNoop, scale: rejectNoop, look: rejectNoop };
    // synchronously stop scale or look
    this.anim.fadeState.delta = 0;
    this.anim.lookState.active = false;
    reject.spawn(err);
    reject.move(err);
    reject.scale(err);
    reject.look(err);
  }

  setBubbleHeight(y: number) {
    this.bubbleOffset.y = y;
  }

  setLabelYShift(shift: number) {
    this.labelYShiftUniform.value = shift;
  }

  setSkin(skinKey?: string) {
    const skinIndex = this.w.npc.getSkinIndexBySkinKey(skinKey ?? "medic-0");
    console.warn(`${this.key}: skin "${skinKey}" not found`);
    this.skinIndexUniform.value = skinIndex;
  }

  async waitUntilResolved() {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("interrupted"));
      this.resolve.move = resolve;
      this.reject.move = reject;
    });
  }
}

export type NpcInit = {
  key: string;
  alphaTest: THREE.UniformNode<"float", number>;
  brightness: THREE.UniformNode<"float", number>;
  colorScale: THREE.UniformNode<"float", number>;
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  labelLayerIndex: number;
  labelVisible: THREE.UniformNode<"float", number>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  material: THREE.MeshStandardNodeMaterial;
  pickId: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  skinnedMesh: THREE.SkinnedMesh;
  skinIndexUniform: THREE.UniformNode<"float", number>;
};

/** Beyond this angle a look gets its own idle animation */
const longLookAngle = (30 * Math.PI) / 180;

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

function rejectNoop(_e: Error): void {}
