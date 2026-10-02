import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { atan, attribute, float, fract, int, texture, min as tslMin, uniform, uv, vec2, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  decorKeyFallback,
  decorPointDefaultRadius,
  decorPointKeyFallback,
  lockedDoorTint,
  MAX_DECOR_QUAD_INSTANCES,
  precision,
  sguToWorldScale,
  unlockedDoorTint,
} from "../const.env";
import {
  createUnitBox,
  createXzQuad,
  embedXZMat4,
  getRotAxisMatrix,
  setRotMatrixAboutPoint,
} from "../service/geometry";
import { addToDecorGrid, queryDecorGridRect, removeFromDecorGrid } from "../service/grid";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import { bootstrapInstanceColor } from "../service/texture";
import { selectAs } from "../service/tsl";
import { WorldContext } from "./world-context";

export default function Decor() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: {},
      buildId: 0,
      byRoom: [],
      grid: {},
      lastHmr: 0,
      ready: false,

      // assigned rather than spread: a batch's `ref` writes to the batch itself
      static: Object.assign(createTexBatch(MAX_DECOR_QUAD_INSTANCES), { gdKeyToDecorKeys: {} }),
      staticShapes: createShapeBatch(MAX_DECOR_QUAD_INSTANCES),
      runtime: Object.assign(createTexBatch(MAX_RUNTIME_DECOR_INSTANCES), { byKey: {}, defByKey: {} }),
      runtimeShapes: createShapeBatch(MAX_RUNTIME_DECOR_INSTANCES),

      addDecorColliders(...decorDefs) {
        w.physics.worker.postMessage({
          type: "add-physics-colliders",
          colliders: decorDefs.map(state.getColliderDefFromDecorDef),
        } satisfies WW.MsgToWorker);
      },
      addRuntimeDecorAgain() {
        for (const runtimeDecor of Object.values(state.runtime.byKey)) {
          runtimeDecor.meta.roomId = -1; // force recompute
          if (state.ensureGmRoomId(runtimeDecor) !== null) {
            addToDecorGrid(runtimeDecor, state.grid);
            state.groupByRoom(runtimeDecor);
          } else {
            /** now outside any room */
          }
        }
      },
      addRuntimeInstance(decor) {
        if (!state.runtime.inst || !w.sheets || state.runtime.materials.length === 0) return;
        if (state.pushInstance(decor, true)) state.flush(state.batchOf(true, isShape(decor)));
      },
      batchOf(runtime, shape) {
        if (runtime) return shape ? state.runtimeShapes : state.runtime;
        return shape ? state.staticShapes : state.static;
      },
      clearBatch(batch) {
        batch.decorKeyToId = {};
        batch.idToDecorKey = [];
        batch.count = 0;
      },
      flush(batch) {
        const { inst } = batch;
        inst.count = batch.count;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        for (const attr of Object.values(batch.geo.attributes)) {
          if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute === true) attr.needsUpdate = true;
        }
      },
      pushInstance(decor, runtime) {
        const batch = state.batchOf(runtime, isShape(decor));
        const id = batch.count;
        if (id >= batch.inst.instanceMatrix.count) {
          warn(`cannot add decor ${decor.key}: capacity exceeded`);
          return false;
        }
        if (state.writeSlot(id, decor, runtime) === false) {
          warn(`cannot add decor ${decor.key}: "${state.getDecorImgKey(decor)}" not found in sheets.json`);
          return false;
        }
        batch.decorKeyToId[decor.key] = id;
        batch.idToDecorKey[id] = decor.key;
        batch.count++;
        return true;
      },
      writeRoomSlot(slots, id, decor) {
        const { gmId, roomId } = decor.meta;
        const slot =
          typeof gmId === "number" && typeof roomId === "number" && roomId >= 0
            ? slotOf(gmId, roomId)
            : alwaysShownSlot;
        slots[id * 2] = slot;
        slots[id * 2 + 1] = slot;
      },
      clearGridAndRoomLookup() {
        Object.values(state.grid).forEach((col) => col.clear());
        state.byRoom.forEach((inner) => inner.forEach((entry) => entry?.clear()));
      },
      create(def) {
        if (state.runtime.byKey[def.key]) {
          state.remove(def.key);
        }

        // a copy: the def is kept and persisted as given, and a def made from an old decor, e.g. one
        // the Decorator moved, must not carry that decor's room along with it
        const { gmId: _g, roomId: _r, grKey: _k, ...rest } = def.meta ?? {};
        const meta = rest as Meta<Geomorph.GmRoomId>;
        meta.decor = true;
        meta.decorKey = def.key;
        if (def.type === "rect" || def.type === "circle") meta.floor = true;

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
            // half the rect's height back along its own "up". That direction is the transform's
            // second column NORMALISED: `baseRect` is measured after the transform, so its height
            // already carries the scale, and using the raw column would count it twice
            const upLength = Math.hypot(transform[2], transform[3]) || 1;
            const topCenter = center
              .clone()
              .translate(
                -((transform[2] / upLength) * baseRect.height) / 2,
                -((transform[3] / upLength) * baseRect.height) / 2,
              )
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
              def.img = decorPointKeyFallback;
            }

            const entry = w.sheets.decor[def.img ?? decorPointKeyFallback] ?? null; // drawn with the fallback, so sized by it
            const scale = def.scale ?? 1;
            const radius =
              (entry
                ? (Math.max(entry.originalWidth, entry.originalHeight) * sguToWorldScale) / 2
                : decorPointDefaultRadius) * scale;
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

            const bounds = new Rect(center.x - radius, center.y - radius, 2 * radius, 2 * radius).precision(precision); // kept: not the scratch

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
              scale,
              det: Math.sign(transform[0] * transform[3] - transform[1] * transform[2]),
            };
            break;
          }
          default:
            throw new ExhaustiveError(def);
        }

        if (state.ensureGmRoomId(d) !== null) {
          addToDecorGrid(d, state.grid);
          state.groupByRoom(d);
        }

        state.byKey[d.key] = d;
        state.runtime.byKey[d.key] = d;
        state.runtime.defByKey[d.key] = def;

        if (state.hasInstance(d)) {
          state.addRuntimeInstance(d);
        }

        if (d.meta.collider === true && (def.type === "circle" || def.type === "rect")) {
          state.addDecorColliders(def);
        }

        w.events.next({ key: "decor-created", decorKeys: [d.key] });

        return d;
      },
      decodeInstanceId(instanceId, runtime, shape) {
        const key = state.batchOf(runtime, shape).idToDecorKey[instanceId];
        const decor = key === undefined ? undefined : state.byKey[key];
        return decor ? { ...decor.meta, decorKey: key } : null;
      },
      ensureGmRoomId(decor) {
        if (!(decor.meta.gmId >= 0 && decor.meta.roomId >= 0)) {
          const decorOrigin = decor.type === "point" ? decor : decor.center;
          const gmRoomId = w.findRoomContaining(decorOrigin);
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
        if (d.type === "point") return d.meta.img ?? decorPointKeyFallback;
        if (d.type === "quad") return d.meta.img ?? decorKeyFallback;
        return decorKeyFallback;
      },
      groupByRoom(d) {
        ((state.byRoom[d.meta.gmId] ??= [])[d.meta.roomId] ??= new Set()).add(d);
      },
      hasInstance(
        decor,
      ): decor is Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle {
        return (
          decor.type === "quad" ||
          (decor.type === "point" && decor.meta.shown === true) ||
          (decor.type === "rect" && decor.meta.shown === true) ||
          (decor.type === "circle" && decor.meta.shown === true) ||
          // whilst decorating, runtime decor is drawn whether it is meant to show or not
          (w.debug?.decorShown === true && decor.key in state.runtime.byKey)
        );
      },
      rename(decorKey, next) {
        const def = state.runtime.defByKey[decorKey];
        if (def === undefined || next === "" || next === decorKey || next in state.byKey) return false;
        state.remove(decorKey);
        state.create({ ...def, key: next });
        return true;
      },
      queryPoint(center, opts) {
        const groundPoint = helper.parseGroundPoint(center);
        const radius = opts?.radius ?? 0.05;
        tmpRect.set(groundPoint.x - radius, groundPoint.y - radius, radius * 2, radius * 2);

        const results = queryDecorGridRect(state.grid, tmpRect, opts).filter((d) => {
          switch (d.type) {
            case "rect":
              return geomService.outlineProperlyContains(
                Array.isArray(d.meta.refinedOutline) ? d.meta.refinedOutline : d.points,
                groundPoint,
              );
            case "circle":
              return Math.hypot(groundPoint.x - d.center.x, groundPoint.y - d.center.y) < d.radius;
            default:
              return d.bounds.contains(groundPoint);
          }
        });

        const desiredHeight = opts?.restrictByHeight;

        if (desiredHeight === undefined || results.length <= 1) {
          return results;
        }

        // further restrict by height i.e. singleton closest to desiredHeight
        let closestDelta = Infinity;
        return [
          results.reduce((agg, d) => {
            const delta = Math.abs((d.meta.y ?? 0) - desiredHeight);
            return delta >= closestDelta ? agg : ((closestDelta = delta), d);
          }, results[0]),
        ];
      },
      queryRect(rect, opts) {
        return queryDecorGridRect(state.grid, rect, opts);
      },
      remove(...decorKeys) {
        const runtime = state.runtime;
        if (!runtime.inst) return;

        const removed = [] as string[];
        for (const decorKey of decorKeys) {
          const d = runtime.byKey[decorKey];
          if (!d) {
            decorKey in state.byKey && warn(`cannot remove static decor: ${decorKey}`);
            continue;
          }
          removed.push(decorKey);

          removeFromDecorGrid(d, state.grid);
          delete runtime.byKey[decorKey];
          delete runtime.defByKey[decorKey];
          delete state.byKey[decorKey];
          state.byRoom[d.meta.gmId]?.[d.meta.roomId]?.delete(d);

          const batch = state.batchOf(true, isShape(d));
          const id = batch.decorKeyToId[decorKey];
          if (id === undefined) {
            continue;
          }
          delete batch.decorKeyToId[decorKey];

          const lastId = batch.count - 1;
          if (id !== lastId) {
            // swap last decor into removed slot
            const lastKey = batch.idToDecorKey[lastId];
            state.writeSlot(id, runtime.byKey[lastKey], true);
            batch.decorKeyToId[lastKey] = id;
            batch.idToDecorKey[id] = lastKey;
          }

          batch.idToDecorKey.length = --batch.count;
          batch.inst.setMatrixAt(lastId, zeroMat4);
          state.flush(batch);

          if (d.meta.collider === true && (d.type === "circle" || d.type === "rect")) {
            state.removeDecorColliders(d); // 🚧 prefer batch
          }
        }

        if (removed.length > 0) {
          w.events.next({ key: "decor-removed", decorKeys: removed });
        }

        w.view.forceUpdate();
      },
      removeDecorColliders(...decor) {
        w.physics.worker.postMessage({
          type: "remove-physics-colliders",
          colliders: decor.map(({ key, type }) => ({ colliderKey: key, type })),
        } satisfies WW.MsgToWorker);
      },
      setupRuntimeInstances() {
        if (!state.runtime.inst || !w.sheets || state.runtime.materials.length === 0) {
          return;
        }
        const batches = [state.runtime, state.runtimeShapes];
        batches.forEach(state.clearBatch);
        for (const decor of Object.values(state.runtime.byKey)) {
          if (state.hasInstance(decor)) state.pushInstance(decor, true);
        }
        batches.forEach(state.flush);
      },
      tintDecor(colorRep, ...decorKeys) {
        const batches = [state.runtime, state.runtimeShapes, state.static, state.staticShapes];
        for (const decorKey of decorKeys) {
          const batch = batches.find((x) => decorKey in x.decorKeyToId);
          batch?.inst.setColorAt(batch.decorKeyToId[decorKey], tmpColor.set(colorRep));
        }
        for (const { inst } of batches) {
          if (inst?.instanceColor) inst.instanceColor.needsUpdate = true;
        }
        if (w.disabled) w.view.forceUpdate();
      },
      writeSlot(id, decor, runtime) {
        if (isShape(decor)) {
          const batch = runtime ? state.runtimeShapes : state.staticShapes;
          state.writeRoomSlot(batch.roomSlots, id, decor);
          state.writeShape(batch, id, decor, runtime);
          return true;
        }
        const batch = runtime ? state.runtime : state.static;
        state.writeRoomSlot(batch.roomSlots, id, decor);
        return state.writeTextured(batch, id, decor);
      },
      writeShape(batch, id, decor, runtime) {
        const y = { yHeight: shapeY, mat4: tmpMat4 };
        if (decor.type === "rect") {
          const along01 = decor.points[0].distanceTo(decor.points[1]);
          const along12 = decor.points[1].distanceTo(decor.points[2]);
          const [w0, h0] = runtime ? [along12, along01] : [along01, along12];
          const cos = Math.cos(decor.angle);
          const sin = Math.sin(decor.angle);
          //biome-ignore format: preserve newlines
          batch.inst.setMatrixAt(id, embedXZMat4(
            { a: w0*cos, b: w0*sin, c: -h0*sin, d: h0*cos,
              e: decor.center.x - w0/2*cos + h0/2*sin,
              f: decor.center.y - w0/2*sin - h0/2*cos },
            y,
          ));
          batch.shapeParams.set([0, w0, h0], id * 3);
        } else {
          const r = decor.radius;
          //biome-ignore format: preserve newlines
          batch.inst.setMatrixAt(id, embedXZMat4(
            { a: 2*r, b: 0, c: 0, d: 2*r, e: decor.center.x - r, f: decor.center.y - r },
            y,
          ));
          batch.shapeParams.set([1, r, r], id * 3);
        }
        batch.inst.setColorAt(id, tmpColor.set(decor.meta.color ?? "#00ff88"));
      },
      writeTextured(batch, id, decor) {
        const entry = w.sheets?.decor[state.getDecorImgKey(decor)];
        const dims = entry === undefined ? undefined : w.sheets?.decorSheetDims[entry.sheetId];
        if (!entry || !dims) return false;

        // a flipped decor reads its image right to left; the sheet goes in `offY`'s integer part
        const k = typeof decor.meta.inset === "number" ? decor.meta.inset : 0;
        const flipped = decor.det === -1;
        const dimX = ((flipped ? -1 : 1) * entry.rect.width) / dims.width;
        const dimY = entry.rect.height / dims.height;
        const offX = (entry.rect.x + (flipped ? entry.rect.width : 0)) / dims.width;
        const offY = entry.rect.y / dims.height;
        batch.uvData.set(
          [offX + dimX * k, offY + dimY * k + entry.sheetId, dimX * (1 - 2 * k), dimY * (1 - 2 * k)],
          id * 4,
        );

        tmpMat.setMatrixValue(decor.transform);
        if (decor.type === "quad") {
          // e.g. key=switch and screen
          const shouldTilt = decor.meta.tilt === true;
          let tiltMat4: THREE.Matrix4 | null = null;
          if (shouldTilt) {
            const { a, b, c, d } = tmpMat;
            // NORMALISED: `makeRotationAxis` takes a unit axis, and this one is a column of the
            // decor's own transform — so a scaled decor would hand it a longer vector, and what
            // came back would not be a rotation at all
            const axisLength = Math.hypot(a, b) || 1;
            tiltMat4 = getRotAxisMatrix(a / axisLength, 0, b / axisLength, (a * d - b * c > 0 ? 1 : -1) * 90);
            setRotMatrixAboutPoint(tiltMat4, decor.topCenter.x, decor.meta.y, decor.topCenter.y);
          }
          //biome-ignore format: preserve newlines
          tmpMat.preMultiply([ entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);
          // meta.y is top and meta.h is height (unsupported for tilt)
          const yScale = decor.meta.h ?? cuboidHeight;
          //biome-ignore format: preserve newlines
          const mat4 = embedXZMat4(tmpMat, { yScale, yHeight: (decor.meta.y ?? 0) + (shouldTilt ? 0 : -yScale), mat4: tmpMat4 });
          if (tiltMat4) mat4.premultiply(tiltMat4);
          batch.inst.setMatrixAt(id, mat4);
        } else {
          // a flat face-up quad
          const s = decor.scale * sguToWorldScale;
          //biome-ignore format: preserve newlines
          tmpMat.preMultiply([ entry.originalWidth * s, 0, 0, entry.originalHeight * s, 0, 0]);
          //biome-ignore format: preserve newlines
          batch.inst.setMatrixAt(id, embedXZMat4(tmpMat, { yScale: cuboidIconHeight, yHeight: (decor.meta.y ?? 0) + cuboidIconHeight, mat4: tmpMat4 }));
        }
        batch.inst.setColorAt(id, tmpColor.set(decor.meta.tint ?? "#ffffff"));
        batch.isPoint[id] = decor.type === "point" ? 1 : 0;
        return true;
      },
    }),
  );

  w.decor = state;

  const { data: materials } = useQuery({
    // 🔔 force recompute decor mutations on run world query
    queryKey: [
      "decor-setup",
      // the queryFn draws into THIS world's `texDecor` — two worlds on one map must not share
      w.key,
      w.mapKey,
      w.gmsHash,
      w.texDecor.hash,
      state.lastHmr,
      w.lastQuery,
      w.view.playerLight.uid,
      w.view.fadeRoomsFx.uid,
    ],
    async queryFn() {
      if (import.meta.hot?.data.__JUST_HMR_DECOR__) {
        import.meta.hot.data.__JUST_HMR_DECOR__ = false;
        state.set({ lastHmr: Date.now() });
        return null; // ignore 1st stale invoke after HMR
      }

      if (!w.sheets) return null;
      w.setNextPending({ decor: true });
      const buildId = ++state.buildId;

      // 1. load sheet images ⏳
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

      // 3. build `state.byKey`, `state.grid`, enrich decor.meta
      // - for all decor, not only those with an instancedMesh instance
      // - preserves runtime decor across HMR
      // - obstacles induce decor rects with `d.meta.gridOutline`
      state.byKey = { ...state.runtime.byKey };
      state.clearGridAndRoomLookup();
      state.addRuntimeDecorAgain();

      const metaPoint = { x: 0, y: 0, meta: {} as Meta };

      for (const [gmId, gm] of w.gms.entries()) {
        for (const decor of gm.decor) {
          metaPoint.x = decor.type === "point" ? decor.x : decor.center.x;
          metaPoint.y = decor.type === "point" ? decor.y : decor.center.y;
          metaPoint.meta = decor.meta;
          const gmRoomId = w.findRoomContaining(metaPoint, true);
          Object.assign(decor.meta, gmRoomId);

          // rename periods because used as delimiter in CLI
          decor.key = `g${gmId}r${decor.meta.roomId ?? "?"}-${decor.type}-${`${metaPoint.x}-${decor.meta.y ?? 0}-${metaPoint.y}`.replace(/\./g, "_")}`;
          state.byKey[decor.key] = decor;
          decor.meta.decorKey = decor.key;
          // add even when gmRoomId null
          addToDecorGrid(decor, state.grid);
          state.groupByRoom(decor);
        }

        // careful with obstacle coordinate systems:
        // - obstacle.center in geomorph coords (not world yet)
        // - obstacle.origPoly in geomorph symbol coords (not geomorph yet)
        for (const [obstacleId, obs] of gm.obstacles.entries()) {
          metaPoint.x = obs.center.x;
          metaPoint.y = obs.center.y;
          gm.matrix.transformPoint(tmpVect.copy(obs.center));
          metaPoint.meta = emptyMeta;
          const gmRoomId = w.findRoomContaining(metaPoint, true);

          Object.assign(obs.meta, gmRoomId); // store in obstacle too

          tmpMat.setMatrixValue(obs.transform).postMultiply(gm.transform);
          /** Refined outline for decor grid containment testing */
          const refinedOutline = obs.origPoly.outline.map((p) => tmpMat.transformPoint(p.clone()).precision(2));
          const bounds = Rect.fromPoints(...refinedOutline).precision(2);

          const d: Geomorph.DecorRect = {
            type: "rect",
            key: `g${gmId}r${gmRoomId?.roomId ?? "?"}-${"obstacle"}-${obstacleId}`,
            meta: {
              ...(gmRoomId ?? helper.getGmRoomId(gmId, -1)),
              ...obs.meta,
              rect: true,
              refinedOutline,
              obstacleId,
              y: obs.height, // aggregated 3D Y
            },
            // define decor rect as gridOutline aabb
            bounds,
            points: bounds.points.map((p) => p.precision(2)),
            center: bounds.center.precision(2),
            angle: 0,
          };

          state.byKey[d.key] = d;
          d.meta.decorKey = d.key;
          // add even when gmRoomId null
          addToDecorGrid(d, state.grid);
          state.groupByRoom(d);
        }
      }

      await pause(100);

      // 4. write instances
      state.static.gdKeyToDecorKeys = {};
      for (const batch of [state.static, state.staticShapes]) {
        state.clearBatch(batch);
        batch.inst.instanceMatrix.array.fill(0);
      }

      for (const [gmId, gm] of w.gms.entries()) {
        for (const decor of gm.decor) {
          if (!state.hasInstance(decor) || !state.pushInstance(decor, false)) {
            continue;
          }
          if (decor.type === "quad" && typeof decor.meta.doorId === "number") {
            // e.g. a switch, tinted by whether its door is locked
            const gdKey: Geomorph.GmDoorKey = `g${gmId}d${decor.meta.doorId}`;
            (state.static.gdKeyToDecorKeys[gdKey] ??= []).push(decor.key);
            const locked = w.door.byKey[gdKey]?.locked === true;
            state.tintDecor(locked ? lockedDoorTint : unlockedDoorTint, decor.key);
          }
        }
      }

      for (const batch of [state.static, state.staticShapes]) {
        state.flush(batch);
        batch.inst.computeBoundingSphere();
      }

      await pause(100);

      // 5. build materials
      const uvDataAttr = attribute<"vec4">("uvData", "vec4");
      // flip V: DataArrayTexture data is top-to-bottom but BoxGeometry +Y face has v=0 at bottom
      const flippedUv = vec2(uv().x, uv().y.oneMinus());
      const transformedUv = flippedUv
        .mul(vec2(uvDataAttr.z, uvDataAttr.w))
        .add(vec2(uvDataAttr.x, uvDataAttr.y.fract()));
      const texNode = texture(w.texDecor.tex, transformedUv);
      texNode.depthNode = int(uvDataAttr.y.floor()); // decode sheetId

      // decor stands in one room, so both components of `roomSlots` carry it and `.x` will do
      const fade = w.view.fadeRoomsFx.getVisiblity(attribute<"vec2">("roomSlots", "vec2").x);
      // `1` outside `sight`, which alone takes hidden decor to the fade's `shade`
      const shown = fade.max(w.view.fadeRoomsFx.sightNode.oneMinus());
      /** Absent until the floor's art is there, so decor arrives with the unfold — see `Floor.fadeTo` */
      const arrived = w.floor.fade.texAmount;

      /** Shaded at the OUTPUT: `colorNode` is albedo alone, which specular survives. Not whilst picking */
      const shadeWhenHidden = (node: THREE.Node) =>
        selectAs<"vec4">(
          w.view.objectPick.notEqual(0),
          node,
          vec4(
            w.view.fadeRoomsFx.fadeRgb((node as THREE.Node<"vec4">).rgb, shown),
            (node as THREE.Node<"vec4">).a.mul(arrived),
          ),
        );

      /**
       * Tinted by what the player can see from where they stand — see `service/player-light` —
       * and unpickable whilst its room is hidden, so a click reaches the floor behind it
       */
      const lit = (color: THREE.Node<"vec4">) =>
        w.view.fadeRoomsFx.dropPickWhenHidden(
          w.view.fadeRoomsFx.applyFadeRgba(w.view.playerLight.applyLightRgba(color), fade),
          fade,
          w.view.objectPick,
        );

      // one draw, not two: it writes depth and discards by `alphaTest`, so back and front need no ordering
      const createMaterial = () =>
        new THREE.MeshStandardNodeMaterial({
          side: THREE.DoubleSide,
          forceSinglePass: true,
          transparent: true,
          alphaTest,
        });

      /** A cuboid's sides, then its top — see `createUnitBox` */
      const createTexMaterials = (typeId: number) => {
        // black either way: the fade only takes them out of the pick. A point has none
        const sides = createMaterial();
        sides.color.set("#000");
        sides.opacityNode = w.view.fadeRoomsFx.dropPickWhenHidden(float(1), fade, w.view.objectPick);
        sides.outputNode = shadeWhenHidden(
          selectAs(
            attribute<"float">("isPoint", "float").greaterThan(0.5),
            vec4(0, 0, 0, 0),
            w.view.withPickOutput(typeId),
          ),
        );
        const top = createMaterial();
        top.colorNode = lit(texNode.mul(vec4(0.4, 0.4, 0.4, 1)));
        // opaque, else blending scrambles the id — and a transparent icon is hard to pick
        top.outputNode = shadeWhenHidden(w.view.withPickOutput(typeId, 1));
        return [sides, top];
      };

      const createShapeMaterial = (typeId: number) => {
        const material = createMaterial();
        material.colorNode = lit(vec4(1, 1, 1, 1)); // white, so `output` carries the instance colour
        material.outputNode = shadeWhenHidden(
          buildShapeOutputNode(w.view.withPickOutput(typeId, 1), w.view.objectPick),
        );
        return material;
      };

      // a run the map change overtook must not claim readiness: its `byKey` predates the new map,
      // and every dependant redraws off `ready` alone
      if (buildId !== state.buildId) return null;

      state.ready = true;
      w.door?.syncLockTints();
      w.events.next({ key: "decor-ready" });
      w.setNextPending({ decor: false });

      return {
        static: createTexMaterials(OBJECT_PICK_KEY_TO_RED.decor),
        staticShapes: createShapeMaterial(OBJECT_PICK_KEY_TO_RED.decorShape),
        runtime: createTexMaterials(OBJECT_PICK_KEY_TO_RED.runtimeDecor),
        runtimeShapes: createShapeMaterial(OBJECT_PICK_KEY_TO_RED.runtimeDecorShape),
      };
    },
    enabled: !!w.hash && !!w.sheets && !w.pending.nav && w.gms.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  if (materials != null) {
    state.static.materials = materials.static;
    state.staticShapes.material = materials.staticShapes;
    state.runtime.materials = materials.runtime;
    state.runtimeShapes.material = materials.runtimeShapes;
  }

  useEffect(() => {
    state.setupRuntimeInstances();
  }, [materials]);

  return (
    <>
      <instancedMesh
        name="static-decor"
        ref={state.static.ref}
        args={[state.static.geo, undefined, MAX_DECOR_QUAD_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.static.materials}
        visible={state.static.materials.length > 0}
      />
      <instancedMesh
        name="static-decor-shapes"
        ref={state.staticShapes.ref}
        args={[state.staticShapes.geo, undefined, MAX_DECOR_QUAD_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.staticShapes.material ?? undefined}
        visible={state.staticShapes.material !== null}
      />
      <instancedMesh
        name="runtime-decor"
        ref={state.runtime.ref}
        args={[state.runtime.geo, undefined, MAX_RUNTIME_DECOR_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.runtime.materials}
        visible={state.runtime.materials.length > 0}
      />
      <instancedMesh
        name="runtime-decor-shapes"
        ref={state.runtimeShapes.ref}
        args={[state.runtimeShapes.geo, undefined, MAX_RUNTIME_DECOR_INSTANCES]}
        frustumCulled={false}
        renderOrder={-2}
        material={state.runtimeShapes.material ?? undefined}
        visible={state.runtimeShapes.material !== null}
      />
    </>
  );
}

export type State = {
  byKey: Record<string, Geomorph.Decor>;
  /** Which rebuild is the current one — a superseded run bails rather than claiming `ready` */
  buildId: number;
  byRoom: (Geomorph.RoomDecor | undefined)[][];
  grid: Geomorph.DecorGrid;
  lastHmr: number;
  /** Also false briefly after HMR */
  ready: boolean;

  /** Static quads and points */
  static: TexBatch & {
    /** Static decor related to a specific door e.g. switches */
    gdKeyToDecorKeys: { [gdKey: string]: string[] };
  };
  /** Static rects and circles */
  staticShapes: ShapeBatch;
  /** Runtime quads and points */
  runtime: TexBatch & {
    byKey: Record<string, Geomorph.Decor>;
    /** The original defs, for persistence and replication — see `w.e.persistDecor` */
    defByKey: Record<string, Geomorph.DecorDef>;
  };
  /** Runtime rects and circles */
  runtimeShapes: ShapeBatch;

  addDecorColliders(...colliders: Extract<Geomorph.DecorDef, { type: "rect" | "circle" }>[]): void;
  addRuntimeDecorAgain(): void;
  addRuntimeInstance(decor: Geomorph.Decor): void;
  /** The mesh, and its bookkeeping, drawing decor of this sort */
  batchOf(runtime: boolean, shape: boolean): Batch;
  /** Forgets who is at which instance */
  clearBatch(batch: Batch): void;
  /** A batch's count and buffers onto the gpu */
  flush(batch: Batch): void;
  /** Gives `decor` the next instance of whichever mesh draws it; `false` if it could not be */
  pushInstance(decor: Geomorph.Decor, runtime: boolean): boolean;
  clearGridAndRoomLookup(): void;
  create(def: Geomorph.DecorDef): Geomorph.Decor;
  /** @param shape whether it was a rect or circle that was picked, whose ids are their own */
  decodeInstanceId(
    instanceId: number,
    runtime: boolean,
    shape: boolean,
  ): Meta<Geomorph.GmRoomId & { decorKey: string }> | null;
  ensureGmRoomId(d: Geomorph.Decor): Geomorph.GmRoomId | null;
  getColliderDefFromDecorDef(def: Extract<Geomorph.DecorDef, { type: "rect" | "circle" }>): WW.PhysicsColliderDef;
  getDecorImgKey(decor: Geomorph.Decor): string;
  groupByRoom(decor: Geomorph.Decor): void;
  hasInstance(
    decor: Geomorph.Decor,
  ): decor is Geomorph.DecorPoint | Geomorph.DecorQuad | Geomorph.DecorRect | Geomorph.DecorCircle;
  /**
   * Find decor containing `point`, possibly using `d.meta.refinedOutline`.
   */
  queryPoint: (
    point: JshCli.PointAnyFormat,
    opts?: Geomorph.DecorGridQueryOpts & {
      /** Return at most one item i.e. closest by height (meters) */
      restrictByHeight?: number;
      radius?: number;
    },
  ) => Geomorph.Decor[];
  queryRect: (rect: Geom.RectJson, opts?: Geomorph.DecorGridQueryOpts) => Geomorph.Decor[];
  /** Can only remove custom decor */
  remove(...decorKeys: string[]): void;
  /** Runtime decor only; `false` when there is none such, or `next` is taken */
  rename(decorKey: string, next: string): boolean;
  tintDecor(colorRep: string, ...decorKeys: string[]): void;
  removeDecorColliders(...decor: Extract<Geomorph.Decor, { type: "rect" | "circle" }>[]): void;
  setupRuntimeInstances(): void;
  /** Writes where a decor stands into `slots`, both components alike */
  writeRoomSlot(slots: Float32Array, id: number, decor: Geomorph.Decor): void;
  /** Writes `decor` at `id` of whichever mesh draws it; `false` if it has no image to draw */
  writeSlot(id: number, decor: Geomorph.Decor, runtime: boolean): boolean;
  /** @param runtime a def's points run down its height first, a symbol's along its width */
  writeShape(batch: ShapeBatch, id: number, decor: Geomorph.DecorRect | Geomorph.DecorCircle, runtime: boolean): void;
  writeTextured(batch: TexBatch, id: number, decor: Geomorph.DecorPoint | Geomorph.DecorQuad): boolean;
};

type Batch = {
  /** `null` until mounted, despite the type */
  inst: THREE.InstancedMesh;
  /** Stable, so the mesh is not re-attached every render */
  ref(inst: THREE.InstancedMesh | null): void;
  decorKeyToId: Record<string, number>;
  idToDecorKey: string[];
  count: number;
  geo: THREE.BufferGeometry;
  /** Per instance, the slot of the room the decor stands in — see `service/room-slots` */
  roomSlots: Float32Array;
};

type TexBatch = Batch & {
  /** The cuboid's sides, then its top */
  materials: THREE.MeshStandardNodeMaterial[];
  /** `[offX, offY + sheetId, dimX, dimY]` */
  uvData: Float32Array;
  /** `1` for a point, which has no sides */
  isPoint: Float32Array;
};

type ShapeBatch = Batch & {
  material: null | THREE.MeshStandardNodeMaterial;
  /** `[isCircle, width, height]`, a circle's two being its radius */
  shapeParams: Float32Array;
};

const MAX_RUNTIME_DECOR_INSTANCES = 1024;
const cuboidHeight = 0.05;
/** How far off the floor a rect or circle lies */
const shapeY = 0.003;
const cuboidIconHeight = 0.005;

/** What each of decor's instanced meshes keeps: who is at which instance, and where each stands */
function createBatch(geo: THREE.BufferGeometry, max: number): Batch {
  const roomSlots = new Float32Array(max * 2).fill(alwaysShownSlot);
  geo.setAttribute("roomSlots", new THREE.InstancedBufferAttribute(roomSlots, 2));
  const batch: Batch = {
    inst: null as unknown as THREE.InstancedMesh,
    ref(inst) {
      batch.inst = inst as THREE.InstancedMesh;
      bootstrapInstanceColor(inst);
    },
    decorKeyToId: {},
    idToDecorKey: [],
    count: 0,
    geo,
    roomSlots,
  };
  return batch;
}

/** Quads and points: a cuboid whose top carries an image off the decor sheets */
function createTexBatch(max: number): TexBatch {
  const geo = createUnitBox({ singleFaceGroup: true });
  const uvData = new Float32Array(max * 4);
  const isPoint = new Float32Array(max);
  geo.setAttribute("uvData", new THREE.InstancedBufferAttribute(uvData, 4));
  geo.setAttribute("isPoint", new THREE.InstancedBufferAttribute(isPoint, 1));
  return Object.assign(createBatch(geo, max), { materials: [], uvData, isPoint });
}

/** Rects and circles: a flat quad with a dashed outline */
function createShapeBatch(max: number): ShapeBatch {
  const geo = createXzQuad();
  const shapeParams = new Float32Array(max * 3);
  geo.setAttribute("shapeParams", new THREE.InstancedBufferAttribute(shapeParams, 3));
  return Object.assign(createBatch(geo, max), { material: null, shapeParams });
}

function isShape(decor: Geomorph.Decor): decor is Geomorph.DecorRect | Geomorph.DecorCircle {
  return decor.type === "rect" || decor.type === "circle";
}

const tmpVect = new Vect();
const tmpRect = new Rect();
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const tmpColor = new THREE.Color();
const emptyMeta = {};

/**
 * Output of a rect or circle: a dashed outline, yet a solid fill whilst picking so it can be hit.
 * @param pickOutput the pick id whilst picking, else the lit colour
 */
function buildShapeOutputNode(pickOutput: THREE.Node, objectPick: THREE.UniformNode<"float", number>) {
  const sp = attribute<"vec3">("shapeParams", "vec3");
  const isCircle = sp.x.greaterThan(0.5);
  const dims = vec2(sp.y, sp.z);

  const uvCoord = uv();
  const edgeX = tslMin(uvCoord.x, uvCoord.x.oneMinus());
  const edgeY = tslMin(uvCoord.y, uvCoord.y.oneMinus());
  const dx = uvCoord.x.sub(0.5);
  const dy = uvCoord.y.sub(0.5);
  const dist = dx.mul(dx).add(dy.mul(dy)).sqrt();

  const BORDER_W = uniform(0.02);
  const DASH_PERIOD = uniform(0.25);

  const inBorder = selectAs<"bool">(
    isCircle,
    dist.greaterThan(float(0.5).sub(BORDER_W.div(dims.x.mul(2)))).and(dist.lessThan(float(0.5))),
    edgeX.lessThan(BORDER_W.div(dims.x)).or(edgeY.lessThan(BORDER_W.div(dims.y))),
  );

  // dashed along the nearer edge, nearer in world units: in uv a thin rect's ends would take the short axis
  const rectParam = selectAs<"float">(
    edgeY.mul(dims.y).greaterThan(edgeX.mul(dims.x)),
    uvCoord.y.mul(dims.y),
    uvCoord.x.mul(dims.x),
  );
  const inDash = selectAs<"bool">(
    isCircle,
    fract(
      atan(dy, dx)
        .add(Math.PI)
        .div(Math.PI * 2)
        .mul(dims.x.mul(Math.PI * 2).div(DASH_PERIOD)),
    ).lessThan(0.5),
    fract(rectParam.div(DASH_PERIOD)).lessThan(0.5),
  );

  const inFill = isCircle.not().or(dist.lessThan(float(0.5)));
  return selectAs(selectAs<"bool">(objectPick.notEqual(0), inFill, inBorder.and(inDash)), pickOutput, vec4(0, 0, 0, 0));
}

/**
 * Faded decor is transparent but still DEPTH WRITES, so a quad in a faded room goes on hiding what
 * is behind it — the outline of a cuboid stamped over an npc. Discarded instead, at a threshold low
 * enough that the fade reads as a fade rather than a pop
 */
const alphaTest = 0.1;

// used to ignore stale queryFn and trigger fresh one
import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("Decor.tsx"));
  if (import.meta.hot && updatedThisFile) {
    import.meta.hot.data.__JUST_HMR_DECOR__ = true;
  }
});
