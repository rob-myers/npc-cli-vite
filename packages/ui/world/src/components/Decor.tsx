import { type DecorManifest, DecorManifestSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { useStateRef } from "@npc-cli/util";
import { fetchParsed } from "@npc-cli/util/fetch-parsed";
import { Mat } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import * as THREE from "three/webgpu";
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

      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),
      images: {} as Record<string, HTMLImageElement>,
      imgKeys: [] as string[],
      manifest: null as DecorManifest | null,

      async draw() {
        if (state.imgKeys.length === 0) return;
        const { ct } = w.texDecor;

        w.texDecor.resize({
          numTextures: state.imgKeys.length,
          width: decorTexSize,
          height: decorTexSize,
        });

        for (let i = 0; i < state.imgKeys.length; i++) {
          const img = state.images[state.imgKeys[i]];
          if (!img) continue;
          ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
          ct.save();
          ct.translate(0, decorTexSize);
          ct.scale(1, -1);
          ct.drawImage(img, 0, 0, decorTexSize, decorTexSize);
          ct.restore();
          w.texDecor.updateIndex(i);
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
        state.box.getAttribute("uvTextureIds").needsUpdate = true;
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
              mat4.premultiply(rotMat); // premultiply means post-rotate
            }

            inst.setMatrixAt(id, mat4);
            inst.setColorAt(id, tmpColor.set("#ffffff"));
            const texId = state.imgKeys.indexOf(meta.img);
            state.uvTextureIds[id] = Math.max(0, texId);
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
  const imagesQuery = useQuery({
    queryKey: [...w.worldQueryPrefix, "decor-images", manifest ? "loaded" : "pending"],
    async queryFn() {
      if (!manifest) return {};
      const images: Record<string, HTMLImageElement> = {};
      for (const entry of Object.values(manifest.byKey)) {
        try {
          images[entry.key] = await loadImage(`/decor/${entry.filename}`);
        } catch {
          warn(`failed to load decor image: ${entry.filename}`);
        }
      }
      return images;
    },
    enabled: !!manifest,
  });
  state.manifest = manifest ?? state.manifest;
  state.images = imagesQuery.data ?? state.images;
  state.imgKeys = Object.keys(state.images);
  const decorQuadCount = w.gms.reduce((sum, gm) => sum + gm.decor.filter((d) => d.type === "quad").length, 0);

  const { mutateAsync: updateDecor } = useMutation({
    mutationKey: [...w.worldQueryPrefix, "update-decor"],
    async mutationFn() {
      await state.draw();
      await pause(100);
      // 🚧 add decor to grid computing gmRoomId, gmDoorId
      await state.transformDecorQuads();
      await pause(100);
      state.sendDataToGpu();
      state.everUpdated = true;
    },
  });

  React.useEffect(() => {
    if (decorQuadCount === 0 || state.imgKeys.length === 0) return;
    (async () => {
      if (!w.hash || w.pending.nav) return; // wait for nav
      w.setNextPending({ decor: true });
      await updateDecor();
      w.setNextPending({ decor: false });
    })();
  }, [w.mapKey, w.hash, state.imgKeys.length, w.pending.nav]);

  const materials = useMemo(() => {
    const uvTexIds = attribute("uvTextureIds", "float");
    const texNode = texture(w.texDecor.tex, uv());
    texNode.depthNode = uvTexIds;

    const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    texMat.colorNode = texNode;
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
  uvTextureIds: Uint32Array;
  images: Record<string, HTMLImageElement>;
  imgKeys: string[];
  manifest: DecorManifest | null;
  decodeInstanceId(instanceId: number): { gmId: number; meta: Meta } | null;
  transformDecorQuads(): Promise<void>;
  draw(): Promise<void>;
  sendDataToGpu(): void;
};

const cuboidHeight = 0.05;
const decorTexSize = 64;
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const plainBlackMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, color: "#000" });
