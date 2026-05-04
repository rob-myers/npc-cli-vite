import { useStateRef } from "@npc-cli/util";
import { fetchParsed } from "@npc-cli/util/fetch-parsed";
import { Mat } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import { color, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import z from "zod";
import { MAX_DECOR_QUAD_INSTANCES, sguToWorldScale } from "../const";
import { createUnitBox, embedXZMat4 } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function Decor(_props: Props) {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...({} as Pick<State, "inst">),

      box: createUnitBox(),

      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),
      images: {} as Record<string, HTMLImageElement>,
      imgKeys: [] as string[],
      manifest: null as DecorManifest | null,

      transformDecorQuads() {
        if (!state.inst || !state.manifest) return;
        const { inst, manifest } = state;
        inst.instanceMatrix.array.fill(0);

        let id = 0;

        w.gms.forEach(({ decor, transform: { a, b, c, d, e, f } }) => {
          for (const item of decor) {
            if (item.type !== "quad") continue;
            const { transform: quadTransform, meta } = item;

            const entry = manifest.byKey[meta.img];
            const imgW = (entry?.width ?? 1) * sguToWorldScale;
            const imgH = (entry?.height ?? 1) * sguToWorldScale;

            tmpMat.feedFromArray([imgW, 0, 0, imgH, 0, 0]);
            tmpMat.postMultiply(quadTransform);
            tmpMat.postMultiply([a, b, c, d, e, f]);
            inst.setMatrixAt(id, embedXZMat4(tmpMat, { yScale: cuboidHeight, yHeight: meta.y ?? 0, mat4: tmpMat4 }));
            inst.setColorAt(id, tmpColor.set("#cc0000"));

            const texId = state.imgKeys.indexOf(meta.img);
            state.uvTextureIds[id] = Math.max(0, texId);

            id++;
          }
        });

        inst.count = id;
        inst.computeBoundingSphere();
      },

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

      sendDataToGpu() {
        state.box.getAttribute("uvTextureIds").needsUpdate = true;
        if (state.inst) state.inst.instanceMatrix.needsUpdate = true;
        if (state.inst?.instanceColor) state.inst.instanceColor.needsUpdate = true;
      },
    }),
  );

  w.decor = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texDecor;
    const uvTexIds = attribute("uvTextureIds", "float");
    const transformedUv = uv();
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = uvTexIds;
    return {
      texNode,
      uid: generateUUID(),
    };
  }, [w.texDecor.hash]);

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

  React.useEffect(() => {
    if (decorQuadCount === 0 || state.imgKeys.length === 0) return;

    state.transformDecorQuads();
    state.draw().then(async () => {
      await pause(60);
      state.sendDataToGpu();
      w.update();
    });
  }, [w.mapKey, w.hash, decorQuadCount, state.imgKeys.length]);

  const redMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    mat.colorNode = vec4(color("#cc0000"), 1);
    return mat;
  }, []);

  const materials = useMemo(() => {
    const texMat = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
    });
    texMat.colorNode = shaderMeta.texNode;
    // +x, -x, +y, -y, +z, -z
    return [redMaterial, redMaterial, texMat, redMaterial, redMaterial, redMaterial];
  }, [redMaterial, shaderMeta.uid]);

  if (decorQuadCount === 0) return null;

  return (
    <instancedMesh
      name="decor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_DECOR_QUAD_INSTANCES]}
      frustumCulled={false}
      renderOrder={-2}
      material={materials}
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
  box: THREE.BufferGeometry;
  uvTextureIds: Uint32Array;
  images: Record<string, HTMLImageElement>;
  imgKeys: string[];
  manifest: DecorManifest | null;
  transformDecorQuads(): void;
  draw(): Promise<void>;
  sendDataToGpu(): void;
};

const cuboidHeight = 0.05;
const decorTexSize = 64;
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();

type DecorManifest = z.infer<typeof DecorManifestSchema>;

const DecorManifestSchema = z.object({
  byKey: z.record(
    z.string(),
    z.object({
      key: z.string(),
      filename: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  ),
});
