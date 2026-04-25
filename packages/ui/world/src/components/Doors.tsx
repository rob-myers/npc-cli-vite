import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, instanceIndex, int, normalLocal, texture, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import { PICK_TYPE, withPickOutput } from "../service/pick";
import { createPanelAtlas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);
  const doorCount = w.gmsData.count.door;

  const state = useStateRef(
    (): State => ({
      box: (() => {
        const g = new THREE.BoxGeometry(1, 1, 1);
        g.setAttribute("collapseScale", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
        return g;
      })(),
      collapseScales: new Float32Array(0),
      inst: null,
      openDoorsRatio: new Float32Array(0),
      slideData: new Float32Array(0),

      decodeInstanceId(instanceId: number) {
        let doorId = instanceId; // one seg per door
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].doorSegs.length;
          return doorId < count || ((doorId -= count), false);
        });
        const gm = w.gms[gmId];
        const door = gm.doors[doorId];

        const { seg, hull } = w.gmsData.byKey[gm.key].doorSegs[doorId];
        const { meta, roomIds } = door;

        const slideDirection = Array.isArray(meta.slideDirection)
          ? new Vect(...meta.slideDirection)
          : seg[1].clone().sub(seg[0]).normalize();

        return { gmId, doorId, seg, hull, roomIds, ...meta, slideDirection };
      },

      setOpen(instanceId: number, ratio: number) {
        const { inst, openDoorsRatio, slideData } = state;
        if (!inst || instanceId < 0 || instanceId >= openDoorsRatio.length) return;
        openDoorsRatio[instanceId] = ratio;

        inst.getMatrixAt(instanceId, tmpMat4);
        applyOpenRatio(slideData, instanceId, ratio, tmpMat4);
        inst.setMatrixAt(instanceId, tmpMat4);
        inst.instanceMatrix.needsUpdate = true;

        const isCollapse = slideData[instanceId * SD_STRIDE + SD_COLLAPSE];
        if (isCollapse) {
          state.collapseScales[instanceId] = 1 - ratio;
          (state.box.getAttribute("collapseScale") as THREE.BufferAttribute).needsUpdate = true;
        }
      },

      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        const n = w.gmsData.count.door;
        if (state.openDoorsRatio.length !== n) {
          state.openDoorsRatio = new Float32Array(n);
          state.slideData = new Float32Array(n * SD_STRIDE);
          state.collapseScales = new Float32Array(n).fill(1);
          state.box.setAttribute("collapseScale", new THREE.InstancedBufferAttribute(state.collapseScales, 1));
        }

        let instanceId = 0;
        for (const gm of w.gms) {
          const { key: gmKey, transform, determinant } = gm;
          tmpMat.setMatrixValue(transform);
          const doorSegs = w.gmsData.byKey[gmKey].doorSegs;

          for (let localId = 0; localId < doorSegs.length; localId++) {
            const door = doorSegs[localId];
            if (!("seg" in door)) continue; // stale HMR data
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

            const dx = tmpV2.x - tmpV1.x - 0.01; // fix z-fighting
            const dz = tmpV2.y - tmpV1.y; // Vect.y → world Z
            const len = tmpV1.distanceTo(tmpV2);
            const nx = len > 0 ? dx / len : 1;
            const nz = len > 0 ? dz / len : 0;
            const mx = (tmpV1.x + tmpV2.x) / 2;
            const mz = (tmpV1.y + tmpV2.y) / 2;
            const depth = hull ? hullPanelDepth : panelDepth;

            const connector = gm.doors[localId];
            const sd = connector?.meta?.slideDirection;

            const i = instanceId * SD_STRIDE;
            state.slideData[i + SD_MX] = mx;
            state.slideData[i + SD_MZ] = mz;
            if (Array.isArray(sd)) {
              tmpV1.set(sd[0], sd[1]);
              tmpMat.transformSansTranslate(tmpV1);
              state.slideData[i + SD_SLIDE_X] = tmpV1.x;
              state.slideData[i + SD_SLIDE_Z] = tmpV1.y;
            } else {
              state.slideData[i + SD_SLIDE_X] = nx;
              state.slideData[i + SD_SLIDE_Z] = nz;
            }
            state.slideData[i + SD_LEN] = len;
            state.slideData[i + SD_LEN_NX] = len * nx;
            state.slideData[i + SD_LEN_NZ] = len * nz;
            state.slideData[i + SD_COLLAPSE] = connector?.meta?.collapse ? 1 : 0;

            // x-axis along door width, y-axis up, z-axis along panel depth
            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );

            // restore existing open ratio (e.g. after map change)
            const r = state.openDoorsRatio[instanceId];
            if (r > 0) {
              applyOpenRatio(state.slideData, instanceId, r, tmpMat4);
              if (state.slideData[i + SD_COLLAPSE]) {
                state.collapseScales[instanceId] = 1 - r;
              }
            }

            inst.setMatrixAt(instanceId++, tmpMat4);
          }
        }

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
    }),
  );

  w.door = state;

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash, w.gms.length]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: "#fff", metalness: 0.8, roughness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ color: "#fff", metalness: 0.6, roughness: 0.3 });

    const { atlas, count } = createPanelAtlas();
    const frontOrBack = new THREE.MeshStandardNodeMaterial({
      metalness: 0.7,
      roughness: 0.25,
      side: THREE.DoubleSide,
      // 🔔 issues with walls and other doors
      transparent: false,
      depthWrite: true,
    });
    // crop U so texture doesn't deform when door width is scaled down
    // front (+z): anchored edge at u=0, crop to [0, scale]
    // back  (-z): anchored edge at u=1, crop to [1-scale, 1]
    const collapseUvScale = attribute("collapseScale", "float");
    const scaledU = uv().x.mul(collapseUvScale);
    const adjustedU = normalLocal.z.greaterThan(0).select(scaledU, scaledU.add(float(1).sub(collapseUvScale)));
    const adjustedUv = vec2(adjustedU, uv().y);
    const texNode = texture(atlas, adjustedUv);

    frontOrBack.colorNode = texNode.depth(instanceIndex.mod(int(count)));
    for (const mat of [edge, top, frontOrBack]) {
      mat.outputNode = withPickOutput(PICK_TYPE.door);
    }

    return [edge, edge, top, edge, frontOrBack, frontOrBack];
  }, []);

  return doorCount ? (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[state.box, undefined, doorCount]}
      material={materials}
      renderOrder={4}
    />
  ) : null;
}

/** Apply slide or collapse transform to the door matrix based on open ratio. */
function applyOpenRatio(slideData: Float32Array, instanceId: number, ratio: number, mat4: THREE.Matrix4) {
  const i = instanceId * SD_STRIDE;
  if (slideData[i + SD_COLLAPSE]) {
    const scale = 1 - ratio;
    mat4.elements[0] = slideData[i + SD_LEN_NX] * scale;
    mat4.elements[8] = slideData[i + SD_LEN_NZ] * scale;
    mat4.elements[12] = slideData[i + SD_MX] + (ratio * slideData[i + SD_LEN_NX]) / 2;
    mat4.elements[14] = slideData[i + SD_MZ] + (ratio * slideData[i + SD_LEN_NZ]) / 2;
  } else {
    const offset = ratio * slideData[i + SD_LEN];
    mat4.elements[12] = slideData[i + SD_MX] + offset * slideData[i + SD_SLIDE_X];
    mat4.elements[14] = slideData[i + SD_MZ] + offset * slideData[i + SD_SLIDE_Z];
  }
}

export type State = {
  box: THREE.BoxGeometry;
  collapseScales: Float32Array;
  inst: null | THREE.InstancedMesh;
  openDoorsRatio: Float32Array;
  slideData: Float32Array;
  decodeInstanceId: (instanceId: number) => {
    gmId: number;
    doorId: number;
    seg: [Geom.Vect, Geom.Vect];
    hull: boolean;
  };
  setOpen: (instanceId: number, ratio: number) => void;
  positionInstances: () => void;
};

// slideData layout: stride 8 per instance
const SD_STRIDE = 8;
const SD_MX = 0;
const SD_MZ = 1;
const SD_SLIDE_X = 2;
const SD_SLIDE_Z = 3;
const SD_LEN = 4;
const SD_LEN_NX = 5;
const SD_LEN_NZ = 6;
const SD_COLLAPSE = 7;

const doorHeight = 2 - 0.001; // fix ceiling z-fighting
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
