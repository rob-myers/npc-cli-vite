import { useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { useFrame } from "@react-three/fiber";
import { ANY_QUERY_FILTER, findPath, type Vec3 } from "navcat";
import { createNavMeshHelper, type DebugObject as NavMeshHelperObject } from "navcat/three";
import { useContext, useEffect, useMemo } from "react";
import { attribute, select, smoothstep, texture, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import { sguToWorldScale } from "../const";
import { createArrowGeo, createXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { getWorldStore } from "../service/storage";
import { MemoizedDebugPhysicsColliders } from "./DebugPhysicsColliders";
import { WorldContext } from "./world-context";

export function Debug() {
  const w = useContext(WorldContext);
  const quad = useMemo(() => createXzQuad(), []);
  const cornersGeo = useMemo(() => {
    const geo = createXzQuad();
    // 1 for the discs, 0 for the lines joining them — see `cornersMaterial`
    geo.setAttribute("isDisc", new THREE.InstancedBufferAttribute(new Float32Array(maxCornerInstances), 1));
    return geo;
  }, []);
  const decorPointsGeo = useMemo(() => {
    const geo = createXzQuad();
    geo.setAttribute("uvOffsets", new THREE.InstancedBufferAttribute(new Float32Array(maxDecorPoints * 2), 2));
    geo.setAttribute("uvDimensions", new THREE.InstancedBufferAttribute(new Float32Array(maxDecorPoints * 2), 2));
    geo.setAttribute("uvTextureIds", new THREE.InstancedBufferAttribute(new Uint32Array(maxDecorPoints), 1));
    return geo;
  }, []);

  const state = useStateRef(
    (): State => ({
      arrowGeo: createArrowGeo(),
      // the instanced meshes, via `state.ref`
      boundaryInst: null as unknown as THREE.InstancedMesh,
      cornersInst: null as unknown as THREE.InstancedMesh,
      debugPointsInst: null as unknown as THREE.InstancedMesh,
      doorNormalsInst: null as unknown as THREE.InstancedMesh,
      navPathInst: null as unknown as THREE.InstancedMesh,
      debugPointInstanceIdToDecorId: [],
      demoNavPath: [] as Vec3[],
      demoNavPathShown: false,
      localBoundary: [] as XZSeg[],
      corners: [] as XZPoint[],
      doorNormalsShown: false,
      gridShown: false,
      logGPUInfo: false,
      navMeshHelper: null,
      navMeshShown: false,
      doPointsShown: false,
      originShown: false,
      pickGdkeyOpensDoors: getWorldStore(w.key).read().pickOpenDoors,
      pickDoors: getWorldStore(w.key).read().pickDoors,

      physicsLines: new THREE.BufferGeometry(),
      physicsColliders: [] as (WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey })[],
      physicsCollidersShown: false,

      decodeDebugPointInstanceId(instanceId) {
        const entry = state.debugPointInstanceIdToDecorId[instanceId];
        if (!entry) return null;
        const item = w.gms[entry.gmId]?.decor[entry.decorId];
        return item ? { ...item.meta } : null;
      },
      computeDemoPath() {
        const [gm] = w.gms;
        if (!gm) return;
        const { x, y, height } = gm.gridRect;
        const result = findPath(
          w.nav.navMesh,
          [x + 0.5, 0, y + 0.5],
          [x + 0.5, 0, y + height * 0.95],
          [0.5, 0.1, 0.5],
          ANY_QUERY_FILTER,
        );
        state.demoNavPath = result.success ? result.path.map((p) => p.position) : [];
      },
      onPhysicsDebugData(e) {
        if (e.data.type === "physics-debug-data-response") {
          // console.log('🔔 RECEIVED', e.data);
          state.physicsColliders = e.data.items;
          state.physicsLines.dispose();
          state.physicsLines = new THREE.BufferGeometry();
          state.physicsLines.setAttribute("position", new THREE.BufferAttribute(new Float32Array(e.data.lines), 3));
          w.physics.worker.removeEventListener("message", state.onPhysicsDebugData);
        }
        state.update();
        w.view.forceUpdate();
      },
      showPhysicsColliders(shouldShow = !state.physicsCollidersShown) {
        state.set({
          physicsCollidersShown: shouldShow,
          physicsColliders: [],
          physicsLines: new THREE.BufferGeometry(),
        });
        if (shouldShow) {
          w.physics.worker.addEventListener("message", state.onPhysicsDebugData);
          w.physics.worker.postMessage({ type: "get-physics-debug-data" } satisfies WW.MsgToWorker);
        } else {
          pause().then(() => w.view.forceUpdate());
        }
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
            const dims = entry && w.sheets.decorSheetDims[entry.sheetId];
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
      updateNavPathInstances() {
        const { demoNavPath: ps } = state;
        const segs = ps.slice(1).map((p, i): XZSeg => [ps[i][0], ps[i][2], p[0], p[2]]);
        writeSegmentInstances(state.navPathInst, segs, 0.01);
      },
      setLocalBoundary(segs) {
        state.localBoundary = segs;
        state.drawBoundary();
      },
      setCorners(points) {
        state.corners = points;
        state.drawCorners();
      },
      drawBoundary() {
        // written straight through the ref, nothing rendering — the caller asks for a frame if it
        // needs one. Rarely changes, and shares nothing with `drawCorners`
        writeSegmentInstances(state.boundaryInst, state.localBoundary, debugSegHeight);
      },
      drawCorners() {
        const inst = state.cornersInst;
        if (!inst) return;
        const ps = state.corners.slice(0, maxCorners);
        const isDisc = cornersGeo.getAttribute("isDisc").array as Float32Array;
        // a disc per corner, then the lines joining them, in the one mesh
        const r = cornerDiscRadius;
        for (const [i, [x, z]] of ps.entries()) {
          embedXZMat4(
            { a: r * 2, b: 0, c: 0, d: r * 2, e: x - r, f: z - r },
            { yHeight: debugSegHeight, mat4: tmpMat4 },
          );
          inst.setMatrixAt(i, tmpMat4);
          isDisc[i] = 1;
        }
        const segs = ps.slice(1).map((p, i): XZSeg => [ps[i][0], ps[i][1], p[0], p[1]]);
        segs.forEach((_, i) => (isDisc[ps.length + i] = 0));
        writeSegmentInstances(inst, segs, debugSegHeight, ps.length);
        cornersGeo.getAttribute("isDisc").needsUpdate = true;
      },
    }),
    {
      reset: { demoNavPathShown: true, originShown: true, pickGdkeyOpensDoors: true, pickDoors: true, arrowGeo: false },
    },
  );

  w.debug = state;

  useFrame((root) => {
    const gl = root.gl as unknown as THREE.WebGPURenderer;
    gl.info.autoReset = false;
    if (state.logGPUInfo) {
      console.log(gl.info.render);
      state.logGPUInfo = false;
    }
    gl.info.reset();
  });

  useEffect(() => {
    state.computeDemoPath();
    state.updateNavPathInstances();
  }, [w.nav]);

  useEffect(() => {
    state.updateDoorNormals();
    state.updateDecorPoints();
    state.update();
  }, [w.hash, w.gmsData, w.decor?.ready, state.doPointsShown]);

  // "Toggle Doors"
  useEffect(() => {
    const sub = w.events.subscribe({
      next(event) {
        if (
          state.pickGdkeyOpensDoors === true &&
          event.key === "picked" &&
          (event.meta.type === "door" || event.meta.type === "decor") &&
          event.clickId === undefined // ignore e.g. `pick 1`
        ) {
          const { gdKey } = event.meta;
          if (gdKey !== undefined && w.helper.isGmDoorKey(gdKey)) w.e.toggleDoor(gdKey);
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

  const cornersMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({ color: cornersColor, side: THREE.DoubleSide, transparent: true });
    mat.depthTest = false;
    // a disc is cut out of the quad, rather than given a geometry of its own
    const disc = smoothstep(0.45, 0.5, uv().sub(0.5).length()).oneMinus();
    mat.opacityNode = select(attribute<"float">("isDisc", "float").greaterThan(0.5), disc, 1);
    return mat;
  }, []);

  const decorPointsMaterial = useMemo(() => {
    // const mat = new THREE.MeshBasicNodeMaterial({ color: "red", side: THREE.DoubleSide });
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const uvTexIds = attribute<"uint">("uvTextureIds", "uint");
    const transformedUv = vec2(uv().x, uv().y.oneMinus()).mul(uvDims).add(uvOffs);
    const texNode = texture(w.texDecor.tex, transformedUv);
    texNode.depthNode = uvTexIds;
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
    mat.colorNode = texNode;
    mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.debugPoint);
    return { material: mat, uid: crypto.randomUUID() };
  }, [state.doPointsShown]);

  return (
    <>
      <mesh name="origin" position={[0, 5, 0]} visible={state.originShown}>
        <boxGeometry args={[0.05, 10, 0.05]} />
        <meshBasicMaterial color="red" transparent opacity={0.1} />
      </mesh>

      <instancedMesh
        ref={state.ref("navPathInst")}
        args={[quad, undefined, maxPathSegments]}
        frustumCulled={false}
        position={[0, 1, 0]}
        renderOrder={-6}
        visible={state.demoNavPathShown}
      >
        <meshBasicMaterial color="rgb(255, 50, 0)" transparent side={THREE.DoubleSide} />
      </instancedMesh>

      {/* an npc's local navmesh boundary, as `park` sees it — see `drawBoundary` */}
      <instancedMesh
        ref={state.ref("boundaryInst")}
        args={[quad, undefined, maxBoundarySegs]}
        count={0}
        frustumCulled={false}
        renderOrder={-6}
      >
        <meshBasicMaterial color={boundaryColor} side={THREE.DoubleSide} depthTest={false} />
      </instancedMesh>

      {/* an npc's corners: a disc each, joined by lines — see `drawCorners` */}
      <instancedMesh
        ref={state.ref("cornersInst")}
        args={[cornersGeo, cornersMaterial, maxCornerInstances]}
        count={0}
        frustumCulled={false}
        renderOrder={-5}
      />

      <instancedMesh
        ref={state.ref("doorNormalsInst")}
        args={[state.arrowGeo, undefined, maxDoorNormals]}
        frustumCulled={false}
        visible={state.doorNormalsShown}
        renderOrder={-4}
      >
        <meshBasicMaterial color="green" side={THREE.DoubleSide} />
      </instancedMesh>

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

      {state.navMeshShown && state.navMeshHelper && <primitive object={state.navMeshHelper.object} />}
    </>
  );
}

const pathWidth = 0.02;
const maxPathSegments = 256;
const maxBoundarySegs = 64;
const maxCorners = 16;
/** A disc per corner, plus the lines joining them */
const maxCornerInstances = maxCorners * 2 - 1;
const maxDecorPoints = 1024;
const maxDoorNormals = 512;
const cornerDiscRadius = 0.08;
const debugSegHeight = 0.02;
const onPointHeight = 0.005;
const arrowLen = 0.5;
const arrowWidth = 0.25;
const doorNormalHeight = 0.05;
const boundaryColor = new THREE.Color("red");
const cornersColor = new THREE.Color("dodgerblue");
const tmpMat4 = new THREE.Matrix4();

/** A ground segment `[x1, z1, x2, z2]` */
type XZSeg = [number, number, number, number];
/** A ground point `[x, z]` */
type XZPoint = [number, number];

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
  cornersInst: THREE.InstancedMesh;
  debugPointsInst: THREE.InstancedMesh;
  doorNormalsInst: THREE.InstancedMesh;
  navPathInst: THREE.InstancedMesh;
  debugPointInstanceIdToDecorId: { gmId: number; decorId: number }[];
  demoNavPath: Vec3[];
  demoNavPathShown: boolean;
  /** An npc's local navmesh boundary, drawn whilst non-empty — see `demo_boundary` */
  localBoundary: XZSeg[];
  /** An npc's corners, drawn as a disc each joined by lines — see `demo_corners` */
  corners: XZPoint[];
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
  physicsLines: THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>;
  physicsColliders: (WW.PhysicDebugItem & {
    parsedKey: WW.PhysicsParsedBodyKey;
  })[];
  physicsCollidersShown: boolean;
  computeDemoPath(): void;
  decodeDebugPointInstanceId(instanceId: number): Meta<Geomorph.GmRoomId> | null;
  updateDoorNormals(): void;
  updateDecorPoints(): void;
  onPhysicsDebugData(e: MessageEvent<WW.MsgFromWorker>): void;
  showPhysicsColliders(shouldShow?: boolean): void;
  updateNavPathInstances(): void;
  setLocalBoundary(segs: XZSeg[]): void;
  setCorners(points: XZPoint[]): void;
  /** Writes `localBoundary` into its mesh */
  drawBoundary(): void;
  /** Writes the `corners` discs and the lines joining them into their mesh */
  drawCorners(): void;
};
