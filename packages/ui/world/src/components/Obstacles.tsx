import { sguScaleSvgToPngFactor } from "@npc-cli/media/starship-symbol";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { Mat, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import {
  attribute,
  cameraPosition,
  color,
  Fn,
  instanceIndex,
  int,
  mix,
  normalWorld,
  positionWorld,
  texture,
  transformNormalToView,
  uniform,
  uniformArray,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { StarShipSymbolSheetEntry } from "../assets.schema";
import { MAX_OBSTACLE_QUAD_INSTANCES, MAX_OBSTACLE_SKIRT_INSTANCES, worldToSguScale } from "../const";
import { createTwoSidedXyQuad, createTwoSidedXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot, ensureRoomSlots, slotOf } from "../service/room-slots";
import { bootstrapInstanceColor, getLightMetas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Obstacles(_props: Props) {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...({} as Pick<State, "inst" | "skirtInst">),

      quad: createTwoSidedXzQuad(), // 2-sided handles flipped obstacles
      skirtQuad: createTwoSidedXyQuad(),
      brightnessNode: uniform(1),

      uvOffsets: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_OBSTACLE_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_OBSTACLE_QUAD_INSTANCES),
      images: [] as HTMLImageElement[],
      instanceCount: 0,
      toInstanceId: [],
      fromInstanceId: [],
      roomSlotByInstanceId: [],

      buildInstanceIds() {
        state.toInstanceId = [];
        state.fromInstanceId = [];
        state.roomSlotByInstanceId = [];
        const roomIdsByGmKey: Partial<Record<Geomorph.StarShipGeomorphKey, (null | number)[]>> = {};
        let nextId = 0;
        for (const [gmId, gm] of w.gms.entries()) {
          // avoid recompute roomId for multiple instances
          const roomIds = (roomIdsByGmKey[gm.key] ??= gm.obstacles.map((o) => state.roomIdOf(gmId, o)));
          state.toInstanceId[gmId] = [];
          for (const [obstacleId] of gm.obstacles.entries()) {
            if (nextId < MAX_OBSTACLE_QUAD_INSTANCES) {
              const roomId = roomIds[obstacleId];
              state.toInstanceId[gmId][obstacleId] = nextId;
              state.fromInstanceId[nextId] = { gmId, obstacleId };
              state.roomSlotByInstanceId[nextId] = roomId === null ? alwaysShownSlot : slotOf(gmId, roomId);
            }
            nextId++;
          }
        }
        if (nextId > MAX_OBSTACLE_QUAD_INSTANCES) {
          warn(`Obstacles: ${nextId} exceeds MAX_OBSTACLE_QUAD_INSTANCES (${MAX_OBSTACLE_QUAD_INSTANCES})`);
        }
        return (state.instanceCount = Math.min(nextId, MAX_OBSTACLE_QUAD_INSTANCES));
      },

      addUvs() {
        if (!w.sheets) return;

        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);
        const uvTextureIds = state.quad.getAttribute("uvTextureIds");
        (uvTextureIds.array as Uint32Array).fill(0);

        const worldToPngScale = worldToSguScale * sguScaleSvgToPngFactor;

        // written AT the instance id rather than in step with it, so nothing here can drift out of
        // line with `transformAndColorObstacles` or with what a pick decodes — see `buildInstanceIds`
        for (const [gmId, { obstacles }] of w.gms.entries()) {
          for (const [obstacleId, { symbolKey, origSubRect }] of obstacles.entries()) {
            const instanceId = state.encodeInstanceId(gmId, obstacleId);
            if (instanceId === null) {
              continue; // past the cap, so it has no instance to describe
            }
            const entry = w.sheets.symbol[symbolKey] as StarShipSymbolSheetEntry;
            if (!entry) {
              warn(`${symbolKey} not found in sheets.json`);
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

            uvOffsets.array.set([uvOffsetX, uvOffsetY], instanceId * 2);
            uvDimensions.array.set([uvDimW, uvDimH], instanceId * 2);
            uvTextureIds.array[instanceId] = sheetId;
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
        const found = state.fromInstanceId[instanceId];
        const { gmId, obstacleId } = found;
        const obstacle = w.gms[gmId]?.obstacles[obstacleId];
        // 🔔 saw gmId 0 in obstacle.meta
        return { ...obstacle.meta, gmId, obstacleId };
      },
      encodeInstanceId(gmId, obstacleId) {
        return state.toInstanceId[gmId]?.[obstacleId] ?? null;
      },
      setBrightness(next) {
        state.brightnessNode.value = next;
      },
      sendDataToGpu() {
        state.quad.getAttribute("uvOffsets").needsUpdate = true;
        state.quad.getAttribute("uvDimensions").needsUpdate = true;
        state.quad.getAttribute("uvTextureIds").needsUpdate = true;

        if (state.inst) state.inst.instanceMatrix.needsUpdate = true;
        if (state.inst?.instanceColor) state.inst.instanceColor.needsUpdate = true;
        if (state.skirtInst) state.skirtInst.instanceMatrix.needsUpdate = true;
        if (state.skirtInst?.instanceColor) state.skirtInst.instanceColor.needsUpdate = true;
      },
      roomIdOf(gmId, { origPoly, transform }) {
        // Where it stands, from its centre in the geomorph's OWN space — which is what `roomSlots`
        // is drawn in, so the answer belongs to the LAYOUT and any instance of it may be asked.
        //
        // Not stamped onto `obstacle.meta` as `instantiateDecor` does for decor: `createLayoutInstance`
        // spreads `...layout`, so two instances of one geomorph key share these metas — a `gmId`
        // written there would be whichever went last. Hence the lookup by instance id instead
        const { rect } = origPoly;
        const at = tmpMat2.setMatrixValue(transform).transformPoint({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
        return w.view.roomSlots.roomAt(gmId, at);
      },
      transformAndColorObstacles() {
        if (!state.inst) return;
        const { inst: obsInst } = state;
        const slots = ensureRoomSlots(state.quad, MAX_OBSTACLE_QUAD_INSTANCES);

        obsInst.instanceMatrix.array.fill(0);

        w.gms.forEach(({ obstacles, transform: { a, b, c, d, e, f } }, gmId) => {
          obstacles.forEach((o, obstacleId) => {
            const instanceId = state.encodeInstanceId(gmId, obstacleId);
            if (instanceId === null) return;
            const slot = state.roomSlotByInstanceId[instanceId] ?? alwaysShownSlot;
            slots.setXY(instanceId, slot, slot);
            obsInst.setColorAt(instanceId, tmpColor.set(o.meta.tint ?? defaultObstacleTint));
            obsInst.setMatrixAt(instanceId, state.createObstacleMatrix4([a, b, c, d, e, f], o));
          });
        });

        slots.needsUpdate = true;

        // the mesh is sized for the worst case, so the rest would be drawn as degenerate quads
        obsInst.count = state.instanceCount;
        obsInst.computeBoundingSphere();
      },
      transformAndColorSkirts() {
        if (!state.skirtInst) return;
        const slots = ensureRoomSlots(state.skirtQuad, MAX_OBSTACLE_SKIRT_INSTANCES);
        let sId = 0;

        state.skirtInst.instanceMatrix.array.fill(0);

        for (const [gmId, { obstacles, transform: gmTransform, determinant }] of w.gms.entries()) {
          for (const [obstacleId, obstacle] of obstacles.entries()) {
            const { origPoly, transform: obTransform, height, meta } = obstacle;
            // a skirt stands where its obstacle does, which was worked out in `buildInstanceIds`
            const instanceId = state.encodeInstanceId(gmId, obstacleId);
            const slot = (instanceId !== null && state.roomSlotByInstanceId[instanceId]) || alwaysShownSlot;
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
              const skirtDimY = typeof meta.h === 'number' ? meta.h : skirtDepth;
              tmpMat2.feedFromArray([dx, dy, nx, ny, p1.x, p1.y]);
              slots.setXY(sId, slot, slot);
              state.skirtInst.setColorAt(sId, tmpColor.set(meta.skirtTint ?? "#999"));
              state.skirtInst.setMatrixAt(sId++,
                embedXZMat4(tmpMat2, { yScale: skirtDimY, yHeight: height - skirtDimY, mat4: tmpMatFour2 }),
              );
            }
          }
        }

        // state.skirtInst.instanceMatrix.needsUpdate = true;
        slots.needsUpdate = true;
        state.skirtInst.computeBoundingSphere();
      },
    }),
  );

  w.obs = state;

  const material = useMemo(() => {
    const texArray = w.texObs;
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const uvTexIds = attribute<"uint">("uvTextureIds", "uint");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    const texNodeFinal = texNode.depth(uvTexIds);
    const normalNode = transformNormalToView(vec3(0, 1, 0));
    const unlit = texNodeFinal.mul(vec3(state.brightnessNode), 1);
    return {
      colorNode: w.view.fadeRoomsFx.applyFadeRgba(
        mix(unlit, w.view.playerLight.applyLightRgba(unlit), w.view.obstaclesLit),
        w.view.fadeRoomsFx.getVisiblity(attribute<"vec2">("roomSlots", "vec2").x),
      ),
      normalNode,
      outputNode: w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.obstacle),
      uid: generateUUID(),
    };
  }, [w.texObs.hash, w.view.playerLight.uid, w.view.fadeRoomsFx.uid]);

  useMemo(() => state.buildInstanceIds(), [w.mapKey, w.hash]);

  // the materials above name `roomSlots`, so it must be on the geometry before they compile —
  // the effects that fill it run later
  useMemo(() => {
    ensureRoomSlots(state.quad, MAX_OBSTACLE_QUAD_INSTANCES);
    ensureRoomSlots(state.skirtQuad, MAX_OBSTACLE_SKIRT_INSTANCES);
  }, []);

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

  const skirtMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial({
      side: THREE.FrontSide, // 1 draw call
      transparent: true,
    });
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const ndotv = normalWorld.dot(viewDir).mul(-1).clamp(0, 1).mul(0.8);
    const baseColor = color(obstaclesSkirtBaseColor).mul(ndotv);
    mat.colorNode = w.view.fadeRoomsFx.applyFadeRgba(
      w.view.playerLight.applyLightRgba(vec4(mix(baseColor, vec3(1, 1, 1), skirtLightMeta.factor.mul(1)), 1)),
      w.view.fadeRoomsFx.getVisiblity(attribute<"vec2">("roomSlots", "vec2").x),
    );
    return mat;
  }, [skirtLightMeta, w.view.playerLight.uid, w.view.fadeRoomsFx.uid]);

  state.images =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "obstacle-images"],
      async queryFn() {
        return await loadObstacleImages(w.sheets.symbolSheetDims.length, getDevCacheBustQueryParam());
      },
      enabled: !!w.sheets,
    }).data ?? state.images;

  useEffect(() => {
    if (skirtLightMeta.light0Values.length !== w.gmsData.count.obstacleSkirtEdges) {
      return;
    }

    state.addUvs();
    state.transformAndColorObstacles();
    state.transformAndColorSkirts();

    // Collect all light world positions with per-light radius
    // 🔔 obstacle metas aren't gmRoomIds, so we'll restrict
    // to nearby lights (technically might be in other room)
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

    state.draw().then(() => {
      state.sendDataToGpu();
      w.update();
    });
  }, [w.mapKey, w.hash, skirtLightMeta, state.images, w.decor.ready]);

  return (
    <>
      <instancedMesh
        name="obstacles"
        ref={state.ref("inst", bootstrapInstanceColor)}
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
          key={material.uid}
          side={THREE.FrontSide} // 1 draw call
          transparent
          alphaTest={0.1}
          colorNode={material.colorNode}
          outputNode={material.outputNode}
          normalNode={material.normalNode}
        />
      </instancedMesh>

      <instancedMesh
        name="obstacle-skirts"
        ref={state.ref("skirtInst", bootstrapInstanceColor)}
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
  brightnessNode: THREE.UniformNode<"float", number>;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  images: HTMLImageElement[];
  /** How many obstacle instances this map draws, `MAX_OBSTACLE_QUAD_INSTANCES` at most */
  instanceCount: number;
  /** `gmId` then `obstacleId` to instance id — the encoding every writer and the pick share */
  toInstanceId: number[][];
  /** ...and back again, which is all a pick has to go on */
  fromInstanceId: { gmId: number; obstacleId: number }[];
  /** Which room each instance stands in, worked out once per map — see `roomSlotOf` */
  roomSlotByInstanceId: number[];
  /** Dense instance ids (`0..instanceCount-1`), rebuilt whenever the obstacles can change */
  buildInstanceIds(): number;
  addUvs(): void;
  draw(): Promise<void>;
  createObstacleMatrix4(gmTransform: Geom.SixTuple, obstacle: Geomorph.LayoutObstacle): THREE.Matrix4;
  /** `null` if no obstacle owns this instance id — see within */
  decodeInstanceId(instanceId: number): Meta<{ gmId: number; obstacleId: number }>;
  /** `null` if this obstacle is past the cap and so has no instance */
  encodeInstanceId(gmId: number, obstacleId: number): null | number;
  /** Which room an obstacle stands in — a property of the layout, not of the instance. See within */
  roomIdOf(gmId: number, obstacle: Geomorph.LayoutObstacle): null | number;
  setBrightness(next: number): void;
  transformAndColorObstacles(): void;
  transformAndColorSkirts(): void;
  sendDataToGpu(): void;
};

const skirtDepth = 0.5;
const tmpMat1 = new Mat();
const tmpMat2 = new Mat();
const tmpVec1 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
const tmpMatFour2 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const obstaclesSkirtBaseColor = "#555";
const defaultObstacleTint = "#666";

function loadObstacleImages(numSheets: number, cacheBust: string): Promise<HTMLImageElement[]> {
  return Promise.all(
    Array.from({ length: numSheets }, (_, i) => i).map((sheetId) =>
      loadImage(`/sheet/symbols.${sheetId}.png${cacheBust}`),
    ),
  );
}
