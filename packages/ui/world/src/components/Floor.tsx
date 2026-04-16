import { geomService, Mat, Poly, useStateRef, Vect } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import { instanceIndex } from "three/src/nodes/core/IndexNode.js";
import { int } from "three/src/nodes/tsl/TSLCore.js";
import * as THREE from "three/webgpu";
import { MAX_GEOMORPH_INSTANCES } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { PICK_TYPE, withPickOutput } from "../service/pick";
import { drawRoomOutlines, worldToCanvas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createXzQuad(),

      uvOffsets: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),

      addUvs() {
        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);

        for (const [gmId, gm] of w.gms.entries()) {
          // geomorph 301 pngRect height/width ~ 0.5 but not equal
          (uvDimensions.array as Float32Array)[gmId * 2 + 0] = 1;
          (uvDimensions.array as Float32Array)[gmId * 2 + 1] = isEdgeGm(gm.key)
            ? gm.bounds.height / gm.bounds.width
            : 1;
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
      },

      async draw() {
        // one texture per gmId = texId (nav tris can change near hull doors)
        for (const [gmId] of w.gms.entries()) {
          state.drawGm(gmId);
          w.texFloor.updateIndex(gmId);
          await pause();
        }
      },

      drawGm(gmId) {
        const { ct } = w.texFloor;
        // get untransformed layout i.e. not an instance
        const gmKey = w.gms[gmId]?.key;
        const layout = w.assets.layout[gmKey];
        if (!layout) return;

        ct.resetTransform();
        ct.globalCompositeOperation = "source-over";
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        // biome-ignore format: succinct
        ct.setTransform( worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);

        // try inset by half hull doorway to avoid adjacent doorway overlap
        const hullFloor = geomService.createInset(layout.hullPoly.map((x) => x.clone().removeHoles())[0], 0.08);
        drawPolygons(ct, hullFloor, { fillStyle: "#222", strokeStyle: null });

        // wall bases
        drawPolygons(ct, layout.walls, { fillStyle: "#000", strokeStyle: "#333", lineWidth: 0.05 });

        // obstacle drop shadows
        const shadowPolys = Poly.union(
          layout.obstacles.flatMap((x) =>
            x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
          ),
        );
        drawPolygons(ct, shadowPolys, { fillStyle: "#0004", strokeStyle: null });

        // room outlines
        drawRoomOutlines(ct, layout);

        // draw nav mesh (gmId specific)
        ct.lineJoin = "round";
        ct.lineWidth = 0.01;
        const fillStyle = "#fff1";
        const strokeStyle = w.getTheme().floor.navStroke;
        const triangle = new Poly([new Vect(), new Vect(), new Vect()]);
        (w.nav?.toNavTris[gmId] ?? []).forEach(([positions]) => {
          for (let i = 0; i < positions.length; i += 9) {
            triangle.outline[0].set(positions[i], positions[i + 2]);
            triangle.outline[1].set(positions[i + 3], positions[i + 5]);
            triangle.outline[2].set(positions[i + 6], positions[i + 8]);
            drawPolygons(ct, [triangle], { fillStyle, strokeStyle });
          }
        });
      },

      transformInstances() {
        if (!state.inst) return;
        for (const [gmId, gm] of w.gms.entries()) {
          const mat = new Mat({
            a: gm.bounds.width,
            b: 0,
            c: 0,
            d: gm.bounds.height,
            e: gm.bounds.x,
            f: gm.bounds.y,
          }).postMultiply(gm.matrix);
          state.inst.setMatrixAt(gmId, embedXZMat4(mat));
          // state.inst.setMatrixAt(gmId, embedXZMat4(mat, { yHeight: gmId * 1 }));
        }
        state.inst.instanceMatrix.needsUpdate = true;
        state.inst.computeBoundingSphere();
      },
    }),
  );

  w.floor = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texFloor;
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return { texNode: texNode.depth(instanceIndex), pickNode: withPickOutput(PICK_TYPE.floor), uid: generateUUID() };
  }, [w.texFloor.hash]);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData, w.themeKey]);

  return (
    <instancedMesh
      name="floor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_GEOMORPH_INSTANCES]}
      renderOrder={-3}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        key={shaderMeta.uid}
        side={THREE.DoubleSide}
        transparent
        alphaTest={0.8}
        colorNode={shaderMeta.texNode}
        outputNode={shaderMeta.pickNode}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  addUvs(): void;
  draw(): Promise<void>;
  drawGm(gmId: number): void;
  transformInstances(): void;
};

const tmpMat1 = new Mat();
