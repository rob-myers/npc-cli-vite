import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { geomService, Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { attribute, select, texture, uv, vec2, vec4 } from "three/tsl";
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
import { addToDecorGrid } from "../service/grid";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import type { SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Decor() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      box: createUnitBox(),
      byKey: {},
      gdKeyToInstanceId: {}, // door related
      grid: {},
      instanceIdToDecorId: [], // static decor needn't have an instance
      lastHmr: 0,
      ready: false, // also false briefly after hmr

      inst: null as any,
      materials: [],
      runtimeMaterials: [],
      uvOffsets: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_DECOR_QUAD_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_DECOR_QUAD_INSTANCES),
      isPoint: new Float32Array(MAX_DECOR_QUAD_INSTANCES),

      instRuntime: null as any,
      runtime: {
        box: createUnitBox(),
        byKey: {},
        uvOffsets: new Float32Array(MAX_RUNTIME_DECOR_INSTANCES * 2),
        uvDimensions: new Float32Array(MAX_RUNTIME_DECOR_INSTANCES * 2),
        uvTextureIds: new Uint32Array(MAX_RUNTIME_DECOR_INSTANCES),
        isPoint: new Float32Array(MAX_RUNTIME_DECOR_INSTANCES),
        decorKeyToId: {} as Record<string, number>,
        idToDecorKey: [] as string[],
        count: 0,
      },

      addRuntimeInstance(decor) {
        const inst = state.instRuntime;
        if (!inst || !w.sheets || state.materials.length === 0) return;
        const id = state.runtime.count;
        if (id >= MAX_RUNTIME_DECOR_INSTANCES || !state.writeRuntimeSlot(id, decor)) return;
        state.runtime.decorKeyToId[decor.key] = id;
        state.runtime.idToDecorKey[id] = decor.key;
        state.runtime.count++;
        inst.count = state.runtime.count;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        state.runtime.box.getAttribute("uvOffsets").needsUpdate = true;
        state.runtime.box.getAttribute("uvDimensions").needsUpdate = true;
        state.runtime.box.getAttribute("uvTextureIds").needsUpdate = true;
        state.runtime.box.getAttribute("isPoint").needsUpdate = true;
      },
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
              det: Math.sign(matrix.a * matrix.d - matrix.b * matrix.c),
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
          default: {
            throw new ExhaustiveError(def);
          }
        }

        if (state.ensureGmRoomId(d) !== null) {
          addToDecorGrid(d, state.grid);
        }

        state.byKey[d.key] = d;
        state.runtime.byKey[d.key] = d;
        if (state.hasInstance(d)) state.addRuntimeInstance(d);

        return d;
      },
      decodeInstanceId(instanceId) {
        const entry = state.instanceIdToDecorId[instanceId];
        if (!entry) return null;
        const item = w.gms[entry.gmId]?.decor[entry.decorId];
        return item ? { ...item.meta } : null;
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
      getDecorImgKey(d) {
        if (d.type === "quad" || d.type === "point") return d.meta.img ?? decorKeyFallback;
        return decorKeyFallback;
      },
      hasInstance(decor): decor is Geomorph.DecorPoint | Geomorph.DecorQuad {
        return decor.type === "quad" || (decor.type === "point" && decor.meta.shown === true);
      },
      remove(...decorKeys) {
        const runtime = state.runtime;
        const inst = state.instRuntime;
        if (!inst) return;

        for (const decorKey of decorKeys) {
          if (!runtime.byKey[decorKey]) {
            if (decorKey in state.byKey) warn(`cannot remove static decor: ${decorKey}`);
            continue;
          }

          delete runtime.byKey[decorKey];
          delete state.byKey[decorKey];
          const id = runtime.decorKeyToId[decorKey];
          delete runtime.decorKeyToId[decorKey];
          if (id === undefined) {
            continue;
          }

          const lastId = runtime.count - 1;
          if (id !== lastId) {
            // swap last decor into removed slot
            const lastKey = runtime.idToDecorKey[lastId];
            const lastDecor = runtime.byKey[lastKey] as Geomorph.DecorPoint | Geomorph.DecorQuad;
            state.writeRuntimeSlot(id, lastDecor);
            runtime.decorKeyToId[lastKey] = id;
            runtime.idToDecorKey[id] = lastKey;
          }

          runtime.count--;
          // inst.count = runtime.count;
          inst.setMatrixAt(lastId, zeroMat4);

          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          runtime.box.getAttribute("uvOffsets").needsUpdate = true;
          runtime.box.getAttribute("uvDimensions").needsUpdate = true;
          runtime.box.getAttribute("uvTextureIds").needsUpdate = true;
          runtime.box.getAttribute("isPoint").needsUpdate = true;
        }

        w.view.forceUpdate();
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
      updateRuntimeInstances() {
        const inst = state.instRuntime;
        if (!inst || !w.sheets || state.materials.length === 0) return;
        state.runtime.decorKeyToId = {};
        state.runtime.idToDecorKey = [];
        let id = 0;
        for (const decor of Object.values(state.runtime.byKey)) {
          if (!state.hasInstance(decor) || id >= MAX_RUNTIME_DECOR_INSTANCES) continue;
          if (state.writeRuntimeSlot(id, decor)) {
            state.runtime.decorKeyToId[decor.key] = id;
            state.runtime.idToDecorKey[id] = decor.key;
            id++;
          }
        }
        state.runtime.count = id;
        inst.count = id;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        state.runtime.box.getAttribute("uvOffsets").needsUpdate = true;
        state.runtime.box.getAttribute("uvDimensions").needsUpdate = true;
        state.runtime.box.getAttribute("uvTextureIds").needsUpdate = true;
        state.runtime.box.getAttribute("isPoint").needsUpdate = true;
      },
      writeRuntimeSlot(id, decor) {
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
          state.runtime.uvOffsets.set([offX + dimX * k, offY + dimY * k], id * 2);
          state.runtime.uvDimensions.set([dimX * (1 - 2 * k), dimY * (1 - 2 * k)], id * 2);
        } else {
          const dimX = entry.rect.width / dims.width;
          const dimY = entry.rect.height / dims.height;
          const offX = entry.rect.x / dims.width;
          const offY = entry.rect.y / dims.height;
          state.runtime.uvOffsets.set([offX + dimX * k, offY + dimY * k], id * 2);
          state.runtime.uvDimensions.set([dimX * (1 - 2 * k), dimY * (1 - 2 * k)], id * 2);
        }
        state.runtime.uvTextureIds[id] = entry.sheetId;

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
        state.runtime.isPoint[id] = decor.type === "point" ? 1 : 0;
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
          const imgKey = state.getDecorImgKey(item);
          const entry = w.sheets.decor[imgKey] as DecorSheetEntry | undefined;
          if (!entry) {
            warn(`decor "${imgKey}" not found in sheets.json`);
            uvIdx++;
            continue;
          }
          const dims = w.sheets.decorSheetDims[entry.sheetId];
          if (!dims) continue;

          // fix flipped decor
          if (item.det === -1) {
            state.uvOffsets.set(
              [(entry.rect.x + entry.rect.width) / dims.width, entry.rect.y / dims.height],
              uvIdx * 2,
            );
            state.uvDimensions.set([-entry.rect.width / dims.width, entry.rect.height / dims.height], uvIdx * 2);
          } else {
            state.uvOffsets.set([entry.rect.x / dims.width, entry.rect.y / dims.height], uvIdx * 2);
            state.uvDimensions.set([entry.rect.width / dims.width, entry.rect.height / dims.height], uvIdx * 2);
          }
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
              // build gdKey -> instances
              (state.gdKeyToInstanceId[gdKey] ??= []).push(instanceId);
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

          state.isPoint[instanceId] = decor.type === "point" ? 1 : 0;
          state.instanceIdToDecorId[instanceId] = { gmId, decorId };
          instanceId++;
        }
      }
      state.inst.count = instanceId;
      state.inst.computeBoundingSphere();

      await pause(100);

      // 5. build state.byKey, grid, enrich decor.meta
      // - applies to all decor not only those with an instancedMesh instance
      // - preserve runtime decor across HMR
      state.byKey = { ...state.runtime.byKey };
      state.clearGrid();

      // 🚧 move to separate query
      for (const runtimeDecor of Object.values(state.runtime.byKey)) {
        runtimeDecor.meta.roomId = -1; // force recompute
        if (state.ensureGmRoomId(runtimeDecor) !== null) {
          addToDecorGrid(runtimeDecor, state.grid);
        }
      }

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
      geo.getAttribute("isPoint").needsUpdate = true;
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

      const texMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true });
      texMat.colorNode = texNode.mul(vec4(0.4, 0.4, 0.4, 1)); // preserve alpha
      texMat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.decor);

      // transparent icon can be hard to pick so permit pick any place on cuboid
      // hide black faces for point instances (they're flat — sides add no value)
      const isPointAttr = attribute<"float">("isPoint", "float");
      plainBlackMaterial.outputNode = (select as SelectAnyType)(
        isPointAttr.greaterThan(0.5),
        vec4(0, 0, 0, 0),
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.decor),
      );

      const runtimeTexMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true });
      runtimeTexMat.colorNode = texNode.mul(vec4(0.4, 0.4, 0.4, 1));
      runtimeTexMat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.runtimeDecor);

      const runtimeBlackMat = new THREE.MeshStandardNodeMaterial({
        side: THREE.DoubleSide,
        color: "#000",
        transparent: true,
      });
      runtimeBlackMat.outputNode = (select as SelectAnyType)(
        isPointAttr.greaterThan(0.5),
        vec4(0, 0, 0, 0),
        w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.runtimeDecor),
      );

      state.ready = true;
      w.setNextPending({ decor: false });

      return {
        static: [
          plainBlackMaterial,
          plainBlackMaterial,
          texMat,
          plainBlackMaterial,
          plainBlackMaterial,
          plainBlackMaterial,
        ],
        runtime: [runtimeBlackMat, runtimeBlackMat, runtimeTexMat, runtimeBlackMat, runtimeBlackMat, runtimeBlackMat],
      };
    },
    enabled: !!w.hash && !!w.sheets && !w.pending.nav && w.gms.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  state.materials = materials?.static ?? state.materials;
  state.runtimeMaterials = materials?.runtime ?? state.runtimeMaterials;

  useEffect(() => {
    state.updateRuntimeInstances();
  }, [materials]);

  return (
    <>
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
          <instancedBufferAttribute attach="attributes-isPoint" args={[state.isPoint, 1]} />
        </bufferGeometry>
      </instancedMesh>

      <instancedMesh
        name="runtime-decor"
        ref={state.ref("instRuntime")}
        args={[undefined, undefined, MAX_RUNTIME_DECOR_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.runtimeMaterials}
        visible={state.runtimeMaterials.length > 0}
      >
        <bufferGeometry
          attributes={state.runtime.box.attributes}
          index={state.runtime.box.index}
          groups={state.runtime.box.groups}
        >
          <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.runtime.uvOffsets, 2]} />
          <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.runtime.uvDimensions, 2]} />
          <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.runtime.uvTextureIds, 1]} />
          <instancedBufferAttribute attach="attributes-isPoint" args={[state.runtime.isPoint, 1]} />
        </bufferGeometry>
      </instancedMesh>
    </>
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
  runtimeMaterials: THREE.MeshStandardNodeMaterial[];
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  isPoint: Float32Array;

  instRuntime: THREE.InstancedMesh;
  runtime: {
    byKey: Record<string, Geomorph.Decor>;
    box: THREE.BufferGeometry;
    uvOffsets: Float32Array;
    uvDimensions: Float32Array;
    uvTextureIds: Uint32Array;
    isPoint: Float32Array;
    decorKeyToId: Record<string, number>;
    idToDecorKey: string[];
    count: number;
  };

  clearGrid(): void;
  create(def: Geomorph.DecorDef): Geomorph.Decor;
  decodeInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  decodeRuntimeInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  getDecorImgKey(decor: Geomorph.Decor): string;
  ensureGmRoomId(d: Geomorph.Decor): Geomorph.GmRoomId | null;
  hasInstance(decor: Geomorph.Decor): decor is Geomorph.DecorPoint | Geomorph.DecorQuad;
  /** Can only remove custom decor */
  remove(...decorKeys: string[]): void;
  tintInstances(colorRep: string, ...instanceIds: number[]): void;
  /** 🚧 support Geomorph.DecorCircle, Geomorph.DecorRect */
  writeRuntimeSlot(id: number, decor: Geomorph.DecorPoint | Geomorph.DecorQuad): boolean;
  addRuntimeInstance(decor: Geomorph.DecorPoint | Geomorph.DecorQuad): void;
  updateRuntimeInstances(): void;
};

const MAX_RUNTIME_DECOR_INSTANCES = 1024;
const cuboidHeight = 0.05;
const cuboidIconHeight = 0.005;
const tmpVect = new Vect();
const tmpRect = new Rect();
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const tmpColor = new THREE.Color();
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
