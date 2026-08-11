import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, lights, positionLocal, texture, uniform, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { lockedDoorTint, unlockedDoorTint, wallHeight } from "../const";
import { createDoorBox } from "../service/geometry";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { getWorldMapStore } from "../service/storage";
import { drawDoorLabelLayer } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      animTargets: new Map(),
      box: createDoorBox(),
      brightnessNode: uniform(1),
      byKey: {},
      labelToLayer: new Map(),
      lastHmr: 0,

      inst: null,
      instanceCount: 0,
      toInstanceId: [],
      fromInstanceId: {},
      openRatioArray: new Float32Array(MAX_DOORS),
      /** Per-instance `[slideSign, frontLayer, backLayer]` */
      doorMetaArray: new Float32Array(MAX_DOORS * 3),
      /** Does this door's +z face show its BACK label? Cpu-only, so the shader needs no swap */
      flipped: new Uint8Array(MAX_DOORS),

      buildByKey() {
        const prevByKey = state.byKey;
        state.byKey = {};
        const saved = getWorldMapStore(w.key, w.mapKey).read().doorLocks;
        const savedLocked = saved === null ? null : new Set(saved);

        for (const [gmId, gm] of w.gms.entries()) {
          for (const [doorId, connector] of gm.doors.entries()) {
            const [u, v] = connector.seg;
            tmpMat.setMatrixValue(gm.transform);
            const ut = tmpMat.transformPoint(tmpV1.copy(u));
            const vt = tmpMat.transformPoint(tmpV2.copy(v));

            const gdKey = `g${gmId}d${doorId}` as const;
            const hull = gm.isHullDoor(doorId);
            const prev = prevByKey[gdKey];
            const sealed =
              hull === true ? w.gmGraph.getDoorNodeById(gmId, doorId).sealed : connector.meta.sealed === true;
            const src = ut.json;
            const dst = vt.json;
            const normal = tmpMat.transformSansTranslate(connector.normal.clone()).json;
            const auto = connector.meta.auto === true;

            state.byKey[gdKey] = {
              gdKey,
              gmId,
              doorId,
              instanceId: state.encodeGmDoorId(gmId, doorId),
              connector,

              auto,
              axisAligned: connector.normal.x === 0 || connector.normal.y === 0,
              // live state wins on rebuild (e.g. hmr), then the previous session, then the map
              locked:
                sealed === true ? true : (prev?.locked ?? savedLocked?.has(gdKey) ?? connector.meta.locked === true),
              open: prev?.open ?? false,
              sealed,
              proximity: connector.meta.proximity ?? (auto === true || hull === true),
              hull,

              src,
              dst,
              normal,
              innerSegs: [
                [
                  { x: src.x + 0.2 * normal.x, y: src.y + 0.2 * normal.y },
                  { x: dst.x + 0.2 * normal.x, y: dst.y + 0.2 * normal.y },
                ],
                [
                  { x: src.x - 0.2 * normal.x, y: src.y - 0.2 * normal.y },
                  { x: dst.x - 0.2 * normal.x, y: dst.y - 0.2 * normal.y },
                ],
              ],

              closeTimeoutId: -1,
              gapAtHighLambda: false,
            };
          }
        }
      },
      buildInstanceIds() {
        state.toInstanceId = [];
        state.fromInstanceId = {};
        let nextId = 0;
        for (const [gmId, gm] of w.gms.entries()) {
          state.toInstanceId[gmId] = [];
          for (const [doorId] of gm.doors.entries()) {
            state.toInstanceId[gmId][doorId] = nextId;
            state.fromInstanceId[nextId] = helper.getGmDoorId(gmId, doorId);
            nextId++;
          }
        }
        if (nextId > MAX_DOORS) {
          console.warn(`Doors: ${nextId} doors exceeds MAX_DOORS (${MAX_DOORS}); extra doors will not render`);
        }
        return (state.instanceCount = Math.min(nextId, MAX_DOORS));
      },
      cancelClose(door) {
        window.clearTimeout(door.closeTimeoutId);
        delete door.closeTimeoutId;
      },
      checkRayDoorBlock(src, dst, gdKey) {
        const door = w.d[gdKey];
        const openRatio = state.openRatioArray[door.instanceId];
        const rayLambda = geomService.getLineSegsIntersection(src, dst, door.src, door.dst);

        if (rayLambda === null) {
          return { blocked: openRatio === 0, hit: null };
        }

        if (openRatio === 0) {
          // blocked by closed door and hits
          return {
            blocked: true,
            hit: geomService.precision2d(
              { x: src.x + rayLambda * (dst.x - src.x), y: src.y + rayLambda * (dst.y - src.y) },
              2,
            ),
          };
        }

        const hitX = src.x + rayLambda * (dst.x - src.x);
        const hitY = src.y + rayLambda * (dst.y - src.y);

        // project hit onto door segment to get doorLambda ∈ [0,1] (0=door.src, 1=door.dst)
        const dDoorX = door.dst.x - door.src.x;
        const dDoorY = door.dst.y - door.src.y;
        const doorLambda = ((hitX - door.src.x) * dDoorX + (hitY - door.src.y) * dDoorY) / (dDoorX ** 2 + dDoorY ** 2);

        const inGap = door.gapAtHighLambda ? doorLambda >= 1 - openRatio : doorLambda <= openRatio;

        return { blocked: !inGap, hit: inGap ? null : geomService.precision2d({ x: hitX, y: hitY }, 2) };
      },
      computeRayDoorIntersect(src, dst, gdKey) {
        const door = w.d[gdKey];
        const lambda = geomService.getLineSegsIntersection(src, dst, door.src, door.dst);
        return lambda === null
          ? null
          : geomService.precision2d({ x: src.x + lambda * (dst.x - src.x), y: src.y + lambda * (dst.y - src.y) }, 2);
      },
      decodeInstanceId(instanceId) {
        const { gmId, doorId, gdKey } = state.fromInstanceId[instanceId];
        const gm = w.gms[gmId];
        const { seg, hull } = w.gmsData.byKey[gm.key].doorSegs[doorId];
        const { meta, roomIds } = gm.doors[doorId];
        return { gmId, doorId, gdKey, seg, hull, roomIds, ...meta };
      },
      doesPathIntersectDoor(path, door) {
        if (path.length === 0) {
          return false;
        }

        // sign -1 means normal is pointing towards our current room i.e. inside `door.connector.roomIds[0]`
        const roomIdsIndex =
          Math.sign((door.src.x - path[0].x) * door.normal.x + (door.src.y - path[0].y) * door.normal.y) === -1 ? 0 : 1;

        const [src, dst] = door.innerSegs[roomIdsIndex]; // closer than door.{src,dst}

        const intersects = path.some(
          (p, i) => i > 0 && geomService.getLineSegsIntersection(p, path[i - 1], src, dst) !== null,
        );

        return intersects;
      },
      drawDoorTextures() {
        // layer 0 is the door without a label; each distinct label gets its own layer after it
        state.labelToLayer.clear();
        drawDoorLabelLayer(w.texDoorLabel, LAYER_PLAIN, "");
        state.labelToLayer.set("", LAYER_PLAIN);

        let nextLabelIdx = LAYER_PLAIN + 1;
        const count = state.instanceCount;
        for (let i = 0; i < count; i++) {
          state.doorMetaArray[i * 3 + FRONT_LAYER] = LAYER_PLAIN;
          state.doorMetaArray[i * 3 + BACK_LAYER] = LAYER_PLAIN;
        }

        /** A face shows its label if it has one, else the plain panel */
        const applyFace = (instanceId: number, metaOffset: number, label: undefined | string) => {
          if (label === undefined) {
            return; // already `LAYER_PLAIN`
          }
          if (!state.labelToLayer.has(label)) {
            state.labelToLayer.set(label, nextLabelIdx);
            drawDoorLabelLayer(w.texDoorLabel, nextLabelIdx++, label);
          }
          state.doorMetaArray[instanceId * 3 + metaOffset] = state.labelToLayer.get(label) ?? LAYER_PLAIN;
        };

        for (const { instanceId, connector, hull } of Object.values(state.byKey)) {
          const { label, backLabel } = connector.meta as Record<string, undefined | string>;
          // resolve which physical face is which here, so the shader never has to swap
          const swap = state.flipped[instanceId] === 1;

          applyFace(instanceId, swap ? BACK_LAYER : FRONT_LAYER, typeof label === "string" ? label : undefined);

          if (hull) {
            continue; // the back of a hull door is never seen
          }
          applyFace(instanceId, swap ? FRONT_LAYER : BACK_LAYER, typeof backLabel === "string" ? backLabel : undefined);
        }
      },
      encodeGmDoorId(gmId: number, doorId: number) {
        return state.toInstanceId[gmId]?.[doorId] ?? -1;
      },
      forceDoor(gmId, doorId, open) {
        const instanceId = state.encodeGmDoorId(gmId, doorId);
        const animTarget = state.animTargets.get(instanceId);
        // use animation target when in progress so reversals aren't suppressed by the mid-animation ratio
        const isOpen = animTarget !== undefined ? animTarget > doorOpenTest : state.isOpen(gmId, doorId);
        if (typeof open === "boolean" && open === isOpen) {
          return;
        }
        const shouldOpen = open === undefined ? !isOpen : open;
        state.animTargets.set(instanceId, shouldOpen ? doorOpenTarget : 0);
        w.events.next({
          key: shouldOpen ? "door-opening" : "door-closing",
          open: isOpen,
          ...state.decodeInstanceId(instanceId),
        });
      },
      isOpen(gmId, doorId) {
        return state.openRatioArray[state.encodeGmDoorId(gmId, doorId)] > doorOpenTest;
      },
      onDoorChanged(instanceId, target) {
        state.openRatioArray[instanceId] = target;
        state.animTargets.delete(instanceId);
        const open = target > doorOpenTest;
        const { gdKey } = state.decodeInstanceId(instanceId);
        state.byKey[gdKey].open = open;
        w.events.next({ key: open ? "door-open" : "door-closed", open, ...state.decodeInstanceId(instanceId) });
      },
      onTick(delta: number) {
        if (state.animTargets.size === 0) return;
        let changed = false;
        for (const [instanceId, target] of state.animTargets) {
          const cur = state.openRatioArray[instanceId];
          const next = cur + Math.sign(target - cur) * delta * doorSpeed;
          if ((target - cur) * (target - next) <= 0) {
            state.onDoorChanged(instanceId, target);
          } else {
            state.openRatioArray[instanceId] = next;
          }
          changed = true;
        }
        if (changed) {
          const attr = state.box.getAttribute("openRatio") as THREE.BufferAttribute | undefined;
          if (attr) attr.needsUpdate = true;
          // if (w.disabled) w.view.forceUpdate();
        }
      },
      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        const count = state.instanceCount;
        inst.count = count; // draw only the real doors; buffers stay at MAX_DOORS capacity
        state.openRatioArray.fill(0);

        // zero-scale all instances so unused slots are invisible; reset slideSign default (1)
        zeroMat4.makeScale(0, 0, 0);
        for (let i = 0; i < count; i++) {
          inst.setMatrixAt(i, zeroMat4);
          state.doorMetaArray[i * 3 + SLIDE_SIGN] = 1;
          state.flipped[i] = 0;
        }

        for (let gmId = 0; gmId < w.gms.length; gmId++) {
          const gm = w.gms[gmId];
          const { key: gmKey, transform, determinant } = gm;
          tmpMat.setMatrixValue(transform);
          const doorSegs = w.gmsData.byKey[gmKey].doorSegs;

          for (let localId = 0; localId < doorSegs.length; localId++) {
            const door = doorSegs[localId];
            if (!("seg" in door)) continue;
            const {
              seg: [u, v],
              hull,
            } = door;
            if (determinant > 0) {
              tmpV1.copy(v);
              tmpV2.copy(u);
            } else {
              tmpV1.copy(u);
              tmpV2.copy(v);
            }
            tmpMat.transformPoint(tmpV1);
            tmpMat.transformPoint(tmpV2);

            const dx = tmpV2.x - tmpV1.x - 0.01;
            const dz = tmpV2.y - tmpV1.y;
            const len = tmpV1.distanceTo(tmpV2);
            const nx = len > 0 ? dx / len : 1;
            const nz = len > 0 ? dz / len : 0;
            const mx = (tmpV1.x + tmpV2.x) / 2;
            const mz = (tmpV1.y + tmpV2.y) / 2;
            const depth = hull ? hullPanelDepth : panelDepth;

            const instanceId = state.encodeGmDoorId(gmId, localId);

            const sd = gm.doors[localId]?.meta?.slide;
            if (Array.isArray(sd)) {
              tmpV1.set(sd[0], sd[1]);
              tmpMat.transformSansTranslate(tmpV1);
              state.doorMetaArray[instanceId * 3 + SLIDE_SIGN] = tmpV1.x * nx + tmpV1.y * nz >= 0 ? 1 : -1;
            }

            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );

            inst.setMatrixAt(instanceId, tmpMat4);

            // box local -z maps to world 2D (nz, -nx); flip when door.normal points the other way
            const ds = state.byKey[helper.getGmDoorKey(gmId, localId)];
            state.flipped[instanceId] = ds.normal.x * nz - ds.normal.y * nx < 0 ? 1 : 0;
            ds.gapAtHighLambda = determinant > 0 === state.doorMetaArray[instanceId * 3 + SLIDE_SIGN] > 0;
          }
        }

        inst.computeBoundingSphere();
      },
      setBrightness(next) {
        state.brightnessNode.value = next;
      },
      persistLocks() {
        // exhaustive, so an unlocked door which `meta.locked` would lock stays unlocked;
        // sealed doors are always locked, so they'd only bloat it
        const doorLocks = Object.values(state.byKey).flatMap((d) => (d.sealed === false && d.locked ? d.gdKey : []));
        getWorldMapStore(w.key, w.mapKey).patch({ doorLocks });
      },
      applyLocks(gdKeys) {
        const locked = new Set(gdKeys);
        for (const door of Object.values(state.byKey)) {
          door.locked = door.sealed === true || locked.has(door.gdKey);
        }
        state.syncLockTints();
      },
      syncLockTint(door) {
        const associatedDecorKeys = w.decor.static.gdKeyToDecorKeys?.[door.gdKey];
        if (associatedDecorKeys) {
          w.decor.tintDecor(door.locked ? lockedDoorTint : unlockedDoorTint, ...associatedDecorKeys);
        }
      },
      syncLockTints() {
        for (const door of Object.values(state.byKey)) {
          state.syncLockTint(door);
        }
      },
      sendDataToGpu() {
        if (state.inst) state.inst.instanceMatrix.needsUpdate = true;
        const openRatioAttr = state.box.getAttribute("openRatio");
        const doorMetaAttr = state.box.getAttribute("doorMeta");
        if (openRatioAttr) openRatioAttr.needsUpdate = true;
        if (doorMetaAttr) doorMetaAttr.needsUpdate = true;
      },
      toggleDoor(door, opts = {}) {
        if (door.sealed === true) {
          return false;
        }

        if (opts.access === false) {
          return false; // No access
        }

        state.cancelClose(door); // Cancel any pending close

        if (door.open === true) {
          // was open
          if (opts.open === true) {
            // reverse any in-progress close animation
            state.forceDoor(door.gmId, door.doorId, true);
            w.events.next({
              key: "try-close-door",
              gdKey: door.gdKey,
            });
            return true;
          }
          if (opts.clear !== true) {
            return false; // cannot close or toggle
          }
        } else {
          // was closed
          if (opts.close === true) {
            return true;
          }
        }

        // Actually open/close door
        const opening = !door.open;
        state.forceDoor(door.gmId, door.doorId, opening);

        if (opening === true) {
          w.events.next({
            key: "try-close-door",
            gdKey: door.gdKey,
          });
        }

        return true;
      },
      toggleLock(door, opts = {}) {
        if (door.sealed === true) {
          return false;
        }

        if (opts.access === false) {
          return false; // No access
        }

        if (door.locked === true) {
          if (opts.lock === true) return true; // Already locked
        } else {
          if (opts.unlock === true) return true; // Already unlocked
        }

        // Actually lock/unlock door
        door.locked = !door.locked;

        state.syncLockTint(door);
        state.persistLocks();

        w.events.next({
          key: door.locked ? "door-locked" : "door-unlocked",
          locked: door.locked,
          ...state.decodeInstanceId(door.instanceId),
        });

        return true;
      },
    }),
  );

  w.door = state;
  w.d = w.door.byKey;

  // dense instanceIds (0..instanceCount-1), rebuilt whenever the set of doors can change;
  // instanceCount must stay <= MAX_DOORS since attribute buffers are allocated at that fixed size
  const instanceCount = useMemo(() => state.buildInstanceIds(), [w.mapKey, w.hash]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardNodeMaterial({ color: "#333" });

    const panelOpts = { metalness: 0.5, roughness: 0.25, side: THREE.FrontSide, transparent: false, depthWrite: true };
    const front = new THREE.MeshStandardNodeMaterial(panelOpts);
    const back = new THREE.MeshStandardNodeMaterial(panelOpts);

    const openRatio = attribute<"float">("openRatio", "float");
    const doorMeta = attribute<"vec3">("doorMeta", "vec3");
    const slideSign = doorMeta.x;
    const cs = float(1).sub(openRatio);
    const collapsedX = positionLocal.x.mul(cs).add(slideSign.mul(openRatio).mul(0.5));

    for (const mat of [edge, front, back]) {
      mat.positionNode = vec3(collapsedX, positionLocal.y, positionLocal.z);
      mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.door);
    }

    const frontOffset = slideSign.negate().greaterThan(0).select(openRatio, float(0));
    const backOffset = slideSign.greaterThan(0).select(openRatio, float(0));

    // `doorMeta` carries each face's layer already oriented, so there is no swap here
    front.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(frontOffset), uv().y))
      .depth(doorMeta.y.toInt())
      .mul(vec3(state.brightnessNode));
    back.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(backOffset), uv().y))
      .depth(doorMeta.z.toInt())
      .mul(vec3(state.brightnessNode));

    // only 3 groups in door box
    const output = [edge, front, back];
    // directional lights potentially costly due to dynamic openRatio + instancing
    const lightsNode = lights([new THREE.AmbientLight(0xffffff, 0.4)]);
    output.forEach((material) => (material.lightsNode = lightsNode));
    return output;
    // `TexArray.resize` recreates `tex`, disposing the one these nodes captured — so the
    // materials must be rebuilt when it does, as `Decor.tsx` does via its query key
  }, []);

  useEffect(() => {
    if (import.meta.hot?.data.__JUST_HMR_DOORS__ === true) {
      import.meta.hot.data.__JUST_HMR_DOORS__ = false;
      state.set({ lastHmr: Date.now() }); // re-run, the mesh having been recreated beneath us
      return;
    }
    state.buildByKey();
    state.positionInstances();
    state.drawDoorTextures();
    state.sendDataToGpu();
    state.syncLockTints();
    state.update();
  }, [w.mapKey, w.hash, state.lastHmr, w.decor.ready]);

  return (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[state.box, undefined, MAX_DOORS]}
      material={materials}
      renderOrder={4}
      visible={instanceCount > 0}
    >
      <instancedBufferAttribute attach="geometry-attributes-openRatio" args={[state.openRatioArray, 1]} />
      <instancedBufferAttribute attach="geometry-attributes-doorMeta" args={[state.doorMetaArray, 3]} />
    </instancedMesh>
  );
}

export type State = {
  animTargets: Map<number, number>;
  box: THREE.BoxGeometry;
  brightnessNode: THREE.UniformNode<"float", number>;
  byKey: { [gmDoorKey in Geomorph.GmDoorKey]: Geomorph.DoorState };
  inst: null | THREE.InstancedMesh;
  /** Total number of doors across all `w.gms`; also the InstancedMesh's instance count */
  instanceCount: number;
  /** `toInstanceId[gmId][doorId]` is the dense instanceId */
  toInstanceId: number[][];
  /** Inverse of `toInstanceId`, keyed by instanceId */
  fromInstanceId: Record<number, Geomorph.GmDoorId>;
  /** Label or iconKey. */
  labelToLayer: Map<string, number>;
  /** Bumped by an hmr of this file, so the effect below re-runs — see `__JUST_HMR_DOORS__` */
  lastHmr: number;
  openRatioArray: Float32Array;
  /** Per-instance `[slideSign, frontLayer, backLayer]` */
  doorMetaArray: Float32Array;
  /** Does this door's +z face show its BACK label? Cpu-only, so the shader needs no swap */
  flipped: Uint8Array;
  buildByKey: () => void;
  /** (Re)builds `toInstanceId`/`fromInstanceId`/`instanceCount`; returns `instanceCount` */
  buildInstanceIds: () => number;
  cancelClose: (door: Geomorph.DoorState) => void;
  computeRayDoorIntersect: (src: Geom.VectJson, dst: Geom.VectJson, gdKey: Geomorph.GmDoorKey) => Geom.VectJson | null;
  checkRayDoorBlock: (
    src: Geom.VectJson,
    dst: Geom.VectJson,
    gdKey: Geomorph.GmDoorKey,
  ) => { blocked: boolean; hit: Geom.VectJson | null };
  decodeInstanceId: (instanceId: number) => Geomorph.GmDoorId & {
    seg: [Geom.Vect, Geom.Vect];
    hull: boolean;
  };
  /**
   * For example `path` could be corners of agent.
   */
  doesPathIntersectDoor(path: Geom.VectJson[], door: Geomorph.DoorState): boolean;
  drawDoorTextures: () => void;
  encodeGmDoorId: (gmId: number, doorId: number) => number;
  isOpen: (gmId: number, doorId: number) => boolean;
  /** Toggles when `open` is `undefined`. */
  forceDoor: (gmId: number, doorId: number, open?: boolean) => void;
  onDoorChanged: (instanceId: number, target: number) => void;
  onTick: (delta: number) => void;
  positionInstances: () => void;
  /** Sets `brightnessNode`'s value — called by `onChangeTheme` (see `use-world-events.ts`), never `.value` directly */
  setBrightness: (next: number) => void;
  /** Save which doors are locked for `w.mapKey`, so `buildByKey` can restore them */
  persistLocks: () => void;
  /** Lock exactly these doors, e.g. having restored them from another world */
  applyLocks: (gdKeys: string[]) => void;
  sendDataToGpu: () => void;
  toggleDoor: (door: Geomorph.DoorState, opts?: Geomorph.ToggleDoorOpts) => boolean;
  toggleLock: (door: Geomorph.DoorState, opts?: Geomorph.ToggleLockOpts) => boolean;
  /** Tint this door's switches to match `door.locked` */
  syncLockTint: (door: Geomorph.DoorState) => void;
  /** Re-apply every door's switch tint, e.g. once decor has been rebuilt */
  syncLockTints: () => void;
};

/** Fixed InstancedMesh capacity so geometry attribute buffers are never recreated */
const MAX_DOORS = 512;
const doorHeight = wallHeight - 0.001;
const doorSpeed = 4;
const doorOpenTarget = 0.98;
const doorOpenTest = 0.8;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
/** Offsets within each instance's `doorMetaArray` triple */
const SLIDE_SIGN = 0;
/** These are the +z and -z faces, already oriented — see `state.flipped` */
const FRONT_LAYER = 1;
const BACK_LAYER = 2;
/** Layers of `w.texDoorLabel` which every door shares */
const LAYER_PLAIN = 0;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4();

import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("Doors.tsx"));
  if (import.meta.hot && updatedThisFile) {
    import.meta.hot.data.__JUST_HMR_DOORS__ = true;
  }
});
