import { useStateRef } from "@npc-cli/util";
import { geomService, Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { select } from "three/src/nodes/tsl/TSLBase.js";
import { attribute, float, positionLocal, texture, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { lockedDoorTint, unlockedDoorTint, wallHeight } from "../const";
import { createDoorBox } from "../service/geometry";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { doorIconKeys, drawDoorIconLayer, drawDoorLabelLayer, type SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      animTargets: new Map(),
      box: createDoorBox(),
      byKey: {},
      inst: null,
      labelToLayer: new Map(),
      openRatioArray: new Float32Array(0),

      buildByKey() {
        const prevByKey = state.byKey;
        state.byKey = {};

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

            state.byKey[gdKey] = {
              gdKey,
              gmId,
              doorId,
              instanceId: state.encodeGmDoorId(gmId, doorId),
              connector,

              // auto: prev?.auto ?? (door.meta.auto === true),
              auto: true,
              axisAligned: connector.normal.x === 0 || connector.normal.y === 0,
              locked: sealed ?? prev?.locked ?? connector.meta.locked === true,
              open: prev?.open ?? false,
              sealed,
              hull,

              src: ut.json,
              dst: vt.json,
              normal: tmpMat.transformSansTranslate(connector.normal.clone()).json,

              closeTimeoutId: -1,
              gapAtHighLambda: false,
            };
          }
        }
      },
      cancelClose(door) {
        window.clearTimeout(door.closeTimeoutId);
        delete door.closeTimeoutId;
      },
      computeRayDoorIntersect(src, dst, gdKey) {
        const door = w.d[gdKey];
        const lambda = geomService.getLineSegsIntersection(src, dst, door.src, door.dst);
        return lambda === null
          ? null
          : geomService.precision2d({ x: src.x + lambda * (dst.x - src.x), y: src.y + lambda * (dst.y - src.y) }, 2);
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
      async drawBaseDoorTextures() {
        // layer 0 (door without label)
        drawDoorLabelLayer(w.texDoorLabel, 0, "");
        state.labelToLayer.set("", 0);

        // layers 1 ... doorIconKeys.length (doors with icons)
        // 🔔 cannot assume w.texDecor loaded
        const sheetMeta = doorIconKeys.map((key) => w.sheets.decor[key]);
        const sheetImages = await w.loadDecorImages();

        for (const [i, iconKey] of doorIconKeys.entries()) {
          const entry = sheetMeta[i];
          const img = sheetImages[entry.sheetId];
          if (img) drawDoorIconLayer(w.texDoorLabel, 1 + i, img, entry);
          // use iconKey as label
          state.labelToLayer.set(iconKey, 1 + i);
        }
      },
      async drawDoorTextures() {
        state.labelToLayer.clear();

        await state.drawBaseDoorTextures();

        let nextLabelIdx = state.labelToLayer.size;
        const frontArray = new Float32Array(w.gms.length << 8);
        const backArray = new Float32Array(w.gms.length << 8);

        for (const { instanceId, connector, hull } of Object.values(state.byKey)) {
          const label = (connector.meta.label as string | undefined) ?? "";
          if (!state.labelToLayer.has(label)) {
            state.labelToLayer.set(label, nextLabelIdx);
            drawDoorLabelLayer(w.texDoorLabel, nextLabelIdx++, label);
          }
          frontArray[instanceId] = state.labelToLayer.get(label) ?? 0;

          if (hull) {
            backArray[instanceId] = 0;
          } else if (typeof connector.meta.backLabel === "string") {
            const backLabel = connector.meta.backLabel as string;
            if (!state.labelToLayer.has(backLabel)) {
              state.labelToLayer.set(backLabel, nextLabelIdx);
              drawDoorLabelLayer(w.texDoorLabel, nextLabelIdx++, backLabel);
            }
            backArray[instanceId] = state.labelToLayer.get(backLabel) ?? 0;
          } else {
            // choose stable random icon
            backArray[instanceId] = 1 + (((instanceId * 2654435761) >>> 0) % doorIconKeys.length);
          }
        }

        state.box.setAttribute("doorLabelLayer", new THREE.InstancedBufferAttribute(frontArray, 1));
        state.box.setAttribute("doorBackLabelLayer", new THREE.InstancedBufferAttribute(backArray, 1));
      },
      encodeGmDoorId(gmId: number, doorId: number) {
        return (gmId << 8) | doorId;
      },
      decodeInstanceId(instanceId) {
        const gmId = instanceId >> 8;
        const doorId = instanceId & 0xff;
        const gdKey = helper.getGmDoorKey(gmId, doorId);
        const gm = w.gms[gmId];
        const { seg, hull } = w.gmsData.byKey[gm.key].doorSegs[doorId];
        const { meta, roomIds } = gm.doors[doorId];
        return { gmId, doorId, gdKey, seg, hull, roomIds, ...meta };
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

        const n = w.gms.length << 8;
        if (state.openRatioArray.length !== n) {
          state.openRatioArray = new Float32Array(n);
        }

        const slideSignArray = new Float32Array(n).fill(1);
        const flipFrontBackArray = new Float32Array(n);

        // zero-scale all instances so unused slots are invisible
        zeroMat4.makeScale(0, 0, 0);
        for (let i = 0; i < n; i++) {
          inst.setMatrixAt(i, zeroMat4);
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
              slideSignArray[instanceId] = tmpV1.x * nx + tmpV1.y * nz >= 0 ? 1 : -1;
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
            flipFrontBackArray[instanceId] = ds.normal.x * nz - ds.normal.y * nx < 0 ? 1 : 0;
            ds.gapAtHighLambda = determinant > 0 === slideSignArray[instanceId] > 0;
          }
        }

        state.box.setAttribute("openRatio", new THREE.InstancedBufferAttribute(state.openRatioArray, 1));
        state.box.setAttribute("slideSign", new THREE.InstancedBufferAttribute(slideSignArray, 1));
        state.box.setAttribute("flipFrontBack", new THREE.InstancedBufferAttribute(flipFrontBackArray, 1));

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
      toggleDoor(door, opts = {}) {
        if (door.sealed === true) {
          return false;
        }

        state.cancelClose(door); // Cancel any pending close

        if (opts.access === false) {
          return false; // No access
        }

        if (door.open === true) {
          // was open
          if (opts.open === true) {
            state.forceDoor(door.gmId, door.doorId, true); // reverses any in-progress close animation
            door.auto === true &&
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

        if (door.auto === true && opening === true) {
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

        w.decor.tintDecor(
          door.locked ? lockedDoorTint : unlockedDoorTint,
          ...w.decor.static.gdKeyToDecorKeys[door.gdKey],
        );

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

  useEffect(() => {
    state.buildByKey();
    state.positionInstances();
    state.drawDoorTextures();
  }, [w.mapKey, w.hash]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardNodeMaterial({ color: "#333" });
    const top = new THREE.MeshStandardNodeMaterial({ color: "#000", metalness: 0.6, roughness: 0.3 });

    const panelOpts = { metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide, transparent: false, depthWrite: true };
    const front = new THREE.MeshStandardNodeMaterial(panelOpts);
    const back = new THREE.MeshStandardNodeMaterial(panelOpts);

    const openRatio = attribute<"float">("openRatio", "float");
    const slideSign = attribute<"float">("slideSign", "float");
    const cs = float(1).sub(openRatio);
    const collapsedX = positionLocal.x.mul(cs).add(slideSign.mul(openRatio).mul(0.5));

    for (const mat of [edge, top, front, back]) {
      mat.positionNode = vec3(collapsedX, positionLocal.y, positionLocal.z);
      mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.door);
    }

    const texLayer = attribute<"float">("doorLabelLayer", "float").toInt();
    const backTexLayer = attribute<"float">("doorBackLabelLayer", "float").toInt();
    /** swaps which face shows the front vs back label */
    const flip = attribute<"float">("flipFrontBack", "float");
    const notFlipped = flip.lessThan(float(0.5));
    const frontOffset = slideSign.negate().greaterThan(0).select(openRatio, float(0));
    const backOffset = slideSign.greaterThan(0).select(openRatio, float(0));

    front.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(frontOffset), uv().y)).depth(
      (select as SelectAnyType)(notFlipped, texLayer, backTexLayer),
    );
    back.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(backOffset), uv().y)).depth(
      (select as SelectAnyType)(notFlipped, backTexLayer, texLayer),
    );

    return [edge, edge, top, edge, front, back];
  }, []);

  const instanceCount = w.gms.length << 8;

  return instanceCount ? (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[state.box, undefined, instanceCount]}
      material={materials}
      renderOrder={4}
    />
  ) : null;
}

export type State = {
  animTargets: Map<number, number>;
  box: THREE.BoxGeometry;
  byKey: { [gmDoorKey in Geomorph.GmDoorKey]: Geomorph.DoorState };
  inst: null | THREE.InstancedMesh;
  /** Label or iconKey. */
  labelToLayer: Map<string, number>;
  openRatioArray: Float32Array;
  buildByKey: () => void;
  cancelClose: (door: Geomorph.DoorState) => void;
  computeRayDoorIntersect: (src: Geom.VectJson, dst: Geom.VectJson, gdKey: Geomorph.GmDoorKey) => Geom.VectJson | null;
  checkRayDoorBlock: (
    src: Geom.VectJson,
    dst: Geom.VectJson,
    gdKey: Geomorph.GmDoorKey,
  ) => { blocked: boolean; hit: Geom.VectJson | null };
  drawBaseDoorTextures: () => Promise<void>;
  drawDoorTextures: () => Promise<void>;
  encodeGmDoorId: (gmId: number, doorId: number) => number;
  decodeInstanceId: (instanceId: number) => Geomorph.GmDoorId & {
    seg: [Geom.Vect, Geom.Vect];
    hull: boolean;
  };
  isOpen: (gmId: number, doorId: number) => boolean;
  /** Toggles when `open` is `undefined`. */
  forceDoor: (gmId: number, doorId: number, open?: boolean) => void;
  onDoorChanged: (instanceId: number, target: number) => void;
  onTick: (delta: number) => void;
  positionInstances: () => void;
  toggleDoor: (door: Geomorph.DoorState, opts?: Geomorph.ToggleDoorOpts) => boolean;
  toggleLock: (door: Geomorph.DoorState, opts?: Geomorph.ToggleLockOpts) => boolean;
};

const doorHeight = wallHeight - 0.001;
const doorSpeed = 4;
const doorOpenTarget = 0.9;
const doorOpenTest = 0.8;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4();
