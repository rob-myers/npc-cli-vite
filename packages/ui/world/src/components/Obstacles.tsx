import { sguScaleSvgToPngFactor } from "@npc-cli/media/starship-symbol";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { Mat } from "@npc-cli/util/geom";
import { invertCanvas } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import React, { useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import { instanceIndex } from "three/src/nodes/core/IndexNode.js";
import { int } from "three/src/nodes/tsl/TSLCore.js";
import * as THREE from "three/webgpu";
import { MAX_OBSTACLE_QUAD_INSTANCES, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function Obstacles(_props: Props) {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...({} as Pick<State, "inst">),

      quad: createXzQuad(),

      /** itemSize 2 */
      uvOffsets: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      /** itemSize 2 */
      uvDimensions: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      /** itemSize 1 */
      uvTextureIds: new Uint32Array(MAX_OBSTACLE_QUAD_INSTANCES),

      addUvs() {
        if (!w.sheets) return;

        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);
        const uvTextureIds = state.quad.getAttribute("uvTextureIds");
        (uvTextureIds.array as Uint32Array).fill(0);

        let [uvOffsetIdx, uvDimIdx, uvTexIdIdx] = [0, 0, 0];

        const worldToPngScale = worldToSguScale * sguScaleSvgToPngFactor;

        // aligned to transforms
        for (const [_gmId, { obstacles }] of w.gms.entries()) {
          for (const { symbolKey, origSubRect, obstacleId: _obstacleId } of obstacles) {
            // lookup (sheetId, offset) of symbolKey
            // use origSubRect
            const entry = w.sheets.symbol[symbolKey]!;
            if (!entry) {
              warn(`${symbolKey} not found in sheets.json`);
              uvOffsetIdx++;
              uvDimIdx++;
              uvTexIdIdx++;
              continue;
            }
            const {
              sheetId,
              rect: { x: symbolX, y: symbolY },
            } = entry;
            // origSubRect is in world units, sheet is in png pixel units
            const subX = origSubRect.x * worldToPngScale;
            const subY = origSubRect.y * worldToPngScale;
            const subW = origSubRect.width * worldToPngScale;
            const subH = origSubRect.height * worldToPngScale;

            const { width: sheetWidth, height: sheetHeight } = w.sheets.symbolSheetDims[sheetId];
            const uvOffsetX = (symbolX + subX) / sheetWidth;
            const uvOffsetY = (symbolY + subY) / sheetHeight;
            const uvDimW = subW / sheetWidth;
            const uvDimH = subH / sheetHeight;

            uvOffsets.array.set([uvOffsetX, uvOffsetY], uvOffsetIdx++ * 2);
            uvDimensions.array.set([uvDimW, uvDimH], uvDimIdx++ * 2);
            uvTextureIds.array[uvTexIdIdx++] = sheetId;
          }
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
        uvTextureIds.needsUpdate = true;
      },

      async draw() {
        if (!w.sheets) return;
        const { ct } = w.texObs;
        const { maxSymbolSheetDim, symbolSheetDims } = w.sheets;

        // resize texObs to match sheet dimensions
        w.texObs.resize({
          numTextures: symbolSheetDims.length,
          width: maxSymbolSheetDim.width,
          height: maxSymbolSheetDim.height,
        });

        for (let sheetId = 0; sheetId < symbolSheetDims.length; sheetId++) {
          const img = new Image();
          img.src = `/sheet/symbols.${sheetId}.png${getDevCacheBustQueryParam()}`;
          await new Promise<void>((resolve) => {
            img.onload = () => {
              ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
              ct.drawImage(img, 0, 0);
              invertCanvas(ct.canvas, copyCtxt, maskCtxt);
              w.texObs.updateIndex(sheetId);
              resolve();
            };
          });
          await pause();
        }
      },

      createObstacleMatrix4(gmTransform, { origPoly: { rect }, transform: { a, b, c, d, e, f }, height }) {
        const [mat, mat4] = [tmpMat1, tmpMatFour1];
        // transform unit (XZ) square into `rect`, then apply `transform` followed by `gmTransform`
        mat.feedFromArray([rect.width, 0, 0, rect.height, rect.x, rect.y]);
        mat.postMultiply([a, b, c, d, e, f]).postMultiply(gmTransform);
        return embedXZMat4(mat, { mat4, yHeight: height });
      },
      decodeInstanceId(instanceId) {
        let id = instanceId;
        const gmId = w.gms.findIndex((gm) => id < gm.obstacles.length || ((id -= gm.obstacles.length), false));
        const gm = w.gms[gmId];
        const obstacle = gm.obstacles[id];
        return {
          gmId,
          ...obstacle.meta,
          height: obstacle.height,
        };
      },
      transformAndColorObstacles() {
        const { inst: obsInst } = state;
        let oId = 0;

        if (!obsInst) return;
        obsInst.instanceMatrix.array.fill(0);

        w.gms.forEach(({ obstacles, transform: { a, b, c, d, e, f } }) => {
          obstacles.forEach((o) => {
            const mat4 = state.createObstacleMatrix4([a, b, c, d, e, f], o);
            obsInst.setColorAt(oId, tmpColor.set(o.meta.color ?? "white"));
            obsInst.setMatrixAt(oId, mat4);
            oId++;
          });
        });

        obsInst.instanceMatrix.needsUpdate = true;
        if (obsInst.instanceColor !== null) {
          obsInst.instanceColor.needsUpdate = true;
        }
        obsInst.computeBoundingSphere();
      },
    }),
  );

  w.obs = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texObs;
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const uvTexIds = attribute("uvTextureIds", "float");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return { texNode: texNode.depth(uvTexIds), uid: generateUUID() };
  }, [w.texObs.hash]);

  React.useEffect(() => {
    state.addUvs();
    state.transformAndColorObstacles();
    state.draw().then(() => w.update());
  }, [w.mapKey, w.hash, w.gmsData.count.obstacles]);

  return (
    <instancedMesh
      name="obstacles"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_OBSTACLE_QUAD_INSTANCES]}
      frustumCulled={false}
      position={[0, 0.001, 0]} // 🚧
      renderOrder={-3}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
        <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.uvTextureIds, 1]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        key={shaderMeta.uid}
        side={THREE.DoubleSide}
        transparent
        alphaTest={0.5}
        colorNode={shaderMeta.texNode}
      />
    </instancedMesh>
  );
}

type Props = {
  disabled?: boolean;
};

export type State = {
  inst: THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  addUvs: () => void;
  draw: () => Promise<void>;
  createObstacleMatrix4: (gmTransform: Geom.SixTuple, obstacle: Geomorph.LayoutObstacle) => THREE.Matrix4;
  decodeInstanceId: (instanceId: number) => Meta<{ gmId: number }>;
  transformAndColorObstacles: () => void;
};

const tmpMat1 = new Mat();
const tmpMatFour1 = new THREE.Matrix4();
const tmpColor = new THREE.Color();

const copyCanvas = document.createElement("canvas");
const copyCtxt = copyCanvas.getContext("2d") as CanvasRenderingContext2D;
const maskCanvas = document.createElement("canvas");
const maskCtxt = maskCanvas.getContext("2d") as CanvasRenderingContext2D;
