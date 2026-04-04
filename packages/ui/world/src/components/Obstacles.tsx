import { useStateRef } from "@npc-cli/util";
import { Mat } from "@npc-cli/util/geom";
import { warn } from "@npc-cli/util/legacy/generic";
import React from "react";
import * as THREE from "three";
import { MAX_OBSTACLE_QUAD_INSTANCES } from "../const";
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

        let uvOffsetIdx = 0,
          uvDimIdx = 0,
          uvTexIdIdx = 0;

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
            const { x: subX, y: subY, width: subW, height: subH } = origSubRect;

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
      positionObstacles() {
        const { inst: obsInst } = state;
        let oId = 0;

        state.inst?.instanceMatrix.array.fill(0);

        w.gms.forEach(({ obstacles, transform: { a, b, c, d, e, f } }) => {
          obstacles.forEach((o) => {
            const mat4 = state.createObstacleMatrix4([a, b, c, d, e, f], o);
            obsInst.setColorAt(oId, tmpColor.set(o.meta.color ?? "red"));
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

  React.useEffect(() => {
    state.addUvs();
    state.positionObstacles();
  }, [w.mapKey, w.hash, w.gmsData.count.obstacles]);

  return (
    <instancedMesh
      name="obstacles"
      // key={`${[w.mapKey, w.hash]}`}
      ref={state.ref("inst")}
      args={[state.quad, undefined, MAX_OBSTACLE_QUAD_INSTANCES]}
      frustumCulled={false}
      position={[0, 0.001, 0]} // 🚧
      renderOrder={0}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
        <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.uvTextureIds, 1]} />
      </bufferGeometry>

      {/* 🚧 */}
      <meshStandardMaterial color="red" side={THREE.DoubleSide} />
      {/* <instancedAtlasMaterial
        side={THREE.DoubleSide}
        transparent
        atlas={w.texObs.tex}
        diffuse={[0.28, 0.28, 0.3]}
        objectPickRed={6}
        alphaTest={0.5}
      /> */}
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
  createObstacleMatrix4: (gmTransform: Geom.SixTuple, obstacle: Geomorph.LayoutObstacle) => THREE.Matrix4;
  decodeInstanceId: (instanceId: number) => Meta<{ gmId: number }>;
  positionObstacles: () => void;
};

const tmpMat1 = new Mat();
const tmpMatFour1 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
