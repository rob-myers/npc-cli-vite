import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { Mat } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { attribute, texture, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { DecorSheetEntry } from "../assets.schema";
import { MAX_DECOR_QUAD_INSTANCES, sguToWorldScale } from "../const";
import { createUnitBox, embedXZMat4, getRotAxisMatrix, setRotMatrixAboutPoint } from "../service/geometry";
import { PICK_TYPE } from "../service/pick";
import { WorldContext } from "./world-context";

export default function Decor() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null as any,

      box: createUnitBox(),
      materials: [],

      uvOffsets: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),

      decodeInstanceId(instanceId) {
        let id = instanceId;
        for (const gm of w.gms) {
          const quads = gm.decor.filter((d) => d.type === "quad");
          if (id < quads.length) {
            return { gmId: gm.gmId, meta: quads[id].meta };
          }
          id -= quads.length;
        }
        return null;
      },
    }),
  );

  w.decor = state;

  const { data } = useQuery({
    queryKey: ["decor-setup", w.mapKey, w.gmsHash, w.texDecor.hash, import.meta.hot?.data.__LAST_HMR_DECOR__],
    async queryFn() {
      if (import.meta.hot?.data.__JUST_HMR_DECOR__) {
        import.meta.hot.data.__JUST_HMR_DECOR__ = false;
        return null; // ignore 1st stale invoke after HMR
      }

      if (!w.sheets) return null;
      const { decor, decorSheetDims, maxDecorSheetDim } = w.sheets;
      w.setNextPending({ decor: true });

      // 1. load sheet images
      const images = await Promise.all(
        Array.from({ length: decorSheetDims.length }, (_, i) =>
          loadImage(`/sheet/decor.${i}.png${getDevCacheBustQueryParam()}`),
        ),
      );

      // 2. draw sheets into texture array
      const { ct } = w.texDecor;
      w.texDecor.resize({
        numTextures: decorSheetDims.length,
        width: maxDecorSheetDim.width,
        height: maxDecorSheetDim.height,
        force: true, // else texture blank on save const.ts
      });
      for (let sheetId = 0; sheetId < images.length; sheetId++) {
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        ct.drawImage(images[sheetId], 0, 0);
        w.texDecor.updateIndex(sheetId);
      }

      // 3. compute UVs
      state.uvOffsets.fill(0);
      state.uvDimensions.fill(0);
      state.uvTextureIds.fill(0);
      let uvIdx = 0;
      for (const gm of w.gms) {
        for (const item of gm.decor) {
          if (item.type !== "quad") continue;
          const entry = decor[item.meta.img] as DecorSheetEntry | undefined;
          if (!entry) {
            warn(`decor "${item.meta.img}" not found in sheets.json`);
            uvIdx++;
            continue;
          }
          const dims = decorSheetDims[entry.sheetId];
          if (!dims) continue;
          state.uvOffsets.set([entry.rect.x / dims.width, entry.rect.y / dims.height], uvIdx * 2);
          state.uvDimensions.set([entry.rect.width / dims.width, entry.rect.height / dims.height], uvIdx * 2);
          state.uvTextureIds[uvIdx] = entry.sheetId;
          uvIdx++;
        }
      }

      await pause(100);

      // 4. transform and position instances
      if (!state.inst) return null;
      state.inst.instanceMatrix.array.fill(0);
      let id = 0;
      for (const gm of w.gms) {
        const { a, b, c, d, e, f } = gm.transform;
        for (const item of gm.decor) {
          if (item.type !== "quad") continue;
          const { transform: quadTransform, meta } = item;
          const entry = decor[meta.img];
          const imgW = (entry.originalWidth ?? 1) * sguToWorldScale;
          const imgH = (entry.originalHeight ?? 1) * sguToWorldScale;

          tmpMat.feedFromArray([imgW, 0, 0, imgH, 0, 0]);
          tmpMat.postMultiply(quadTransform);
          tmpMat.postMultiply([a, b, c, d, e, f]);

          const mat4 = embedXZMat4(tmpMat, { yScale: cuboidHeight, yHeight: meta.y ?? 0, mat4: tmpMat4 });

          if (item.meta.tilt === true) {
            const [a, b, c, d] = item.transform;
            const det = a * d - b * c;
            const rotMat = getRotAxisMatrix(a, 0, b, (det > 0 ? 1 : -1) * 90);
            setRotMatrixAboutPoint(rotMat, item.topCenter.x, item.meta.y, item.topCenter.y);
            mat4.premultiply(rotMat);
          }

          state.inst.setMatrixAt(id, mat4);
          state.inst.setColorAt(id, tmpColor.set("#ffffff"));
          id++;
        }
      }
      state.inst.count = id;
      state.inst.computeBoundingSphere();

      await pause(100);

      // 5. send to GPU
      const geo = state.inst.geometry;
      geo.getAttribute("uvOffsets").needsUpdate = true;
      geo.getAttribute("uvDimensions").needsUpdate = true;
      geo.getAttribute("uvTextureIds").needsUpdate = true;
      state.inst.instanceMatrix.needsUpdate = true;
      if (state.inst.instanceColor) state.inst.instanceColor.needsUpdate = true;

      // 6. build materials
      const uvDims = attribute("uvDimensions", "vec2");
      const uvOffs = attribute("uvOffsets", "vec2");
      const uvTexIds = attribute("uvTextureIds", "uint");
      // flip V: DataArrayTexture data is top-to-bottom but BoxGeometry +Y face has v=0 at bottom
      const flippedUv = vec2(uv().x, uv().y.oneMinus());
      const transformedUv = flippedUv.mul(uvDims).add(uvOffs);
      const texNode = texture(w.texDecor.tex, transformedUv);
      texNode.depthNode = uvTexIds;

      const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
      texMat.colorNode = texNode.mul(0.6);
      texMat.outputNode = w.view.withPickOutput(PICK_TYPE.decor);

      w.setNextPending({ decor: false });

      return [
        plainBlackMaterial,
        plainBlackMaterial,
        texMat,
        plainBlackMaterial,
        plainBlackMaterial,
        plainBlackMaterial,
      ];
    },
    enabled: !!w.hash && !!w.sheets && !w.pending.nav && w.gms.length > 0,
    staleTime: 0,
  });

  state.materials = data ?? state.materials;

  return (
    <instancedMesh
      name="decor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_DECOR_QUAD_INSTANCES]}
      frustumCulled={false}
      renderOrder={-2}
      material={state.materials}
      visible={state.materials.length > 0}
    >
      <bufferGeometry attributes={state.box.attributes} index={state.box.index} groups={state.box.groups}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
        <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.uvTextureIds, 1]} />
      </bufferGeometry>
    </instancedMesh>
  );
}

export type State = {
  inst: THREE.InstancedMesh;
  box: THREE.BufferGeometry;
  materials: THREE.MeshStandardNodeMaterial[];
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  decodeInstanceId(instanceId: number): { gmId: number; meta: Meta } | null;
};

const cuboidHeight = 0.05;
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const plainBlackMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, color: "#000" });

import.meta.hot?.on("vite:beforeUpdate", (foo) => {
  const updatedThisFile = foo.updates.some((update) => update.path.endsWith("Decor.tsx"));
  if (import.meta.hot && updatedThisFile) {
    // used to ignore stale queryFn and trigger fresh one
    import.meta.hot.data.__JUST_HMR_DECOR__ = true;
    import.meta.hot.data.__LAST_HMR_DECOR__ = Date.now();
  }
});
