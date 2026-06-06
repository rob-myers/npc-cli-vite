import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, positionLocal, texture, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { lockedDoorTint, unlockedDoorTint, wallHeight } from "../const";
import { createDoorBox } from "../service/geometry";
import { helper } from "../service/helper";
import { PICK_TYPE } from "../service/pick";
import { drawDoorLabelLayer } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      box: createDoorBox(),
      byKey: {},
      inst: null,
      openRatioArray: new Float32Array(0),
      animTargets: new Map(),

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
              normal: tmpMat.transformSansTranslate(connector.normal.clone()),

              closeTimeoutId: -1,
            };
          }
        }
      },
      cancelClose(door) {
        window.clearTimeout(door.closeTimeoutId);
        delete door.closeTimeoutId;
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
      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        const n = w.gms.length << 8;
        if (state.openRatioArray.length !== n) {
          state.openRatioArray = new Float32Array(n);
        }

        const slideSignArray = new Float32Array(n).fill(1);

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
          }
        }

        state.box.setAttribute("openRatio", new THREE.InstancedBufferAttribute(state.openRatioArray, 1));
        state.box.setAttribute("slideSign", new THREE.InstancedBufferAttribute(slideSignArray, 1));

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
      forceDoor(gmId, doorId, open) {
        const isOpen = state.isOpen(gmId, doorId);
        if (typeof open === "boolean" && open === isOpen) {
          return;
        }
        const shouldOpen = open === undefined ? !isOpen : open;
        const instanceId = state.encodeGmDoorId(gmId, doorId);
        state.animTargets.set(instanceId, shouldOpen ? doorOpenTarget : 0);
        w.events.next({
          key: shouldOpen ? "door-opening" : "door-closing",
          open: isOpen,
          ...state.decodeInstanceId(instanceId),
        });
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
        // 🚧 move to use-world-events
        w.decor.tintInstances(
          door.locked ? lockedDoorTint : unlockedDoorTint,
          ...w.decor.gdKeyToInstanceId[door.gdKey],
        );

        w.events.next({
          key: door.locked ? "door-locked" : "door-unlocked",
          locked: door.locked,
          ...state.decodeInstanceId(door.instanceId),
        });

        return true;
      },
      buildLabelTextures() {
        const labelToLayer = new Map<string, number>();
        const arr = new Float32Array(w.gms.length << 8);
        for (const { instanceId, connector } of Object.values(state.byKey)) {
          const label = (connector.meta.label as string | undefined) ?? "todo";
          if (!labelToLayer.has(label)) {
            const idx = labelToLayer.size;
            labelToLayer.set(label, idx);
            drawDoorLabelLayer(w.texDoorLabel, idx, label);
          }
          arr[instanceId] = labelToLayer.get(label) ?? 0;
        }
        state.box.setAttribute("doorLabelLayer", new THREE.InstancedBufferAttribute(arr, 1));
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
    }),
  );

  w.door = state;
  w.d = w.door.byKey;

  useEffect(() => {
    state.buildByKey();
    state.positionInstances();
    state.buildLabelTextures();
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
      mat.outputNode = w.view.withPickOutput(PICK_TYPE.door);
    }

    const texLayer = attribute<"float">("doorLabelLayer", "float").toInt();
    const frontOffset = slideSign.negate().greaterThan(0).select(openRatio, float(0));
    front.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(frontOffset), uv().y)).depth(texLayer);
    const backOffset = slideSign.greaterThan(0).select(openRatio, float(0));
    back.colorNode = texture(w.texDoorLabel.tex, vec2(uv().x.mul(cs).add(backOffset), uv().y)).depth(texLayer);

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
  box: THREE.BoxGeometry;
  byKey: { [gmDoorKey in Geomorph.GmDoorKey]: Geomorph.DoorState };
  inst: null | THREE.InstancedMesh;
  openRatioArray: Float32Array;
  animTargets: Map<number, number>;
  buildByKey: () => void;
  buildLabelTextures: () => void;
  cancelClose: (door: Geomorph.DoorState) => void;
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
const doorSpeed = 2;
const doorOpenTarget = 0.9;
const doorOpenTest = 0.8;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4();
