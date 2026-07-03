import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { geomService, Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";
import {
  atan,
  attribute,
  float,
  fract,
  instanceIndex,
  int,
  output,
  select,
  texture,
  min as tslMin,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { DecorSheetEntry } from "../assets.schema";
import {
  decorKeyFallback,
  decorPointDefaultRadius,
  lockedDoorTint,
  MAX_DECOR_QUAD_INSTANCES,
  precision,
  sguToWorldScale,
  unlockedDoorTint,
} from "../const";
import { createUnitBox, embedXZMat4, getRotAxisMatrix, setRotMatrixAboutPoint } from "../service/geometry";
import { addToDecorGrid, queryDecorGridRect, removeFromDecorGrid } from "../service/grid";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { bootstrapInstanceColor, type SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Decor() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: {},
      grid: {},
      lastHmr: 0,
      ready: false,

      inst: null as any,
      static: {
        decorKeyToId: {},
        gdKeyToDecorKeys: {}, // door related
        idToDecorKey: [],

        box: createUnitBox({ singleFaceGroup: true }),
        materials: [],
        shapeParams: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 3), // x=flatKind, yz=shapeDims
        uvData: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 4), // [offX, offY+texId, dimX, dimY]
      },

      instRuntime: null as any,
      runtime: {
        byKey: {},
        decorKeyToId: {},
        idToDecorKey: [] as string[],

        box: createUnitBox({ singleFaceGroup: true }),
        materials: [],
        shapeParams: new Float32Array(MAX_RUNTIME_DECOR_INSTANCES * 3), // x=flatKind, yz=shapeDims
        uvData: new Float32Array(MAX_RUNTIME_DECOR_INSTANCES * 4), // [offX, offY+texId, dimX, dimY]
        count: 0,
      },

      addDecorColliders(...decorDefs) {
        w.worker.worker.postMessage({
          type: "add-physics-colliders",
          colliders: decorDefs.map(state.getColliderDefFromDecorDef),
        } satisfies WW.MsgToWorker);
      },
      addRuntimeDecorToGrid() {
        for (const runtimeDecor of Object.values(state.runtime.byKey)) {
          runtimeDecor.meta.roomId = -1; // force recompute
          if (state.ensureGmRoomId(runtimeDecor) !== null) {
            addToDecorGrid(runtimeDecor, state.grid);
          }
        }
      },
      addRuntimeInstance(decor) {
        const inst = state.instRuntime;
        const { runtime } = state;
        if (!inst || !w.sheets || runtime.materials.length === 0) return;
        const id = runtime.count;
        if (id >= MAX_RUNTIME_DECOR_INSTANCES) {
          warn(`cannot add runtime decor ${decor.key}: capacity exceeded`);
          return;
        }
        if (!state.writeRuntimeSlot(id, decor)) {
          warn(`failed to add runtime decor ${decor.key}`);
          return;
        }
        runtime.decorKeyToId[decor.key] = id;
        runtime.idToDecorKey[id] = decor.key;
        runtime.count++;
        inst.count = runtime.count;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        runtime.box.getAttribute("uvData").needsUpdate = true;
        runtime.box.getAttribute("shapeParams").needsUpdate = true;
      },
      clearGrid() {
        Object.values(state.grid).forEach((col) => col.clear());
      },
      create(def) {
        if (state.runtime.byKey[def.key]) {
          state.remove(def.key);
        }

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
            const transform = def.transform ?? [1, 0, 0, 1, 0, 0];

            // Decor quads MUST have a respective decor image providing original
            // dimensions via decor manifest.json original{Width,Height} in sgu.
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
              det: Math.sign(matrix.a * matrix.d - matrix.b * matrix.c),
            };
            break;
          }
          case "rect": {
            const baseRect = tmpRect.setFromJson(def);
            const poly = geomService.angledRectToPoly({ baseRect, angle: def.angle ?? 0 });
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
            // points don't need an image
            if (typeof def.img === "string" && !(def.img in w.sheets.decor)) {
              warn(`w.sheets.decor lacks def.img: ${def.img}`);
              def.img = decorKeyFallback;
            }

            const entry = def.img ? w.sheets.decor[def.img] : null;
            const radius = entry
              ? (Math.max(entry.originalWidth, entry.originalHeight) * sguToWorldScale) / 2
              : decorPointDefaultRadius;
            const half = radius / 2;

            // def.transform overrides def.{x,y}
            const center = def.transform
              ? tmpVect
                  .set(
                    def.transform[0] * half + def.transform[2] * half + def.transform[4],
                    def.transform[1] * half + def.transform[3] * half + def.transform[5],
                  )
                  .precision(precision)
              : tmpVect.copy(def).precision(precision);

            const bounds = tmpRect
              .set(center.x - radius, center.y - radius, 2 * radius, 2 * radius)
              .precision(precision);

            // fallback transform is pure translation
            const transform: Geom.SixTuple = def.transform ?? [1, 0, 0, 1, bounds.x, bounds.y];

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
              transform,
              det: Math.sign(transform[0] * transform[3] - transform[1] * transform[2]),
            };
            break;
          }
          default:
            throw new ExhaustiveError(def);
        }

        if (state.ensureGmRoomId(d) !== null) {
          addToDecorGrid(d, state.grid);
        }

        state.byKey[d.key] = d;
        state.runtime.byKey[d.key] = d;

        if (state.hasInstance(d)) {
          state.addRuntimeInstance(d);
        }

        if (d.meta.collider === true && (def.type === "circle" || def.type === "rect")) {
          state.addDecorColliders(def);
        }

        return d;
      },
      decodeStaticInstanceId(instanceId) {
        const key = state.static.idToDecorKey[instanceId];
        if (key === undefined) return null;
        const decor = state.byKey[key];
        return decor ? { ...decor.meta, decorKey: key } : null;
      },
      decodeRuntimeInstanceId(instanceId) {
        const key = state.runtime.idToDecorKey[instanceId];
        if (key === undefined) return null;
        const decor = state.runtime.byKey[key];
        return decor ? { ...decor.meta, decorKey: key } : null;
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
      getColliderDefFromDecorDef(def) {
        switch (def.type) {
          case "circle":
            return {
              type: "circle",
              colliderKey: def.key,
              radius: def.radius,
              x: def.center.x,
              y: def.center.y,
              userData: { ...def.meta, decorKey: def.key },
            };
          case "rect":
            return {
              type: "rect",
              colliderKey: def.key,
              width: def.width,
              height: def.height,
              x: def.x,
              y: def.y,
              angle: def.angle ?? 0,
              userData: { ...def.meta, decorKey: def.key },
            };
          default:
            throw new ExhaustiveError(def);
        }
      },
      getDecorImgKey(d) {
        if (d.type === "quad" || d.type === "point") return d.meta.img ?? decorKeyFallback;
        return decorKeyFallback;
      },
      hasInstance(
        decor,
      ): decor is Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle {
        return (
          decor.type === "quad" ||
          (decor.type === "point" && decor.meta.shown === true) ||
          (decor.type === "rect" && decor.meta.shown === true) ||
          (decor.type === "circle" && decor.meta.shown === true)
        );
      },
      query(center, radius = defaultDecorQueryRadius, opts) {
        center = helper.parseGroundPoint(center);
        const rect = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
        return queryDecorGridRect(state.grid, rect, opts);
      },
      queryRect(rect, opts) {
        return queryDecorGridRect(state.grid, rect, opts);
      },
      remove(...decorKeys) {
        const runtime = state.runtime;
        const inst = state.instRuntime;
        if (!inst) return;

        for (const decorKey of decorKeys) {
          const d = runtime.byKey[decorKey];
          if (!d) {
            decorKey in state.byKey && warn(`cannot remove static decor: ${decorKey}`);
            continue;
          }

          removeFromDecorGrid(d, state.grid);
          delete runtime.byKey[decorKey];
          delete state.byKey[decorKey];

          const id = runtime.decorKeyToId[decorKey];
          if (id === undefined) {
            continue;
          }
          delete runtime.decorKeyToId[decorKey];

          const lastId = runtime.count - 1;
          if (id !== lastId) {
            // swap last decor into removed slot
            const lastKey = runtime.idToDecorKey[lastId];
            const lastDecor = runtime.byKey[lastKey];
            state.writeRuntimeSlot(id, lastDecor);
            runtime.decorKeyToId[lastKey] = id;
            runtime.idToDecorKey[id] = lastKey;
          }

          runtime.count--;
          inst.count = runtime.count;
          inst.setMatrixAt(lastId, zeroMat4);

          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          runtime.box.getAttribute("uvData").needsUpdate = true;
          runtime.box.getAttribute("shapeParams").needsUpdate = true;

          if (d.meta.collider === true && (d.type === "circle" || d.type === "rect")) {
            state.removeDecorColliders(d); // 🚧 prefer batch
          }
        }

        w.view.forceUpdate();
      },
      removeDecorColliders(...decor) {
        w.worker.worker.postMessage({
          type: "remove-physics-colliders",
          colliders: decor.map(({ key, type }) => ({ colliderKey: key, type })),
        } satisfies WW.MsgToWorker);
      },
      setupRuntimeInstances() {
        const inst = state.instRuntime;
        const { runtime } = state;
        if (!inst || !w.sheets || runtime.materials.length === 0) {
          return;
        }

        runtime.decorKeyToId = {};
        runtime.idToDecorKey = [];
        let id = 0;
        for (const decor of Object.values(runtime.byKey)) {
          if (!state.hasInstance(decor) || id >= MAX_RUNTIME_DECOR_INSTANCES) {
            continue;
          }
          if (state.writeRuntimeSlot(id, decor)) {
            runtime.decorKeyToId[decor.key] = id;
            runtime.idToDecorKey[id] = decor.key;
            id++;
          }
        }
        runtime.count = id;
        inst.count = id;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        runtime.box.getAttribute("uvData").needsUpdate = true;
        runtime.box.getAttribute("shapeParams").needsUpdate = true;
      },
      tintDecor(colorRep, ...decorKeys) {
        for (const decorKey of decorKeys) {
          if (decorKey in state.runtime.decorKeyToId) {
            const id = state.runtime.decorKeyToId[decorKey];
            state.instRuntime.setColorAt(id, tmpColor.set(colorRep));
          } else if (decorKey in state.byKey) {
            const id = state.static.decorKeyToId[decorKey];
            state.inst.setColorAt(id, tmpColor.set(colorRep));
          }
        }

        if (state.instRuntime.instanceColor) state.instRuntime.instanceColor.needsUpdate = true;
        if (state.inst.instanceColor) state.inst.instanceColor.needsUpdate = true;
        if (w.disabled) w.view.forceUpdate();
      },
      writeRuntimeSlot(id, decor) {
        if (decor.type === "rect") {
          const h0 = decor.points[0].distanceTo(decor.points[1]);
          const w0 = decor.points[1].distanceTo(decor.points[2]);
          const cos = Math.cos(decor.angle),
            sin = Math.sin(decor.angle);
          //biome-ignore format: preserve newlines
          state.instRuntime.setMatrixAt(id, embedXZMat4(
            { a: w0*cos, b: w0*sin, c: -h0*sin, d: h0*cos,
              e: decor.center.x - w0/2*cos + h0/2*sin,
              f: decor.center.y - w0/2*sin - h0/2*cos },
            { yScale: shapeYScale, yHeight: shapeYHeight, mat4: tmpMat4 },
          ));
          state.instRuntime.setColorAt(id, tmpColor.set(decor.meta.color ?? "#00ff88"));
          state.runtime.shapeParams.set([2, w0, h0], id * 3);
          return true;
        }
        if (decor.type === "circle") {
          const r = decor.radius;
          //biome-ignore format: preserve newlines
          state.instRuntime.setMatrixAt(id, embedXZMat4(
            { a: 2*r, b: 0, c: 0, d: 2*r, e: decor.center.x - r, f: decor.center.y - r },
            { yScale: shapeYScale, yHeight: shapeYHeight, mat4: tmpMat4 },
          ));
          state.instRuntime.setColorAt(id, tmpColor.set(decor.meta.color ?? "#00ff88"));
          state.runtime.shapeParams.set([3, r, r], id * 3);
          return true;
        }

        const imgKey = state.getDecorImgKey(decor);
        const entry = w.sheets?.decor[imgKey];
        const dims = w.sheets?.decorSheetDims[entry.sheetId];
        if (!entry || !dims) return false;

        const k = typeof decor.meta.inset === "number" ? decor.meta.inset : 0;
        if (decor.det === -1) {
          const dimX = -entry.rect.width / dims.width;
          const dimY = entry.rect.height / dims.height;
          const offX = (entry.rect.x + entry.rect.width) / dims.width;
          const offY = entry.rect.y / dims.height;
          state.runtime.uvData.set(
            [offX + dimX * k, offY + dimY * k + entry.sheetId, dimX * (1 - 2 * k), dimY * (1 - 2 * k)],
            id * 4,
          );
        } else {
          const dimX = entry.rect.width / dims.width;
          const dimY = entry.rect.height / dims.height;
          const offX = entry.rect.x / dims.width;
          const offY = entry.rect.y / dims.height;
          state.runtime.uvData.set(
            [offX + dimX * k, offY + dimY * k + entry.sheetId, dimX * (1 - 2 * k), dimY * (1 - 2 * k)],
            id * 4,
          );
        }

        const inst = state.instRuntime;

        if (decor.type === "quad") {
          tmpMat.setMatrixValue(decor.transform);
          const shouldTilt = decor.meta.tilt === true;
          let tiltMat4: THREE.Matrix4 | null = null;
          if (shouldTilt) {
            const { a, b, c, d } = tmpMat;
            tiltMat4 = getRotAxisMatrix(a, 0, b, (a * d - b * c > 0 ? 1 : -1) * 90);
            setRotMatrixAboutPoint(tiltMat4, decor.topCenter.x, decor.meta.y, decor.topCenter.y);
          }
          //biome-ignore format: preserve newlines
          tmpMat.preMultiply([ entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);
          const yScale = decor.meta.h ?? cuboidHeight;
          //biome-ignore format: preserve newlines
          const mat4 = embedXZMat4(tmpMat, { yScale, yHeight: (decor.meta.y ?? 0) + (shouldTilt ? 0 : -yScale), mat4: tmpMat4 });
          if (tiltMat4) mat4.premultiply(tiltMat4);
          inst.setMatrixAt(id, mat4);
        } else {
          tmpMat.setMatrixValue(decor.transform);
          //biome-ignore format: preserve newlines
          tmpMat.preMultiply([ entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);
          //biome-ignore format: preserve newlines
          inst.setMatrixAt(id, embedXZMat4(tmpMat, { yScale: cuboidIconHeight, yHeight: (decor.meta.y ?? 0) + cuboidIconHeight, mat4: tmpMat4 }));
        }
        inst.setColorAt(id, tmpColor.set(decor.meta.tint ?? "#ffffff"));
        state.runtime.shapeParams[id * 3] = decor.type === "point" ? 1 : 0;
        return true;
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
      const images = await w.loadDecorImages();

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
      state.static.uvData.fill(0);
      let uvIdx = 0;
      for (const gm of w.gms) {
        for (const item of gm.decor) {
          if (!state.hasInstance(item)) {
            continue;
          }
          if (item.type === "rect" || item.type === "circle") {
            uvIdx++; // shapes don't use UV atlas — leave zeros
            continue;
          }
          const imgKey = state.getDecorImgKey(item);
          const entry = w.sheets.decor[imgKey] as DecorSheetEntry | undefined;
          if (!entry) {
            warn(`decor "${imgKey}" not found in sheets.json`);
            uvIdx++;
            continue;
          }
          const dims = w.sheets.decorSheetDims[entry.sheetId];
          if (!dims) continue;

          // fix flipped decor; encode texId in integer part of offY
          if (item.det === -1) {
            state.static.uvData.set(
              [
                (entry.rect.x + entry.rect.width) / dims.width,
                entry.rect.y / dims.height + entry.sheetId,
                -entry.rect.width / dims.width,
                entry.rect.height / dims.height,
              ],
              uvIdx * 4,
            );
          } else {
            state.static.uvData.set(
              [
                entry.rect.x / dims.width,
                entry.rect.y / dims.height + entry.sheetId,
                entry.rect.width / dims.width,
                entry.rect.height / dims.height,
              ],
              uvIdx * 4,
            );
          }
          uvIdx++;
        }
      }

      await pause(100);

      // 4. build state.byKey, grid, enrich decor.meta
      // - applies to all decor not only those with an instancedMesh instance
      // - preserve runtime decor across HMR
      state.byKey = { ...state.runtime.byKey };
      state.clearGrid();
      state.addRuntimeDecorToGrid();

      const metaPoint = { x: 0, y: 0, meta: {} as Meta };

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
          decor.meta.decorKey = decor.key;

          addToDecorGrid(decor, state.grid);
        }
      }

      await pause(100);

      // 5. transform instances
      // state.static.gdKeyToInstanceIds = {};
      state.static.gdKeyToDecorKeys = {};
      state.inst.instanceMatrix.array.fill(0);
      let instanceId = 0;
      let tiltMat4 = new THREE.Matrix4();

      for (const [gmId, gm] of w.gms.entries()) {
        for (const [_decorId, decor] of gm.decor.entries()) {
          if (!state.hasInstance(decor)) {
            continue;
          }

          if (decor.type === "rect") {
            const w0 = decor.points[0].distanceTo(decor.points[1]);
            const h0 = decor.points[1].distanceTo(decor.points[2]);
            const cos = Math.cos(decor.angle),
              sin = Math.sin(decor.angle);
            // biome-ignore format: preserve newlines
            state.inst.setMatrixAt(instanceId, embedXZMat4(
              { a: w0*cos, b: w0*sin, c: -h0*sin, d: h0*cos,
                e: decor.center.x - w0/2*cos + h0/2*sin,
                f: decor.center.y - w0/2*sin - h0/2*cos },
              { yScale: shapeYScale, yHeight: shapeYHeight, mat4: tmpMat4 },
            ));
            state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.color ?? "#00ff88"));
            state.static.shapeParams.set([2, w0, h0], instanceId * 3);
            instanceId++;
            continue;
          }

          if (decor.type === "circle") {
            const r = decor.radius;
            // biome-ignore format: preserve newlines
            state.inst.setMatrixAt(instanceId, embedXZMat4(
              { a: 2*r, b: 0, c: 0, d: 2*r, e: decor.center.x - r, f: decor.center.y - r },
              { yScale: shapeYScale, yHeight: shapeYHeight, mat4: tmpMat4 },
            ));
            state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.color ?? "#00ff88"));
            state.static.shapeParams.set([3, r, r], instanceId * 3);
            instanceId++;
            continue;
          }

          const imgKey = state.getDecorImgKey(decor);
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
            tmpMat.preMultiply([entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);
            const yScale = decor.meta.h ?? cuboidHeight;
            const mat4 = embedXZMat4(tmpMat, {
              yScale,
              // meta.y is top and meta.h is height (unsupported for tilt)
              yHeight: (decor.meta.y ?? 0) + (shouldTilt ? 0 : -yScale),
              mat4: tmpMat4,
            });
            if (shouldTilt) mat4.premultiply(tiltMat4);

            state.inst.setMatrixAt(instanceId, mat4);

            if (typeof decor.meta.doorId === "number") {
              // tint via un/locked doors
              const gdKey: Geomorph.GmDoorKey = `g${gmId}d${decor.meta.doorId}`;
              const { locked } = w.door.byKey[gdKey];
              state.inst.setColorAt(instanceId, tmpColor.set(locked ? lockedDoorTint : unlockedDoorTint));
              // build gdKey -> decorKeys
              (state.static.gdKeyToDecorKeys[gdKey] ??= []).push(decor.key);
            } else {
              state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.tint ?? "#ffffff"));
            }
          }

          if (decor.type === "point") {
            // point: flat face-up quad centered at (decor.x, decor.y) in XZ plane
            tmpMat.setMatrixValue(decor.transform);
            // biome-ignore format: preserve newlines
            tmpMat.preMultiply([entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);

            const mat4 = embedXZMat4(tmpMat, {
              yScale: cuboidIconHeight,
              yHeight: (decor.meta.y ?? 0) + cuboidIconHeight,
              mat4: tmpMat4,
            });
            state.inst.setMatrixAt(instanceId, mat4);
            state.inst.setColorAt(instanceId, tmpColor.set(decor.meta.tint ?? "#ffffff"));
          }

          state.static.decorKeyToId[decor.key] = instanceId;
          state.static.idToDecorKey[instanceId] = decor.key;
          state.static.shapeParams[instanceId * 3] = decor.type === "point" ? 1 : 0;
          instanceId++;
        }
      }
      state.inst.count = instanceId;
      state.inst.computeBoundingSphere();

      await pause(100);

      // 6. send to GPU
      const geo = state.inst.geometry;
      geo.getAttribute("uvData").needsUpdate = true;
      geo.getAttribute("shapeParams").needsUpdate = true;
      state.inst.instanceMatrix.needsUpdate = true;
      if (state.inst.instanceColor) state.inst.instanceColor.needsUpdate = true;

      // 7. build materials
      const uvDataAttr = attribute<"vec4">("uvData", "vec4");
      // flip V: DataArrayTexture data is top-to-bottom but BoxGeometry +Y face has v=0 at bottom
      const flippedUv = vec2(uv().x, uv().y.oneMinus());
      const transformedUv = flippedUv
        .mul(vec2(uvDataAttr.z, uvDataAttr.w))
        .add(vec2(uvDataAttr.x, uvDataAttr.y.fract()));
      const texNode = texture(w.texDecor.tex, transformedUv);
      texNode.depthNode = int(uvDataAttr.y.floor()); // decode sheetId

      // Shapes (shapeParams.x >= 2): colorNode=white so `output` carries instanceColor (set via setColorAt).
      // Quads/points: colorNode=atlas texture (unchanged behavior).
      const shapeKindAttr = attribute<"vec3">("shapeParams", "vec3").x;
      const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true });
      texMat.colorNode = (select as SelectAnyType)(
        shapeKindAttr.greaterThan(1.5),
        vec4(1, 1, 1, 1),
        texNode.mul(vec4(0.4, 0.4, 0.4, 1)),
      ) as THREE.Node<"vec4">;

      // transparent icon can be hard to pick so permit pick any place on cuboid
      // hide non-top faces for flat instances (points, rects, circles)
      plainBlackMaterial.outputNode = (select as SelectAnyType)(
        shapeKindAttr.greaterThan(0.5),
        vec4(0, 0, 0, 0),
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.decor),
      );

      texMat.outputNode = buildShapeOutputNode(
        OBJECT_PICK_KEY_TO_RED.decor,
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.decor),
        w.view.objectPick,
      );

      const runtimeTexMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true });
      runtimeTexMat.colorNode = (select as SelectAnyType)(
        shapeKindAttr.greaterThan(1.5),
        vec4(1, 1, 1, 1),
        texNode.mul(vec4(0.4, 0.4, 0.4, 1)),
      ) as THREE.Node<"vec4">;
      runtimeTexMat.outputNode = buildShapeOutputNode(
        OBJECT_PICK_KEY_TO_RED.runtimeDecor,
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.runtimeDecor),
        w.view.objectPick,
      );

      const runtimeBlackMat = new THREE.MeshStandardNodeMaterial({
        side: THREE.DoubleSide,
        color: "#000",
        transparent: true,
      });
      runtimeBlackMat.outputNode = (select as SelectAnyType)(
        shapeKindAttr.greaterThan(0.5),
        vec4(0, 0, 0, 0),
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.runtimeDecor),
      );

      state.ready = true;
      w.setNextPending({ decor: false });
      w.setCanvasFade(false);

      return {
        static: [plainBlackMaterial, texMat],
        runtime: [runtimeBlackMat, runtimeTexMat],
      };
    },
    enabled: !!w.hash && !!w.sheets && !w.pending.nav && w.gms.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  state.static.materials = materials?.static ?? state.static.materials;
  state.runtime.materials = materials?.runtime ?? state.runtime.materials;

  useEffect(() => {
    state.setupRuntimeInstances();
  }, [materials]);

  return (
    <>
      <instancedMesh
        name="static-decor"
        ref={state.ref("inst", bootstrapInstanceColor)}
        args={[undefined, undefined, MAX_DECOR_QUAD_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.static.materials}
        visible={state.static.materials.length > 0}
      >
        <bufferGeometry
          attributes={state.static.box.attributes}
          index={state.static.box.index}
          groups={state.static.box.groups}
        >
          <instancedBufferAttribute attach="attributes-uvData" args={[state.static.uvData, 4]} />
          <instancedBufferAttribute attach="attributes-shapeParams" args={[state.static.shapeParams, 3]} />
        </bufferGeometry>
      </instancedMesh>

      <instancedMesh
        name="runtime-decor"
        ref={state.ref("instRuntime", bootstrapInstanceColor)}
        args={[undefined, undefined, MAX_RUNTIME_DECOR_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.runtime.materials}
        visible={state.runtime.materials.length > 0}
      >
        <bufferGeometry
          attributes={state.runtime.box.attributes}
          index={state.runtime.box.index}
          groups={state.runtime.box.groups}
        >
          <instancedBufferAttribute attach="attributes-uvData" args={[state.runtime.uvData, 4]} />
          <instancedBufferAttribute attach="attributes-shapeParams" args={[state.runtime.shapeParams, 3]} />
        </bufferGeometry>
      </instancedMesh>
    </>
  );
}

export type State = {
  byKey: Record<string, Geomorph.Decor>;
  grid: Geomorph.DecorGrid;
  lastHmr: number;
  /** Also false briefly after HMR */
  ready: boolean;

  inst: THREE.InstancedMesh;
  static: {
    decorKeyToId: Record<string, number>;
    idToDecorKey: string[];
    /** Static decor related to a specific door e.g. switches */
    gdKeyToDecorKeys: { [gdKey: string]: string[] };

    box: THREE.BufferGeometry;
    materials: THREE.MeshStandardNodeMaterial[];
    uvData: Float32Array;
    shapeParams: Float32Array;
  };

  instRuntime: THREE.InstancedMesh;
  runtime: {
    byKey: Record<string, Geomorph.Decor>;
    decorKeyToId: Record<string, number>;
    idToDecorKey: string[];

    box: THREE.BufferGeometry;
    materials: THREE.MeshStandardNodeMaterial[];
    uvData: Float32Array;
    shapeParams: Float32Array;
    count: number;
  };

  addDecorColliders(...colliders: Extract<Geomorph.DecorDef, { type: "rect" | "circle" }>[]): void;
  addRuntimeDecorToGrid(): void;
  addRuntimeInstance(decor: Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle): void;
  clearGrid(): void;
  create(def: Geomorph.DecorDef): Geomorph.Decor;
  decodeStaticInstanceId(instanceId: number): Meta<Geomorph.GmRoomId & { decorKey: string }> | null;
  decodeRuntimeInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  ensureGmRoomId(d: Geomorph.Decor): Geomorph.GmRoomId | null;
  getColliderDefFromDecorDef(def: Extract<Geomorph.DecorDef, { type: "rect" | "circle" }>): WW.PhysicsColliderDef;
  getDecorImgKey(decor: Geomorph.Decor): string;
  hasInstance(
    decor: Geomorph.Decor,
  ): decor is Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle;
  query: (center: JshCli.PointAnyFormat, radius?: number, opts?: Geomorph.DecorGridQueryOpts) => Geomorph.Decor[];
  queryRect: (rect: Geom.RectJson, opts?: Geomorph.DecorGridQueryOpts) => Geomorph.Decor[];
  /** Can only remove custom decor */
  remove(...decorKeys: string[]): void;
  tintDecor(colorRep: string, ...decorKeys: string[]): void;
  removeDecorColliders(...decor: Extract<Geomorph.Decor, { type: "rect" | "circle" }>[]): void;
  setupRuntimeInstances(): void;
  writeRuntimeSlot(
    id: number,
    decor: Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle,
  ): boolean;
};

const MAX_RUNTIME_DECOR_INSTANCES = 1024;
const cuboidHeight = 0.05;
const shapeYScale = 0.001;
const shapeYHeight = 0.002;
const cuboidIconHeight = 0.005;
const tmpVect = new Vect();
const tmpRect = new Rect();
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const tmpColor = new THREE.Color();

/**
 * TSL outputNode for the top face of the box geometry.
 * - Shapes (rect/circle): dashed outline in beauty; solid fill in pick.
 * - Quads/points: use existing withPickOutput node.
 */
function buildShapeOutputNode(
  typeId: number,
  texPickOutput: THREE.Node,
  objectPick: THREE.UniformNode<"float", number>,
) {
  const sp = attribute<"vec3">("shapeParams", "vec3");
  const isShape = sp.x.greaterThan(1.5);
  const isCircle = sp.x.greaterThan(2.5);
  const dims = vec2(sp.y, sp.z);

  const uvCoord = uv();
  const edgeX = tslMin(uvCoord.x, uvCoord.x.oneMinus());
  const edgeY = tslMin(uvCoord.y, uvCoord.y.oneMinus());
  const dx = uvCoord.x.sub(0.5);
  const dy = uvCoord.y.sub(0.5);
  const dist = dx.mul(dx).add(dy.mul(dy)).sqrt();

  const BORDER_W = uniform(0.02);
  const DASH_PERIOD = uniform(0.25);

  const inBorder = (select as SelectAnyType)(
    isCircle,
    dist.greaterThan(float(0.5).sub(BORDER_W.div(dims.x.mul(2)))).and(dist.lessThan(float(0.5))),
    edgeX.lessThan(BORDER_W.div(dims.x)).or(edgeY.lessThan(BORDER_W.div(dims.y))),
  ) as THREE.Node<"bool">;

  const rectParam = (select as SelectAnyType)(
    edgeY.greaterThan(edgeX),
    uvCoord.y.mul(dims.y),
    uvCoord.x.mul(dims.x),
  ) as THREE.Node<"float">;
  const inDash = (select as SelectAnyType)(
    isCircle,
    fract(
      atan(dy, dx)
        .add(Math.PI)
        .div(Math.PI * 2)
        .mul(dims.x.mul(Math.PI * 2).div(DASH_PERIOD)),
    ).lessThan(0.5),
    fract(rectParam.div(DASH_PERIOD)).lessThan(0.5),
  ) as THREE.Node<"bool">;

  const isPicking = objectPick.notEqual(0);
  const inFill = (select as SelectAnyType)(
    isCircle,
    dist.lessThan(float(0.5)),
    float(1).greaterThan(0),
  ) as THREE.Node<"bool">;
  const pickCol = vec4(
    float(typeId / 255),
    instanceIndex.shiftRight(8).bitAnd(0xff).toFloat().div(255),
    instanceIndex.bitAnd(0xff).toFloat().div(255),
    1,
  );
  const shapeOutput = (select as SelectAnyType)(
    (select as SelectAnyType)(isPicking, inFill, inBorder.and(inDash)) as THREE.Node<"bool">,
    (select as SelectAnyType)(isPicking, pickCol, output),
    vec4(0, 0, 0, 0),
  );

  return (select as SelectAnyType)(isShape, shapeOutput, texPickOutput);
}

const plainBlackMaterial = new THREE.MeshStandardNodeMaterial({
  side: THREE.DoubleSide,
  color: "#000",
  transparent: true,
});

// used to ignore stale queryFn and trigger fresh one
import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("Decor.tsx"));
  if (import.meta.hot && updatedThisFile) {
    import.meta.hot.data.__JUST_HMR_DECOR__ = true;
  }
});

const defaultDecorQueryRadius = 0.5;
