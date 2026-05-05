import { type DecorManifest, DecorManifestSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { Mat } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import * as THREE from "three/webgpu";
import type { DecorSheetEntry } from "../assets.schema";
import { MAX_DECOR_QUAD_INSTANCES, sguToWorldScale } from "../const";
import { createUnitBox, embedXZMat4, getRotAxisMatrix, setRotMatrixAboutPoint } from "../service/geometry";
import { PICK_TYPE } from "../service/pick";
import { WorldContext } from "./world-context";

export default function Decor(_props: Props) {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null as any,
      everUpdated: false,

      box: createUnitBox(),

      uvOffsets: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),
      images: [] as HTMLImageElement[],
      manifest: null as DecorManifest | null,

      addUvs() {
        if (!w.sheets?.decor) return;

        state.uvOffsets.fill(0);
        state.uvDimensions.fill(0);
        state.uvTextureIds.fill(0);

        let idx = 0;

        for (const gm of w.gms) {
          for (const item of gm.decor) {
            if (item.type !== "quad") continue;
            const entry = w.sheets.decor[item.meta.img] as DecorSheetEntry | undefined;
            if (!entry) {
              warn(`decor "${item.meta.img}" not found in sheets.json`);
              idx++;
              continue;
            }
            const { sheetId, rect } = entry;
            const dims = w.sheets.decorSheetDims?.[sheetId];
            if (!dims) continue;

            state.uvOffsets.set([rect.x / dims.width, rect.y / dims.height], idx * 2);
            state.uvDimensions.set([rect.width / dims.width, rect.height / dims.height], idx * 2);
            state.uvTextureIds[idx] = sheetId;
            idx++;
          }
        }
      },

      async draw() {
        if (!w.sheets?.decorSheetDims || state.images.length === 0) return;
        const { ct } = w.texDecor;
        const { maxDecorSheetDim, decorSheetDims } = w.sheets;
        if (!maxDecorSheetDim || !decorSheetDims) return;

        w.texDecor.resize({
          numTextures: decorSheetDims.length,
          width: maxDecorSheetDim.width,
          height: maxDecorSheetDim.height,
        });
        for (let sheetId = 0; sheetId < state.images.length; sheetId++) {
          ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
          ct.drawImage(state.images[sheetId], 0, 0);
          w.texDecor.updateIndex(sheetId);
        }
      },
      decodeInstanceId(instanceId: number) {
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
      sendDataToGpu() {
        const geo = state.inst?.geometry;
        if (geo) {
          geo.getAttribute("uvOffsets").needsUpdate = true;
          geo.getAttribute("uvDimensions").needsUpdate = true;
          geo.getAttribute("uvTextureIds").needsUpdate = true;
        }
        if (state.inst) state.inst.instanceMatrix.needsUpdate = true;
        if (state.inst?.instanceColor) state.inst.instanceColor.needsUpdate = true;
      },
      async transformDecorQuads() {
        const { inst, manifest } = state;
        if (!inst || !manifest) return;
        inst.instanceMatrix.array.fill(0);
        let id = 0;

        for (const gm of w.gms) {
          const { a, b, c, d, e, f } = gm.transform;

          for (const item of gm.decor) {
            if (item.type !== "quad") continue;
            const { transform: quadTransform, meta } = item;

            const entry = manifest.byKey[meta.img];
            const imgW = (entry?.width ?? 1) * sguToWorldScale;
            const imgH = (entry?.height ?? 1) * sguToWorldScale;

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

            inst.setMatrixAt(id, mat4);
            inst.setColorAt(id, tmpColor.set("#ffffff"));
            id++;
          }
        }

        inst.count = id;
        inst.computeBoundingSphere();
      },
    }),
  );

  w.decor = state;

  // 🚧 fetch manifest, sheets and draw in single query
  const manifest = useQuery({
    queryKey: [...w.worldQueryPrefix, "decor-manifest"],
    async queryFn() {
      return fetchParsed("/decor/manifest.json", DecorManifestSchema);
    },
  }).data;
  state.manifest = manifest ?? state.manifest;

  state.images =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "decor-sheet-images"],
      async queryFn() {
        const numSheets = w.sheets.decorSheetDims?.length ?? 0;
        const images: HTMLImageElement[] = [];
        for (let sheetId = 0; sheetId < numSheets; sheetId++) {
          images.push(await loadImage(`/sheet/decor.${sheetId}.png${getDevCacheBustQueryParam()}`));
        }
        return images;
      },
      enabled: !!w.sheets?.decorSheetDims,
    }).data ?? state.images;

  const decorQuadCount = w.gms.reduce((sum, gm) => sum + gm.decor.filter((d) => d.type === "quad").length, 0);

  const { mutateAsync: updateDecor } = useMutation({
    mutationKey: [...w.worldQueryPrefix, "update-decor"],
    async mutationFn() {
      state.addUvs();
      await state.draw();
      await pause(100);
      await state.transformDecorQuads();
      await pause(100);
      state.sendDataToGpu();
      state.everUpdated = true;
    },
  });

  React.useEffect(() => {
    if (decorQuadCount === 0 || state.images.length === 0 || !state.manifest) return;
    (async () => {
      if (!w.hash || w.pending.nav) return;
      w.setNextPending({ decor: true });
      await updateDecor();
      w.setNextPending({ decor: false });
    })();
  }, [w.mapKey, w.hash, state.images.length, w.pending.nav]);

  const materials = useMemo(() => {
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const uvTexIds = attribute("uvTextureIds", "float");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(w.texDecor.tex, transformedUv);
    texNode.depthNode = uvTexIds;

    const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    texMat.colorNode = texNode.mul(0.6);
    texMat.outputNode = w.view.withPickOutput(PICK_TYPE.decor);
    // +x, -x, +y, -y, +z, -z
    return [plainBlackMaterial, plainBlackMaterial, texMat, plainBlackMaterial, plainBlackMaterial, plainBlackMaterial];
  }, [w.texDecor.hash]);

  return (
    <instancedMesh
      name="decor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_DECOR_QUAD_INSTANCES]}
      frustumCulled={false}
      renderOrder={-2}
      material={materials}
      visible={state.everUpdated}
    >
      <bufferGeometry attributes={state.box.attributes} index={state.box.index} groups={state.box.groups}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
        <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.uvTextureIds, 1]} />
      </bufferGeometry>
    </instancedMesh>
  );
}

type Props = {
  disabled?: boolean;
};

export type State = {
  inst: THREE.InstancedMesh;
  everUpdated: boolean;
  box: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  images: HTMLImageElement[];
  manifest: DecorManifest | null;
  addUvs(): void;
  decodeInstanceId(instanceId: number): { gmId: number; meta: Meta } | null;
  transformDecorQuads(): Promise<void>;
  draw(): Promise<void>;
  sendDataToGpu(): void;
};

const cuboidHeight = 0.05;
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const plainBlackMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, color: "#000" });
