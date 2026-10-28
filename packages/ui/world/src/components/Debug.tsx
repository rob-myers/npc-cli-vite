import { useStateRef } from "@npc-cli/util";
import { Rect } from "@npc-cli/util/geom";
import { pause } from "@npc-cli/util/legacy/generic";
import { useFrame } from "@react-three/fiber";
import debounce from "debounce";
import { createNavMeshHelper, type DebugObject as NavMeshHelperObject } from "navcat/three";
import { useContext, useEffect, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  positionGeometry,
  select,
  smoothstep,
  texture,
  uint,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { sguToWorldScale } from "../const.env";
import { createFloorGrid } from "../service/floor-grid";
import { createArrowGeo, createXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import { getWorldStore } from "../service/storage";
import { selectAs } from "../service/tsl";
import { MemoizedDebugPhysicsColliders } from "./DebugPhysicsColliders";
import { DecorInspector } from "./DecorInspector";
import { WorldContext } from "./world-context";

export function Debug() {
  const w = useContext(WorldContext);
  const quad = useMemo(() => createXzQuad(), []);
  const polylinesGeo = useMemo(() => {
    const geo = createXzQuad();
    // 1 for the discs, 0 for the lines joining them — see `materials.polylines`
    geo.setAttribute("isDisc", new THREE.InstancedBufferAttribute(new Float32Array(maxPolylineInstances), 1));
    // rgb, then opacity
    geo.setAttribute("lineColor", new THREE.InstancedBufferAttribute(new Float32Array(maxPolylineInstances * 4), 4));
    return geo;
  }, []);
  const decorPointsGeo = useMemo(() => {
    const geo = createXzQuad();
    geo.setAttribute("uvOffsets", new THREE.InstancedBufferAttribute(new Float32Array(maxDecorPoints * 2), 2));
    geo.setAttribute("uvDimensions", new THREE.InstancedBufferAttribute(new Float32Array(maxDecorPoints * 2), 2));
    geo.setAttribute("uvTextureIds", new THREE.InstancedBufferAttribute(new Uint32Array(maxDecorPoints), 1));
    return geo;
  }, []);
  /** Each spot's arrow: its colour, and its room's slot for the fade */
  const spotArrowsGeo = useMemo(() => {
    const geo = createOpenArrowGeo();
    geo.setAttribute("arrowInk", new THREE.InstancedBufferAttribute(new Float32Array(maxSpots * 4), 4));
    return geo;
  }, []);
  /** One interleaved buffer, a vertex buffer being scarce — see `spotStride` */
  const spotsGeo = useMemo(() => {
    const geo = createXzQuad();
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(maxSpots * spotStride), spotStride);
    geo.setAttribute("uvOffsets", new THREE.InterleavedBufferAttribute(buffer, 2, 0));
    geo.setAttribute("uvDimensions", new THREE.InterleavedBufferAttribute(buffer, 2, 2));
    geo.setAttribute("spotColor", new THREE.InterleavedBufferAttribute(buffer, 3, 4));
    geo.setAttribute("spotSlot", new THREE.InterleavedBufferAttribute(buffer, 1, 7));
    geo.setAttribute("uvTextureIds", new THREE.InterleavedBufferAttribute(buffer, 1, 8));
    geo.setAttribute("spotCentre", new THREE.InterleavedBufferAttribute(buffer, 4, 9));
    geo.setAttribute("spotShown", new THREE.InterleavedBufferAttribute(buffer, 1, 13));
    geo.setAttribute("spotSlotB", new THREE.InterleavedBufferAttribute(buffer, 1, 14));
    return Object.assign(geo, { spotBuffer: buffer });
  }, []);

  const state = useStateRef(
    (): State => ({
      arrowGeo: createArrowGeo(),
      // the instanced meshes, via `state.ref`
      boundaryInst: null as unknown as THREE.InstancedMesh,
      polylinesInst: null as unknown as THREE.InstancedMesh,
      debugPointsInst: null as unknown as THREE.InstancedMesh,
      doorNormalsInst: null as unknown as THREE.InstancedMesh,
      navPathInst: null as unknown as THREE.InstancedMesh,
      spotsInst: null as unknown as THREE.InstancedMesh,
      spotArrowsInst: null as unknown as THREE.InstancedMesh,
      debugPointInstanceIdToDecorId: [],
      spots: [],
      spotsShown: getWorldStore(w.key).read().spotsShown,
      localBoundary: [] as XZSeg[],
      polylines: new Map(),
      decorShown: getWorldStore(w.key).read().decorShown,
      doorNormalsShown: false,
      gridShown: false,
      logGPUInfo: false,
      navMeshHelper: null,
      navMeshShown: false,
      doPointsShown: false,
      originShown: false,
      pickGdkeyOpensDoors: getWorldStore(w.key).read().pickOpenDoors,
      pickDoors: getWorldStore(w.key).read().pickDoors,
      npcContextMenu: getWorldStore(w.key).read().npcContextMenu,
      hudDebug: getWorldStore(w.key).read().hudDebug,
      forceShot: null,

      physicsLines: new THREE.BufferGeometry(),
      physicsColliders: [] as (WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey })[],
      physicsCollidersShown: false,

      decodeDebugPointInstanceId(instanceId) {
        const entry = state.debugPointInstanceIdToDecorId[instanceId];
        if (!entry) return null;
        const item = w.gms[entry.gmId]?.decor[entry.decorId];
        return item ? { ...item.meta } : null;
      },
      onPhysicsDebugData(e) {
        if (e.data.type !== "physics-debug-data-response") return;
        state.physicsColliders = e.data.items;
        state.physicsLines.dispose();
        state.physicsLines = new THREE.BufferGeometry();
        state.physicsLines.setAttribute("position", new THREE.BufferAttribute(new Float32Array(e.data.lines), 3));
        state.update();
        w.view.forceUpdate();
      },
      showPhysicsColliders(shouldShow = !state.physicsCollidersShown) {
        state.set({
          physicsCollidersShown: shouldShow,
          physicsColliders: [],
          physicsLines: new THREE.BufferGeometry(),
        });
        // the listener and the first request are the effect's, below
        if (shouldShow === false) pause().then(() => w.view.forceUpdate());
      },
      updateDoorNormals() {
        const inst = state.doorNormalsInst;
        if (!inst) return;
        let count = 0;
        for (const door of Object.values(w.door?.byKey ?? [])) {
          if (count >= maxDoorNormals) break;
          const mid = { x: (door.src.x + door.dst.x) / 2, y: (door.src.y + door.dst.y) / 2 };
          const n = door.normal;
          embedXZMat4(
            { a: n.x * arrowLen, b: n.y * arrowLen, c: -n.y * arrowWidth, d: n.x * arrowWidth, e: mid.x, f: mid.y },
            { yHeight: doorNormalHeight, mat4: tmpMat4 },
          );
          inst.setMatrixAt(count++, tmpMat4);
        }
        inst.count = count;
        inst.instanceMatrix.needsUpdate = true;
      },
      updateDecorPoints() {
        const inst = state.debugPointsInst;
        if (!inst || !w.sheets || !w.decor.ready) return;
        const uvOffs = decorPointsGeo.getAttribute("uvOffsets");
        const uvDims = decorPointsGeo.getAttribute("uvDimensions");
        const uvTexIds = decorPointsGeo.getAttribute("uvTextureIds");
        state.debugPointInstanceIdToDecorId.length = 0;
        let count = 0;
        for (let gmId = 0; gmId < w.gms.length; gmId++) {
          const gm = w.gms[gmId];
          for (let decorId = 0; decorId < gm.decor.length; decorId++) {
            const decor = gm.decor[decorId];
            // 🔔 only showing decor points with meta.on
            if (decor.type !== "point" || decor.meta.on !== true) continue;
            const imgKey = w.decor.getDecorImgKey(decor);
            const entry = w.sheets.decor[imgKey];
            const dims = entry && w.sheets.maxDecorSheetDim;
            if (!entry || !dims) {
              count++;
              continue;
            }
            (uvOffs.array as Float32Array).set([entry.rect.x / dims.width, entry.rect.y / dims.height], count * 2);
            // biome-ignore format: succint
            (uvDims.array as Float32Array).set([entry.rect.width / dims.width, entry.rect.height / dims.height], count * 2);
            (uvTexIds.array as Uint32Array)[count] = entry.sheetId;
            const pw = entry.originalWidth * sguToWorldScale;
            const ph = entry.originalHeight * sguToWorldScale;
            const angle = decor.orient * (Math.PI / 180);
            const cos = Math.cos(angle),
              sin = Math.sin(angle);
            const a = cos * pw,
              b = sin * pw,
              c = -sin * ph,
              d = cos * ph;
            embedXZMat4(
              { a, b, c, d, e: decor.x - (a + c) * 0.5, f: decor.y - (b + d) * 0.5 },
              { yScale: onPointHeight, yHeight: (decor.meta.y ?? 0) + 0.01, mat4: tmpMat4 },
            );
            inst.setMatrixAt(count, tmpMat4);
            state.debugPointInstanceIdToDecorId[count] = { gmId, decorId };
            if (++count >= maxDecorPoints) break;
          }
          if (count >= maxDecorPoints) break;
        }
        inst.count = count;
        inst.instanceMatrix.needsUpdate = true;
        uvOffs.needsUpdate = uvDims.needsUpdate = uvTexIds.needsUpdate = true;
      },
      countSpots() {
        const count = state.spotsShown ? state.spots.length : 0;
        for (const inst of [state.spotsInst, state.spotArrowsInst]) if (inst) inst.count = count;
      },
      colourSpots(colors) {
        const inst = state.spotsInst;
        if (!inst) return;
        const buffer = spotsGeo.spotBuffer;
        const arrowInk = spotArrowsGeo.getAttribute("arrowInk");
        for (const [i, spot] of state.spots.entries()) {
          tmpColor.set(colors?.[spot.key] ?? spot.color).toArray(buffer.array, i * spotStride + 4);
          tmpColor.toArray(arrowInk.array, i * 4);
          buffer.array[i * spotStride + 12] = spotIconSize;
        }
        buffer.needsUpdate = arrowInk.needsUpdate = true;
      },
      setLocalBoundary(segs) {
        state.localBoundary = segs;
        state.drawBoundary();
      },
      setSpots(spots) {
        const inst = state.spotsInst;
        const dims = w.sheets?.maxDecorSheetDim;
        if (!inst || !dims) return;
        const had = state.spots.length > 0;
        state.spots = spots.slice(0, maxSpots);
        if (had !== state.spots.length > 0) w.menu?.update(); // it greys them out whilst there are none
        const data = spotsGeo.spotBuffer.array as Float32Array;
        const arrowInk = spotArrowsGeo.getAttribute("arrowInk").array as Float32Array;
        for (const [i, spot] of state.spots.entries()) {
          const entry = w.sheets.decor[spot.img];
          const { x, y, width, height } = entry?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
          const room = spot.grKey === null ? null : w.helper.getGmRoomId(spot.grKey as Geomorph.GmRoomKey);
          const at = i * spotStride;
          data.set([x / dims.width, y / dims.height, width / dims.width, height / dims.height], at);
          const slot = room === null ? alwaysShownSlot : slotOf(room.gmId, room.roomId);
          const [slotA, slotB] = doorSlotsOf(w, spot) ?? [slot, slot];
          data[at + 7] = arrowInk[i * 4 + 3] = slotA;
          data[at + 14] = slotB;
          data[at + 8] = entry?.sheetId ?? 0;
          data.set(iconAt(spot), at + 9);
          data[at + 13] = spot.iconHidden === true ? 0 : 1;
          if (state.spotArrowsInst) writeSpotArrow(state.spotArrowsInst, i, spot);
        }
        if (state.spotArrowsInst) state.spotArrowsInst.instanceMatrix.needsUpdate = true;
        state.countSpots();
        state.colourSpots(null);
      },
      toggleSpots() {
        const shown = !state.spotsShown;
        state.set({ spotsShown: shown });
        state.countSpots();
        getWorldStore(w.key).patch({ spotsShown: shown });
        w.events.next({ key: "spots-overlay", shown }); // jsh `spots --show` fills it
        w.view.forceUpdate();
      },
      setPolyline(key, polyline) {
        state.polylines.set(key, polyline);
        state.drawPolylines();
      },
      removePolyline(key) {
        if (state.polylines.delete(key) === true) state.drawPolylines();
      },
      drawBoundary() {
        // written straight through the ref, nothing rendering — the caller asks for a frame if it
        // needs one. Rarely changes, and shares nothing with `drawPolylines`
        writeSegmentInstances(state.boundaryInst, state.localBoundary, debugSegHeight);
        if (state.boundaryInst) state.boundaryInst.visible = state.boundaryInst.count > 0; // empty, it is not drawn
      },
      drawPolylines() {
        const inst = state.polylinesInst;
        if (!inst) return;
        const isDisc = polylinesGeo.getAttribute("isDisc").array as Float32Array;
        const lineColor = polylinesGeo.getAttribute("lineColor").array as Float32Array;
        let offset = 0;
        for (const {
          points,
          color,
          opacity = 1,
          width = pathWidth,
          discRadius = polylineDiscRadius,
        } of state.polylines.values()) {
          const ps = points.slice(0, Math.floor((maxPolylineInstances - offset + 1) / 2));
          if (ps.length === 0) continue;
          tmpColor.set(color);
          // a disc per point, then the lines joining them, all one colour
          for (const [i, [x, z, y]] of ps.entries()) writeDiscInstance(inst, offset + i, x, z, discRadius, y);
          const segs = ps.slice(1).map((q, i) => [ps[i], q] as const);
          for (const [i, [p, q]] of segs.entries()) writeSegmentInstance(inst, offset + ps.length + i, p, q, width);
          inst.count = offset + ps.length + segs.length;
          for (let i = 0; i < ps.length + segs.length; i++) {
            isDisc[offset + i] = i < ps.length ? 1 : 0;
            tmpColor.toArray(lineColor, (offset + i) * 4);
            lineColor[(offset + i) * 4 + 3] = opacity;
          }
          offset += ps.length + segs.length;
        }
        inst.count = offset;
        inst.visible = offset > 0; // empty, it is not drawn
        inst.instanceMatrix.needsUpdate = true;
        polylinesGeo.getAttribute("isDisc").needsUpdate = true;
        polylinesGeo.getAttribute("lineColor").needsUpdate = true;
      },
    }),
    {
      reset: { arrowGeo: false },
    },
  );

  w.debug = state;

  /** How opaque the spots' icons and arrows are, set by theme each frame: nothing re-renders on a change of theme */
  const spotOpacity = useMemo(() => ({ icon: uniform(spotInk.dark.icon), arrow: uniform(spotInk.dark.arrow) }), []);

  useFrame((root) => {
    const ink = spotInk[w.themeKey === "light-theme" ? "light" : "dark"];
    [spotOpacity.icon.value, spotOpacity.arrow.value] = [ink.icon, ink.arrow];
    const gl = root.gl as unknown as THREE.WebGPURenderer;
    gl.info.autoReset = false;
    if (state.logGPUInfo) {
      console.log(gl.info.render);
      state.logGPUInfo = false;
    }
    gl.info.reset();
  });

  useEffect(() => {
    state.updateDoorNormals();
    state.updateDecorPoints();
    state.update();
  }, [w.hash, w.gmsData, w.decor?.ready, state.doPointsShown]);

  // "colliders": refetched as decor, which may be a collider, comes and goes
  useEffect(() => {
    const worker = w.physics?.worker;
    if (state.physicsCollidersShown === false || !worker) return;
    const onMessage = (e: MessageEvent<WW.MsgFromWorker>) => state.onPhysicsDebugData(e);
    const refetch = debounce(
      () => worker.postMessage({ type: "get-physics-debug-data" } satisfies WW.MsgToWorker),
      100,
    );
    worker.addEventListener("message", onMessage);
    refetch();
    const sub = w.events.subscribe({
      next: (e) => void ((e.key === "decor-created" || e.key === "decor-removed") && refetch()),
    });
    return () => {
      worker.removeEventListener("message", onMessage);
      sub.unsubscribe();
      refetch.clear();
    };
  }, [state.physicsCollidersShown, w.physics?.worker]);

  // "toggle doors"
  useEffect(() => {
    const sub = w.events.subscribe({
      next(event) {
        if (
          state.pickGdkeyOpensDoors === true &&
          event.key === "picked" &&
          (event.meta.type === "door" ||
            event.meta.type === "decor" ||
            (event.meta.type === "spot" && event.rightDown !== true)) && // a spot's right click chooses it
          event.clickId === undefined // ignore e.g. `pick 1`
        ) {
          const { gdKey } = event.meta;
          if (gdKey === undefined || w.helper.isGmDoorKey(gdKey) === false) return;
          // a long press locks it, keyless: open, it is held open
          if (event.longDown === true) w.e.toggleLock(gdKey, { hold: true });
          else w.e.toggleDoor(gdKey);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [state.pickGdkeyOpensDoors]);

  useEffect(() => {
    const navMeshHelper = createNavMeshHelper(w.nav?.navMesh);

    // hide during object-picking
    const meshOrLines = [] as (THREE.Mesh | THREE.Line)[];
    // biome-ignore format: succint
    navMeshHelper.object.traverse((object) => (object instanceof THREE.Mesh || object instanceof THREE.Line) && meshOrLines.push(object));
    // biome-ignore format: succint
    meshOrLines.forEach(child => {
      const material = child.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
      material.transparent = true;
      material.opacityNode = select(w.view.objectPick.greaterThan(0), 0, 0.1)
    });

    state.set({ navMeshHelper });
    return navMeshHelper.dispose();
  }, [w.nav?.navMesh]);

  const floorGrid = useMemo(() => createFloorGrid(), []);

  const materials = useMemo(() => {
    // none of these are pickable, so they all vanish during object-picking. `alphaTest` discards
    // the fragment outright, rather than trusting a zero alpha to blend away
    const hideWhenPicking = (opacity: THREE.Node<"float">) =>
      selectAs<"float">(w.view.objectPick.notEqual(0), float(0), opacity);
    const create = (color: THREE.ColorRepresentation, opacity: THREE.Node<"float">, depthTest = true) => {
      // biome-ignore format: succint
      const mat = new THREE.MeshBasicNodeMaterial({ color, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthTest, alphaTest: 0.01 });
      mat.opacityNode = hideWhenPicking(opacity);
      return mat;
    };
    // a disc is cut out of the quad, rather than given a geometry of its own
    const disc = smoothstep(0.45, 0.5, uv().sub(0.5).length()).oneMinus();
    const isDisc = attribute<"float">("isDisc", "float").greaterThan(0.5);
    const lineColor = attribute<"vec4">("lineColor", "vec4"); // each polyline its own
    const polylines = create("white", selectAs<"float">(isDisc, disc, float(1)).mul(lineColor.w), false);
    polylines.colorNode = lineColor.xyz;
    return {
      navPath: create("rgb(255, 50, 0)", float(1)),
      origin: create("red", float(0.1)),
      boundary: create(boundaryColor, float(1), false),
      polylines,
      doorNormals: create("green", float(1)),
      grid: Object.assign(create("white", floorGrid.opacityNode), { colorNode: floorGrid.colorNode }),
    };
  }, []);

  /** The grid's quad: the map's bounds, and a cell beyond for the far edges' coordinates */
  const gridRect = useMemo(() => floorGrid.setBounds(Rect.fromRects(...w.gms.map((gm) => gm.gridRect))), [w.gmsHash]);

  const decorPointsMaterial = useMemo(() => {
    // const mat = new THREE.MeshBasicNodeMaterial({ color: "red", side: THREE.DoubleSide });
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const uvTexIds = attribute<"uint">("uvTextureIds", "uint");
    const transformedUv = vec2(uv().x, uv().y.oneMinus()).mul(uvDims).add(uvOffs);
    const texNode = texture(w.texDecor.tex, transformedUv);
    texNode.depthNode = uvTexIds;
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      forceSinglePass: true,
      transparent: true,
      alphaTest: 0.5,
    });
    mat.colorNode = texNode;
    mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.debugPoint);
    return { material: mat, uid: crypto.randomUUID() };
  }, [state.doPointsShown]);

  /** How much of a spot shows, given its rooms' fade `shown`: only in sight mode does it fade with them */
  const spotSeen = (shown: THREE.Node<"float">) => shown.max(w.view.fadeRoomsFx.sightNode.oneMinus());

  const spotsMaterial = useMemo(() => {
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const texNode = texture(w.texDecor.tex, vec2(uv().x, uv().y.oneMinus()).mul(uvDims).add(uvOffs));
    texNode.depthNode = uint(attribute<"float">("uvTextureIds", "float"));
    const slots = vec2(attribute<"float">("spotSlot", "float"), attribute<"float">("spotSlotB", "float"));
    const seen = spotSeen(w.view.fadeRoomsFx.fadeAtPair(slots));
    // biome-ignore format: succint
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false, alphaTest: 0.05 });
    // a billboard `w` across, upright on screen: its arrow on the floor gives its facing
    const centre = attribute<"vec4">("spotCentre", "vec4");
    const picking = w.view.objectPick.notEqual(0);
    // the quad's own corner: `positionLocal` has the instance's matrix applied. Picked, it is larger
    const grow = selectAs<"float">(picking, float(spotPickScale), float(1));
    const corner = vec2(positionGeometry.x.sub(0.5), positionGeometry.z.sub(0.5)).mul(centre.w.mul(grow));
    const viewCentre = cameraViewMatrix.mul(vec4(centre.xyz, 1));
    mat.vertexNode = cameraProjectionMatrix.mul(viewCentre.add(vec4(corner, 0, 0)));
    // picked, the whole square counts, not only the icon's strokes, even one not shown
    const shown = attribute<"float">("spotShown", "float");
    // faded with the world's fold, so they come up as it unfolds on load
    const alpha = selectAs<"float">(
      picking,
      float(1),
      texNode.a.mul(seen).mul(spotOpacity.icon).mul(shown).mul(w.view.foldNode),
    );
    mat.colorNode = vec4(texNode.rgb.mul(attribute<"vec3">("spotColor", "vec3")), alpha);
    // opaque when picking: a blended id would be another's
    mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.spot, 1);
    return { material: mat, uid: crypto.randomUUID() };
  }, [w.view.fadeRoomsFx.uid, w.texDecor.tex]);

  const spotArrowsMaterial = useMemo(() => {
    const ink = attribute<"vec4">("arrowInk", "vec4");
    const seen = spotSeen(w.view.fadeRoomsFx.getVisiblity(ink.w));
    // biome-ignore format: succint
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false });
    mat.colorNode = vec4(
      ink.rgb,
      selectAs<"float">(w.view.objectPick.notEqual(0), float(0), seen.mul(spotOpacity.arrow).mul(w.view.foldNode)),
    );
    return mat;
  }, [w.view.fadeRoomsFx.uid]);

  return (
    <>
      <mesh name="origin" position={[0, 5, 0]} visible={state.originShown} material={materials.origin}>
        <boxGeometry args={[0.05, 10, 0.05]} />
      </mesh>

      <mesh
        name="floor-grid"
        geometry={quad}
        material={materials.grid}
        position={[gridRect.x, gridLift, gridRect.y]}
        scale={[gridRect.width, 1, gridRect.height]}
        visible={state.gridShown}
        renderOrder={-2}
      />

      {/* an npc's local navmesh boundary, as `park` sees it — see `drawBoundary` */}
      <instancedMesh
        ref={state.ref("boundaryInst")}
        args={[quad, materials.boundary, maxBoundarySegs]}
        count={0}
        visible={false}
        frustumCulled={false}
        renderOrder={-6}
      />

      {/* polylines e.g. an npc's corners: a disc per point joined by lines — see `drawPolylines` */}
      <instancedMesh
        ref={state.ref("polylinesInst")}
        args={[polylinesGeo, materials.polylines, maxPolylineInstances]}
        count={0}
        visible={false}
        frustumCulled={false}
        renderOrder={-5}
      />

      <instancedMesh
        ref={state.ref("doorNormalsInst")}
        args={[state.arrowGeo, materials.doorNormals, maxDoorNormals]}
        frustumCulled={false}
        visible={state.doorNormalsShown}
        renderOrder={-4}
      />

      {state.physicsColliders.length > 0 && (
        <group name="static-colliders" visible={state.physicsColliders.length > 0}>
          {/* <lineSegments geometry={state.physicsLines}>
            <lineBasicMaterial color="green" />
          </lineSegments> */}
          <MemoizedDebugPhysicsColliders staticColliders={state.physicsColliders} w={w} />
        </group>
      )}

      <instancedMesh
        key={decorPointsMaterial.uid}
        ref={state.ref("debugPointsInst")}
        args={[decorPointsGeo, decorPointsMaterial.material, maxDecorPoints]}
        frustumCulled={false}
        visible={state.doPointsShown}
        renderOrder={-5}
      />

      {/* the map's spots, an icon per kind coloured by sight — filled by jsh `spots --show`. Hidden with no
          instances, not `visible`: their pipelines are then built at load, not on the first show */}
      <instancedMesh
        key={spotsMaterial.uid}
        ref={state.ref("spotsInst")}
        args={[spotsGeo, spotsMaterial.material, maxSpots]}
        count={0}
        frustumCulled={false}
        renderOrder={spotsRenderOrder}
      />
      <instancedMesh
        key={`${spotsMaterial.uid}-arrows`}
        ref={state.ref("spotArrowsInst")}
        args={[spotArrowsGeo, spotArrowsMaterial, maxSpots]}
        count={0}
        frustumCulled={false}
        renderOrder={spotsRenderOrder}
      />

      {state.navMeshShown && state.navMeshHelper && <primitive object={state.navMeshHelper.object} />}

      {state.decorShown && <DecorInspector />}
    </>
  );
}

const pathWidth = 0.02;
const maxBoundarySegs = 64;
/** Across every polyline: a disc per point, plus the lines joining them */
const maxPolylineInstances = 1024;
const maxDecorPoints = 1024;
const maxDoorNormals = 512;
const maxSpots = 4096;
/** After the floor, which is transparent too: they write no depth to keep it out */
const spotsRenderOrder = 10;
/** Floats per spot: `uvOffsets` 2, `uvDimensions` 2, `spotColor` 3, `spotSlot` 1, `uvTextureIds` 1, `spotCentre` 4, `spotShown` 1, `spotSlotB` 1 */
const spotStride = 15;
/** Metres across a spot's icon */
const spotIconSize = 0.15;
/** Metres its centre stands off the floor */
const spotIconLift = 0.12;
/** Metres along a spot's arrow, from its point along its facing */
const spotArrowLen = 0.18;
/** How far along its arrow the middle of its head is — see `createOpenArrowGeo` */
const arrowheadAt = 0.82;
/** By theme: how opaque a spot's icon and arrow are, its room not faded. Their colours are jsh `spots --show`'s */
const spotInk = { dark: { icon: 0.2, arrow: 0.2 }, light: { icon: 1, arrow: 0.7 } };
/** A spot's icon, this much larger when picking: easier to press */
const spotPickScale = 1.4;
const polylineDiscRadius = 0.08;
const debugSegHeight = 0.02;
const onPointHeight = 0.005;
const arrowLen = 0.5;
const arrowWidth = 0.25;
const doorNormalHeight = 0.05;
/** How far the grid lies off the floor, clear of its z-fighting */
const gridLift = 0.003;
const boundaryColor = new THREE.Color("red");
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** A ground segment `[x1, z1, x2, z2]` */
type XZSeg = [number, number, number, number];
/** A ground point `[x, z]` */
export type XZPoint = [number, number];
/** A polyline's point `[x, z]`, else `[x, z, height]` off the floor */
export type PolylinePoint = XZPoint | [number, number, number];

export type Polyline = {
  points: PolylinePoint[];
  color: THREE.ColorRepresentation;
  /** Each defaults to the usual: opaque, `pathWidth` wide, discs `polylineDiscRadius` */
  opacity?: number;
  width?: number;
  discRadius?: number;
};

/** A spot as the overlay draws it: `img` its icon's decor key, `color` its own when none is given */
export type SpotDraw = {
  key: string;
  x: number;
  y: number;
  facing?: number;
  grKey: null | string;
  img: string;
  color: THREE.ColorRepresentation;
  /** A doable's decor, which a press on it is as one on */
  decorKey?: null | string;
  kind?: string;
  /** A door or doorway spot's door */
  gdKey?: string;
  /** Metres it stands above the floor, e.g. a doable on a seat */
  lift?: number;
  /** Its icon is not drawn, e.g. a wall spot's arrow says enough. It can still be picked */
  iconHidden?: boolean;
};

/** A disc of radius `r` centred on `(x, z)` — the quad's disc is cut out by its material */
function writeDiscInstance(inst: THREE.InstancedMesh, i: number, x: number, z: number, r: number, y = debugSegHeight) {
  embedXZMat4({ a: r * 2, b: 0, c: 0, d: r * 2, e: x - r, f: z - r }, { yHeight: y, mat4: tmpMat4 });
  inst.setMatrixAt(i, tmpMat4);
}

/** A thin quad from `p` to `q`, `width` across level with the floor: sloped when their heights differ */
function writeSegmentInstance(inst: THREE.InstancedMesh, i: number, p: PolylinePoint, q: PolylinePoint, width: number) {
  const [[x1, z1, y1 = debugSegHeight], [x2, z2, y2 = debugSegHeight]] = [p, q];
  const [dx, dz] = [x2 - x1, z2 - z1];
  const len = Math.hypot(dx, dz);
  const [nx, nz] = len > 0 ? [dx / len, dz / len] : [1, 0];
  // the unit quad's x along the segment, its z across it
  tmpMat4.set(dx, 0, -width * nz, x1, y2 - y1, 1, 0, y1, dz, 0, width * nx, z1, 0, 0, 0, 1);
  inst.setMatrixAt(i, tmpMat4);
}

/** Where a spot's icon stands. One not shown covers its arrowhead instead, so pressing that picks it */
/** A door spot's two rooms' slots, as it shows whilst either does */
function doorSlotsOf(w: React.ContextType<typeof WorldContext>, spot: SpotDraw): null | [number, number] {
  const door = spot.kind === "door" ? w.door.byKey[spot.gdKey as Geomorph.GmDoorKey] : undefined;
  if (door === undefined) return null;
  const [a, b] = door.connector.roomIds.map((roomId) =>
    roomId === null ? alwaysShownSlot : slotOf(door.gmId, roomId),
  );
  return [a, b];
}

function iconAt(spot: SpotDraw): [number, number, number] {
  const lift = spot.lift ?? 0;
  if (spot.iconHidden !== true || spot.facing === undefined) return [spot.x, spotIconLift + lift, spot.y];
  const along = arrowheadAt * spotArrowLen;
  return [spot.x + Math.cos(spot.facing) * along, lift + debugSegHeight, spot.y + Math.sin(spot.facing) * along];
}

/** A spot's arrow on the floor along its facing, else none */
function writeSpotArrow(inst: THREE.InstancedMesh, i: number, spot: SpotDraw) {
  const [c, s] = spot.facing === undefined ? [0, 0] : [Math.cos(spot.facing), Math.sin(spot.facing)];
  const len = spotArrowLen;
  embedXZMat4(
    { a: c * len, b: s * len, c: -s * len, d: c * len, e: spot.x, f: spot.y },
    { yHeight: debugSegHeight + (spot.lift ?? 0), mat4: tmpMat4 },
  );
  inst.setMatrixAt(i, tmpMat4);
}

/** An open arrowhead on the XZ plane pointing along `+x`, its tip at `(1, 0, 0)`: two barbs, each a thin quad */
function createOpenArrowGeo() {
  const strokes: [number, number, number, number][] = [
    [1, 0, 0.65, -0.3],
    [1, 0, 0.65, 0.3],
  ];
  const t = 0.04;
  const positions = strokes.flatMap(([x1, z1, x2, z2]) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const [nx, nz] = [(-(z2 - z1) / len) * t, ((x2 - x1) / len) * t];
    return [x1 - nx, 0, z1 - nz, x2 - nx, 0, z2 - nz, x2 + nx, 0, z2 + nz, x1 + nx, 0, z1 + nz];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(strokes.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((k) => 4 * i + k)));
  return geo;
}

/** One thin quad per segment, `yHeight` off the floor, written from instance `offset` on */
function writeSegmentInstances(inst: THREE.InstancedMesh | null, segs: XZSeg[], yHeight: number, offset = 0) {
  if (inst === null) return;
  inst.count = offset + segs.length;
  for (const [i, [x1, z1, x2, z2]] of segs.entries()) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const nx = len > 0 ? dx / len : 1;
    const nz = len > 0 ? dz / len : 0;
    embedXZMat4({ a: dx, b: dz, c: -pathWidth * nz, d: pathWidth * nx, e: x1, f: z1 }, { yHeight, mat4: tmpMat4 });
    inst.setMatrixAt(offset + i, tmpMat4);
  }
  inst.instanceMatrix.needsUpdate = true;
}

export type State = {
  arrowGeo: THREE.BufferGeometry;
  /** The instanced meshes: each is `null` until mounted, despite the type */
  boundaryInst: THREE.InstancedMesh;
  polylinesInst: THREE.InstancedMesh;
  debugPointsInst: THREE.InstancedMesh;
  doorNormalsInst: THREE.InstancedMesh;
  navPathInst: THREE.InstancedMesh;
  spotsInst: THREE.InstancedMesh;
  /** Each spot's arrow, along its facing */
  spotArrowsInst: THREE.InstancedMesh;
  debugPointInstanceIdToDecorId: { gmId: number; decorId: number }[];
  /** The spots drawn, by instance id */
  spots: SpotDraw[];
  /** Whether the map's spots are drawn — see jsh `spots --show` */
  spotsShown: boolean;
  /** An npc's local navmesh boundary, drawn whilst non-empty — see `debug_boundary` */
  localBoundary: XZSeg[];
  /** By key, drawn as a disc per point joined by lines — see `debug_corners` */
  polylines: Map<string, Polyline>;
  /** Decorating: every runtime decor is drawn, labelled and opens its card — see `DecorInspector` */
  decorShown: boolean;
  doorNormalsShown: boolean;
  gridShown: boolean;
  logGPUInfo: boolean;
  navMeshHelper: null | NavMeshHelperObject;
  navMeshShown: boolean;
  doPointsShown: boolean;
  originShown: boolean;
  pickGdkeyOpensDoors: boolean;
  /** Whether the doors are drawn during object-picking, and so can be picked — see `pickObject` */
  pickDoors: boolean;
  /** Whether a right click or long press on an npc opens their bubble — see `pickObject` */
  npcContextMenu: boolean;
  /** Whether the player's bar shows debug controls — see `WorldHud` */
  hudDebug: boolean;
  /** Every phaser shot ends so, over `w.e.shotResolver`: set by the hud's debug badge */
  forceShot: null | JshCli.ShotOutcome;
  physicsLines: THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>;
  physicsColliders: (WW.PhysicDebugItem & {
    parsedKey: WW.PhysicsParsedBodyKey;
  })[];
  physicsCollidersShown: boolean;
  decodeDebugPointInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  updateDoorNormals(): void;
  updateDecorPoints(): void;
  /** Takes the worker's colliders, ignoring its other messages */
  onPhysicsDebugData(e: MessageEvent<WW.MsgFromWorker>): void;
  showPhysicsColliders(shouldShow?: boolean): void;
  setLocalBoundary(segs: XZSeg[]): void;
  /** Draws these spots, each in its own colour */
  setSpots(spots: SpotDraw[]): void;
  /** Shows the spots overlay, else hides it, and remembers which */
  toggleSpots(): void;
  /** Colours the spots drawn by key, the rest their own, with `null` all their own */
  colourSpots(colors: null | Record<string, THREE.ColorRepresentation>): void;
  /** Draws every spot whilst shown, else none */
  countSpots(): void;
  setPolyline(key: string, polyline: Polyline): void;
  removePolyline(key: string): void;
  /** Writes `localBoundary` into its mesh */
  drawBoundary(): void;
  /** Writes every shown polyline's discs and joining lines into the one mesh */
  drawPolylines(): void;
};
