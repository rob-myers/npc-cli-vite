import { useStateRef } from "@npc-cli/util";
import { Mat, Poly, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { attribute, instanceIndex, int, texture, uv } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_GEOMORPH_INSTANCES } from "../const";
import { createTwoSidedXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { drawFloorGrid, drawLightsIntoTexture, drawRoomOutlines, worldToCanvas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createTwoSidedXzQuad(),
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

        // - most aspects only depend on uninstantiated geomorph `layout`
        // - however lights depend on instantiated decor (with gmRoomId)
        const gm = w.gms[gmId];
        const gmKey = gm?.key;
        const layout = w.assets.layout[gmKey];
        if (!layout) return;

        ct.resetTransform();
        ct.globalCompositeOperation = "source-over";
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        // biome-ignore format: succinct
        ct.setTransform( worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);

        // try inset by half hull doorway to avoid adjacent doorway overlap
        const hullFloor = geomService.createInset(layout.hullPoly.map((x) => x.clone().removeHoles())[0], 0.08);
        drawPolygons(ct, hullFloor, { fillStyle: w.getTheme().floor.hullFill, strokeStyle: null });

        // wall bases
        drawPolygons(ct, layout.walls, { fillStyle: "#000", strokeStyle: "#333", lineWidth: 0.05 });

        // room outlines
        drawRoomOutlines(ct, layout, w.getTheme().floor);

        // draw nav mesh (gmId specific)
        ct.lineJoin = "round";
        ct.lineWidth = 0.01;
        const fillStyle = "#ffd1";
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

        // door shadow
        for (const door of layout.doors) {
          ct.lineWidth = door.meta.hull ? 0.225 : 0.125;
          tmpPoly.outline = door.seg;
          ct.lineJoin = "miter";
          drawPolygons(ct, tmpPoly, { fillStyle: null, strokeStyle: "#000a" });
        }

        // light circles
        drawLightsIntoTexture(ct, gm);

        // obstacle drop shadows
        drawPolygons(
          ct,
          Poly.union(
            layout.obstacles.flatMap((x) =>
              x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
            ),
          ),
          { fillStyle: "#0006", strokeStyle: null },
        );

        if (w.debug?.gridShown) {
          ct.save();
          drawPolygons(ct, hullFloor, { clip: true, fillStyle: "#fff0", strokeStyle: null });
          drawFloorGrid(ct, gm.bounds, gm.gridRect);
          ct.restore();
        }
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
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return {
      texNode: texNode.depth(instanceIndex),
      // - force alpha 1 to avoid object-pick having rgb scaled by alpha
      // - can pick texture alpha < 1 because floor can be partially transparent
      outputNode: w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.floor, 1),
      uid: generateUUID(),
    };
  }, [w.texFloor.hash]);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    // render initially or once decor has gmRoomIds
    (w.decor.ready || !w.isReady()) && state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData, w.themeKey, w.decor.ready]);

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
        side={THREE.FrontSide} // one draw call
        transparent
        alphaTest={0.01}
        colorNode={shaderMeta.texNode}
        outputNode={shaderMeta.outputNode}
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
const tmpPoly = new Poly();
