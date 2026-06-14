import { sguScaleSvgToPngFactor } from "@npc-cli/media/starship-symbol";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { geomService, Mat, Vect } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import {
  attribute,
  cameraPosition,
  color,
  Fn,
  float,
  instanceIndex,
  int,
  mix,
  normalWorld,
  positionWorld,
  texture,
  uniformArray,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { StarShipSymbolSheetEntry } from "../assets.schema";
import { MAX_OBSTACLE_QUAD_INSTANCES, MAX_OBSTACLE_SKIRT_INSTANCES, worldToSguScale } from "../const";
import { createXyQuad, createXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { getLightMetas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Obstacles(_props: Props) {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...({} as Pick<State, "inst" | "skirtInst">),

      quad: createXzQuad(),
      skirtQuad: createXyQuad(),

      uvOffsets: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_OBSTACLE_QUAD_INSTANCES),
      images: [] as HTMLImageElement[],

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
            const entry = w.sheets.symbol[symbolKey] as StarShipSymbolSheetEntry;
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
      },
      async draw() {
        if (!w.sheets || state.images.length === 0) return;
        const { ct } = w.texObs;
        const { maxSymbolSheetDim, symbolSheetDims } = w.sheets;

        w.texObs.resize({
          numTextures: symbolSheetDims.length,
          width: maxSymbolSheetDim.width,
          height: maxSymbolSheetDim.height,
        });
        for (let sheetId = 0; sheetId < state.images.length; sheetId++) {
          ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
          ct.drawImage(state.images[sheetId], 0, 0);
          w.texObs.updateIndex(sheetId);
        }
      },
      createObstacleMatrix4(gmTransform, { origPoly: { rect }, transform: { a, b, c, d, e, f }, height }) {
        const [mat, mat4] = [tmpMat1, tmpMatFour1];
        mat.feedFromArray([rect.width, 0, 0, rect.height, rect.x, rect.y]);
        mat.postMultiply([a, b, c, d, e, f]).postMultiply(gmTransform);
        return embedXZMat4(mat, { mat4, yHeight: height });
      },
      decodeInstanceId(instanceId) {
        // 🚧 more efficient decode
        let id = instanceId;
        const gmId = w.gms.findIndex((gm) => id < gm.obstacles.length || ((id -= gm.obstacles.length), false));
        const gm = w.gms[gmId];
        const obstacle = gm.obstacles[id];
        return { gmId, obstacleId: id, ...obstacle.meta };
      },
      sendDataToGpu() {
        state.quad.getAttribute("uvOffsets").needsUpdate = true;
        state.quad.getAttribute("uvDimensions").needsUpdate = true;
        state.quad.getAttribute("uvTextureIds").needsUpdate = true;

        if (state.inst) state.inst.instanceMatrix.needsUpdate = true;
        if (state.inst?.instanceColor) state.inst.instanceColor.needsUpdate = true;
        if (state.skirtInst) state.skirtInst.instanceMatrix.needsUpdate = true;
      },
      transformAndColorObstacles() {
        if (!state.inst) return;
        const { inst: obsInst } = state;
        let oId = 0;

        obsInst.instanceMatrix.array.fill(0);

        w.gms.forEach(({ obstacles, transform: { a, b, c, d, e, f } }) => {
          obstacles.forEach((o) => {
            obsInst.setColorAt(oId, tmpColor.set(o.meta.tint ?? "#999"));
            obsInst.setMatrixAt(oId, state.createObstacleMatrix4([a, b, c, d, e, f], o));
            oId++;
          });
        });

        obsInst.computeBoundingSphere();
      },
      transformSkirts() {
        if (!state.skirtInst) return;
        let sId = 0;

        state.skirtInst.instanceMatrix.array.fill(0);

        for (const { obstacles, transform: gmTransform, determinant } of w.gms) {
          for (const { origPoly, transform: obTransform, height } of obstacles) {
            // skirts support numeric meta.inset
            // 🔔 this may increase the number of edges ~ instances
            tmpMat1.setMatrixValue(obTransform).postMultiply(gmTransform);
            const corners = (
              typeof origPoly.meta.inset === "number"
                ? geomService.createInset(origPoly, origPoly.meta.inset)[0]
                : origPoly
            ).outline.map((p) => tmpMat1.transformPoint(tmpVec1.set(p.x, p.y)).clone());

            // biome-ignore format: succinct
            for (let i = 0; i < corners.length; i++) {
              const j = (i + 1) % corners.length;
              const [p1, p2] = determinant > 0 ? [corners[j], corners[i]] : [corners[i], corners[j]];
              const dx = p2.x - p1.x, dy = p2.y - p1.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              const nx = -dy / len, ny = dx / len; // unit normal perpendicular to edge
              const skirtDimY = typeof origPoly.meta.h === 'number' ? origPoly.meta.h : skirtDepth;
              tmpMat2.feedFromArray([dx, dy, nx, ny, p1.x, p1.y]);
              state.skirtInst.setMatrixAt(sId++,
                embedXZMat4(tmpMat2, { yScale: skirtDimY, yHeight: height - skirtDimY, mat4: tmpMatFour2 }),
              );
            }
          }
        }

        // state.skirtInst.instanceMatrix.needsUpdate = true;
        state.skirtInst.computeBoundingSphere();
      },
    }),
  );

  w.obs = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texObs;
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const uvTexIds = attribute<"uint">("uvTextureIds", "uint");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    const texNodeFinal = texNode.depth(uvTexIds);
    return {
      colorNode: texNodeFinal,
      outputNode: w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.obstacle),
      uid: generateUUID(),
    };
  }, [w.texObs.hash]);

  const skirtCount = w.gmsData.count.obstacleSkirtEdges;
  const skirtLightMeta = useMemo(() => {
    // xyz = world position, w = radius (non-zero to avoid div-by-zero in shader)
    const sentinel = new THREE.Vector4(0, -1000, 0, 1);
    const light0Values = Array.from({ length: skirtCount }, () => sentinel.clone());
    const light1Values = Array.from({ length: skirtCount }, () => sentinel.clone());
    const lights0Node = uniformArray<"vec4">(light0Values, "vec4");
    const lights1Node = uniformArray<"vec4">(light1Values, "vec4");
    const factor = Fn(() => {
      const l0 = lights0Node.element(instanceIndex);
      const l1 = lights1Node.element(instanceIndex);
      const dist0 = positionWorld.sub(l0.xyz).length();
      const dist1 = positionWorld.sub(l1.xyz).length();
      const r0 = l0.w;
      const r1 = l1.w;
      return r0.sub(dist0).div(r0).clamp(0, 1).add(r1.sub(dist1).div(r1).clamp(0, 1)).clamp(0, 0.05);
    })();
    return { light0Values, light1Values, factor };
  }, [skirtCount]);

  state.images =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "obstacle-images"],
      async queryFn() {
        return await loadObstacleImages(w.sheets.symbolSheetDims.length, getDevCacheBustQueryParam());
      },
      enabled: !!w.sheets,
    }).data ?? state.images;

  useEffect(() => {
    state.addUvs();
    state.transformAndColorObstacles();
    state.transformSkirts();

    // Collect all light world positions with per-light radius
    const lights: { x: number; z: number; radius: number }[] = [];
    for (const gm of w.gms) {
      for (const p of getLightMetas(gm)) {
        const wp = gm.matrix.transformPoint(p);
        lights.push({ x: wp.x, z: wp.y, radius: p.radius });
      }
    }

    // Per skirt edge: find 2 nearest lights (skirts share parent obstacle's center)
    let sId = 0;
    for (const { obstacles, transform } of w.gms) {
      tmpMat1.setMatrixValue(transform);
      for (const { origPoly, transform: obTransform } of obstacles) {
        tmpMat2.setMatrixValue(obTransform);
        const { rect } = origPoly;
        const lp = tmpMat1.transformPoint(
          tmpMat2.transformPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
        );
        const sorted = lights
          .map((l) => ({ l, dist: Math.hypot(lp.x - l.x, lp.y - l.z) }))
          .sort((a, b) => a.dist - b.dist);
        const l0 = sorted[0];
        const l1 = sorted[1];
        for (let i = 0; i < origPoly.outline.length; i++) {
          skirtLightMeta.light0Values[sId].set(l0 ? l0.l.x : 0, l0 ? 0 : -1000, l0 ? l0.l.z : 0, l0 ? l0.l.radius : 1);
          skirtLightMeta.light1Values[sId].set(l1 ? l1.l.x : 0, l1 ? 0 : -1000, l1 ? l1.l.z : 0, l1 ? l1.l.radius : 1);
          sId++;
        }
      }
    }

    state.draw().then(async () => {
      await pause(60); // avoid mismatched instances/uvs
      state.sendDataToGpu();
      w.update();
    });
  }, [w.mapKey, w.hash, skirtLightMeta, state.images, w.decor.ready]);

  const skirtMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const ndotv = normalWorld.dot(viewDir).mul(-1).clamp(0, 1).mul(0.8);
    const baseColor = color(obstaclesSkirtBaseColor).mul(ndotv);
    mat.colorNode = vec4(mix(baseColor, vec3(1, 1, 1), skirtLightMeta.factor.mul(0.1)), float(1));
    return mat;
  }, [skirtLightMeta]);

  return (
    <>
      <instancedMesh
        name="obstacles"
        ref={state.ref("inst", (mesh) => {
          mesh && (mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3));
        })}
        args={[undefined, undefined, MAX_OBSTACLE_QUAD_INSTANCES]}
        frustumCulled={false}
        position={[0, 0.001, 0]}
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
          colorNode={shaderMeta.colorNode}
          outputNode={shaderMeta.outputNode}
        />
      </instancedMesh>

      <instancedMesh
        name="obstacle-skirts"
        ref={state.ref("skirtInst")}
        args={[state.skirtQuad, undefined, MAX_OBSTACLE_SKIRT_INSTANCES]}
        frustumCulled={false}
        // fix issue with early mount
        material={w.assets ? skirtMaterial : undefined}
      />
    </>
  );
}

type Props = {
  disabled?: boolean;
};

export type State = {
  inst: THREE.InstancedMesh;
  skirtInst: THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  skirtQuad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  images: HTMLImageElement[];
  addUvs(): void;
  draw(): Promise<void>;
  createObstacleMatrix4(gmTransform: Geom.SixTuple, obstacle: Geomorph.LayoutObstacle): THREE.Matrix4;
  decodeInstanceId(instanceId: number): Meta<{ gmId: number; obstacleId: number }>;
  transformAndColorObstacles(): void;
  transformSkirts(): void;
  sendDataToGpu(): void;
};

const skirtDepth = 0.5;
const tmpMat1 = new Mat();
const tmpMat2 = new Mat();
const tmpVec1 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
const tmpMatFour2 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const obstaclesSkirtBaseColor = "#222";

function loadObstacleImages(numSheets: number, cacheBust: string): Promise<HTMLImageElement[]> {
  return Promise.all(
    Array.from({ length: numSheets }, (_, i) => i).map((sheetId) =>
      loadImage(`/sheet/symbols.${sheetId}.png${cacheBust}`),
    ),
  );
}
