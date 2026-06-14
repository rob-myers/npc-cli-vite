import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { geomService, Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { attribute, texture, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { DecorSheetEntry } from "../assets.schema";
import {
  decorIconRadius,
  decorIconRadiusOutset,
  decorKeyFallback,
  lockedDoorTint,
  MAX_DECOR_QUAD_INSTANCES,
  precision,
  sguToWorldScale,
  unlockedDoorTint,
} from "../const";
import { createUnitBox, embedXZMat4, getRotAxisMatrix, setRotMatrixAboutPoint } from "../service/geometry";
import { addToDecorGrid } from "../service/grid";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { WorldContext } from "./world-context";

export default function Decor() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      box: createUnitBox(),
      byKey: {},
      inst: null as any,
      // door related
      gdKeyToInstanceId: {},
      grid: {},
      // decor needn't have an instance
      instanceIdToDecorId: [],
      lastHmr: 0,
      materials: [],
      // also changes on hmr while meta lacks roomId
      ready: false,

      uvOffsets: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),

      clearGrid() {
        Object.values(state.grid).forEach((col) => col.clear());
      },
      create(def) {
        const meta = (def.meta ?? {}) as Meta<Geomorph.GmRoomId>;
        meta.decor = true;
        meta.decorKey = def.key;

        let d: Geomorph.Decor;

        switch (def.type) {
          case "circle": {
            d = {
              type: "circle",
              key: def.key,
              meta: Object.assign(meta, { circle: true }),
              bounds: Rect.fromJson({
                x: def.center.x - def.radius,
                y: def.center.y - def.radius,
                width: def.radius * 2,
                height: def.radius * 2,
              }),
              radius: def.radius,
              center: Vect.from(def.center),
            };
            break;
          }
          case "quad": {
            /**
             * Decor quads MUST have a respective "entry" i.e. decor image,
             * providing dimensions via decor manifest.json original{Width,Height} (sgu).
             */
            const transform = def.transform ?? [1, 0, 0, 1, 0, 0];

            let entry = w.sheets.decor[def.img];
            if (!entry) {
              // throw Error(`decor.img not in w.sheets.decor: "${def.img}"`);
              warn(`def.img "${def.img}" not in w.sheets.decor: using ${decorKeyFallback}`);
              entry = w.sheets.decor[decorKeyFallback];
            }

            const matrix = tmpMat.feedFromArray(transform);
            // biome-ignore format: preserve newlines
            const poly = Poly.fromRect({ x: 0, y: 0, width: entry.originalWidth * sguToWorldScale, height: entry.originalHeight * sguToWorldScale }).applyMatrix(matrix);

            const center = poly.center.precision(3);
            const { baseRect } = geomService.polyToAngledRect(poly);
            const topCenter = center
              .clone()
              .translate(-(transform[2] * baseRect.height) / 2, -(transform[3] * baseRect.height) / 2)
              .precision(3);

            d = {
              type: "quad",
              key: def.key,
              meta: Object.assign(meta, {
                quad: true,
                color: def.color,
                img: def.img,
                y: def.y3d,
              }),
              bounds: poly.rect.precision(2),
              transform,
              center,
              topCenter,
            };
            break;
          }
          case "rect": {
            const poly = geomService.angledRectToPoly({ baseRect: tmpRect.setFromJson(def), angle: def.angle ?? 0 });
            d = {
              type: "rect",
              key: def.key,
              meta: Object.assign(meta, { rect: true }),
              bounds: poly.rect,
              points: poly.outline.map((x) => x.clone()),
              center: poly.center.precision(2),
              angle: def.angle ?? 0,
            };
            break;
          }
          case "point": {
            const center = tmpVect.copy(def).precision(precision);
            const radius = decorIconRadius + decorIconRadiusOutset;
            const bounds = tmpRect
              .set(center.x - radius, center.y - radius, 2 * radius, 2 * radius)
              .precision(precision);

            if (typeof def.img === "string" && !(def.img in w.sheets.decor)) {
              warn(`def.img "${def.img}" not in w.sheets.decor: using ${decorKeyFallback}`);
              def.img = decorKeyFallback;
            }

            d = {
              type: "point",
              key: def.key,
              meta: Object.assign(meta, {
                point: true,
                y: def.y3d,
                ...(def.img !== undefined && { img: def.img }),
                ...(typeof meta.do === "string" && { groundPoint: { ...center } }),
              }),
              bounds,
              x: center.x,
              y: center.y,
              orient: def.orient ?? 0,
            };
            break;
          }
          default: {
            throw new ExhaustiveError(def);
          }
        }

        if (state.ensureGmRoomId(d) !== null) {
          addToDecorGrid(d, state.grid);
        }

        state.byKey[d.key] = d;

        return d;
      },
      decodeInstanceId(instanceId) {
        const entry = state.instanceIdToDecorId[instanceId];
        if (!entry) return null;
        const item = w.gms[entry.gmId]?.decor[entry.decorId];
        return item ? { ...item.meta } : null;
      },
      ensureGmRoomId(decor) {
        if (!(decor.meta.gmId >= 0 && decor.meta.roomId >= 0)) {
          const decorOrigin = decor.type === "point" ? decor : decor.center;
          const gmRoomId = w.e.findRoomContaining(decorOrigin);
          return gmRoomId === null ? null : Object.assign(decor.meta, gmRoomId);
        } else {
          decor.meta.grKey ??= helper.getGmRoomKey(decor.meta.gmId, decor.meta.roomId);
          return decor.meta;
        }
      },
      getDecorPointImgKey(d) {
        if (d.type === "quad") return d.meta.img ?? decorKeyFallback;

        const meta = d.meta;
        if (meta.do === "sit") return "sit-circled";
        if (meta.do === "stand") return "stand-circled";
        if (meta.do === "lie") return "lie-circled";
        return decorKeyFallback;
      },
      hasInstance(decor) {
        return (
          decor.type === "quad" ||
          // 🚧 e.g. to illustrate behaviours
          (decor.type === "point" && decor.meta.shown === true)
        );
      },
      remove(..._decorKeys) {
        // 🚧 free up instances?
      },
      tintInstances(colorRep, ...instanceIds) {
        if (!state.inst.instanceColor) return;

        for (const instanceId of instanceIds) {
          const entry = state.instanceIdToDecorId[instanceId];
          if (!entry) continue;
          state.inst.setColorAt(instanceId, tmpColor.set(colorRep));
          w.gms[entry.gmId].decor[entry.decorId].meta.tint = colorRep;
        }

        state.inst.instanceColor.needsUpdate = true;
        if (w.disabled) w.view.forceUpdate();
      },
    }),
  );

  w.decor = state;

  const { data: materials } = useQuery({
    // 🔔 force recompute decor mutations on run world query
    queryKey: ["decor-setup", w.mapKey, w.gmsHash, w.texDecor.hash, state.lastHmr, w.lastQuery],
    async queryFn() {
      if (import.meta.hot?.data.__JUST_HMR_DECOR__) {
        import.meta.hot.data.__JUST_HMR_DECOR__ = false;
        state.set({ lastHmr: Date.now() });
        return null; // ignore 1st stale invoke after HMR
      }

      if (!w.sheets) return null;
      w.setNextPending({ decor: true });

      // 1. load sheet images
      const images = await Promise.all(
        Array.from({ length: w.sheets.decorSheetDims.length }, (_, i) =>
          loadImage(`/sheet/decor.${i}.png${getDevCacheBustQueryParam()}`),
        ),
      );

      // 2. draw sheets into texture array
      const { ct } = w.texDecor;
      w.texDecor.resize({
        numTextures: w.sheets.decorSheetDims.length,
        width: w.sheets.maxDecorSheetDim.width,
        height: w.sheets.maxDecorSheetDim.height,
        // force: true, // else texture blank on save const.ts
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
      state.instanceIdToDecorId.length = 0;
      let uvIdx = 0;
      for (const gm of w.gms) {
        for (const item of gm.decor) {
          if (!state.hasInstance(item)) {
            continue;
          }
          const imgKey = state.getDecorPointImgKey(item);
          const entry = w.sheets.decor[imgKey] as DecorSheetEntry | undefined;
          if (!entry) {
            warn(`decor "${imgKey}" not found in sheets.json`);
            uvIdx++;
            continue;
          }
          const dims = w.sheets.decorSheetDims[entry.sheetId];
          if (!dims) continue;
          state.uvOffsets.set([entry.rect.x / dims.width, entry.rect.y / dims.height], uvIdx * 2);
          state.uvDimensions.set([entry.rect.width / dims.width, entry.rect.height / dims.height], uvIdx * 2);
          state.uvTextureIds[uvIdx] = entry.sheetId;
          uvIdx++;
        }
      }

      await pause(100);

      // 4. transform instances
      state.gdKeyToInstanceId = {};
      state.inst.instanceMatrix.array.fill(0);
      let instanceId = 0;
      let tiltMat4 = new THREE.Matrix4();

      for (const [gmId, gm] of w.gms.entries()) {
        for (const [decorId, decor] of gm.decor.entries()) {
          if (!state.hasInstance(decor)) {
            continue;
          }

          const imgKey = state.getDecorPointImgKey(decor);
          const entry = w.sheets.decor[imgKey];
          if (!entry) {
            instanceId++;
            continue;
          }

          if (decor.type === "quad") {
            tmpMat.setMatrixValue(decor.transform);

            const shouldTilt = decor.meta.tilt === true; // currently only switches
            if (shouldTilt) {
              const { a, b, c, d } = tmpMat;
              const det = a * d - b * c;
              tiltMat4 = getRotAxisMatrix(a, 0, b, (det > 0 ? 1 : -1) * 90);
              setRotMatrixAboutPoint(tiltMat4, decor.topCenter.x, decor.meta.y, decor.topCenter.y);
            }

            // biome-ignore format: preserve newlines
            tmpMat.preMultiply([entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0,]);
            const mat4 = embedXZMat4(tmpMat, { yScale: cuboidHeight, yHeight: decor.meta.y ?? 0, mat4: tmpMat4 });
            if (shouldTilt) mat4.premultiply(tiltMat4);

            state.inst.setMatrixAt(instanceId, mat4);

            if (typeof decor.meta.doorId === "number") {
              // tint via un/locked doors
              const gdKey: Geomorph.GmDoorKey = `g${gmId}d${decor.meta.doorId}`;
              const { locked } = w.door.byKey[gdKey];
              state.inst.setColorAt(instanceId, tmpColor.set(locked ? lockedDoorTint : unlockedDoorTint));
              // build gdKey -> instances
              (state.gdKeyToInstanceId[gdKey] ??= []).push(instanceId);
            } else {
              state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.tint ?? "#ffffff"));
            }
          }

          if (decor.type === "point") {
            // point: flat face-up quad centered at (decor.x, decor.y) in XZ plane
            const pw = entry.originalWidth * sguToWorldScale;
            const ph = entry.originalHeight * sguToWorldScale;
            const angle = (decor.orient - 90) * (Math.PI / 180);
            const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
            const [a, b, c, d] = [cos * pw, sin * pw, -sin * ph, cos * ph];
            // biome-ignore format: preserve newlines
            tmpMat.feedFromArray([a, b, c, d, decor.x - (a + c) * 0.5, decor.y - (b + d) * 0.5]);
            const mat4 = embedXZMat4(tmpMat, { yScale: cuboidIconHeight, yHeight: decor.meta.y ?? 0, mat4: tmpMat4 });
            state.inst.setMatrixAt(instanceId, mat4);
            state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.tint ?? "#ffffff"));
          }

          state.instanceIdToDecorId[instanceId] = { gmId, decorId };
          instanceId++;
        }
      }
      state.inst.count = instanceId;
      state.inst.computeBoundingSphere();

      await pause(100);

      // 5. enrich decor.meta and build decor grid
      // applies to all decor not only those with an instancedMesh instance
      const metaPoint = { x: 0, y: 0, meta: {} as Meta };
      state.clearGrid();
      state.byKey = {};

      for (const [gmId, gm] of w.gms.entries()) {
        for (const decor of gm.decor) {
          metaPoint.x = decor.type === "point" ? decor.x : decor.center.x;
          metaPoint.y = decor.type === "point" ? decor.y : decor.center.y;
          metaPoint.meta = decor.meta;
          const gmRoomId = w.e.findRoomContaining(metaPoint, true);
          if (gmRoomId !== null) {
            Object.assign(decor.meta, gmRoomId);
          }

          // we use periods for paths in CLI
          const suffix = `${metaPoint.x}-${decor.meta.y ?? 0}-${metaPoint.y}`.replace(/\./g, "_");
          decor.key = `g${gmId}r${decor.meta.roomId ?? "?"}-${decor.type}-${suffix}`;
          state.byKey[decor.key] = decor;
          decor.meta.key = decor.key;

          addToDecorGrid(decor, state.grid);
        }
      }

      await pause(100);

      // 6. send to GPU
      const geo = state.inst.geometry;
      geo.getAttribute("uvOffsets").needsUpdate = true;
      geo.getAttribute("uvDimensions").needsUpdate = true;
      geo.getAttribute("uvTextureIds").needsUpdate = true;
      state.inst.instanceMatrix.needsUpdate = true;
      if (state.inst.instanceColor) state.inst.instanceColor.needsUpdate = true;

      // 7. build materials
      const uvDims = attribute<"vec2">("uvDimensions", "vec2");
      const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
      const uvTexIds = attribute<"uint">("uvTextureIds", "uint");
      // flip V: DataArrayTexture data is top-to-bottom but BoxGeometry +Y face has v=0 at bottom
      const flippedUv = vec2(uv().x, uv().y.oneMinus());
      const transformedUv = flippedUv.mul(uvDims).add(uvOffs);
      const texNode = texture(w.texDecor.tex, transformedUv);
      texNode.depthNode = uvTexIds;

      const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
      texMat.colorNode = texNode.mul(0.6);
      texMat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.decor);

      state.ready = true;
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
    gcTime: 0,
  });

  state.materials = materials ?? state.materials;

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
  gdKeyToInstanceId: { [gdKey: string]: number[] };
  instanceIdToDecorId: { gmId: number; decorId: number }[];
  grid: Geomorph.DecorGrid;
  lastHmr: number;
  ready: boolean;

  box: THREE.BufferGeometry;
  byKey: Record<string, Geomorph.Decor>;
  materials: THREE.MeshStandardNodeMaterial[];
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;

  clearGrid(): void;
  create(def: Geomorph.DecorDef): Geomorph.Decor;
  decodeInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  getDecorPointImgKey(decor: Geomorph.Decor): string;
  ensureGmRoomId(d: Geomorph.Decor): Geomorph.GmRoomId | null;
  hasInstance(decor: Geomorph.Decor): boolean;
  remove(...decorKeys: string[]): void;
  tintInstances(colorRep: string, ...instanceIds: number[]): void;
};

const cuboidHeight = 0.05;
const cuboidIconHeight = 0.005;
const tmpVect = new Vect();
const tmpRect = new Rect();
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const plainBlackMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, color: "#000" });

// used to ignore stale queryFn and trigger fresh one
import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("Decor.tsx"));
  if (import.meta.hot && updatedThisFile) {
    import.meta.hot.data.__JUST_HMR_DECOR__ = true;
  }
});
