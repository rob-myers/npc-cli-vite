import { useStateRef } from "@npc-cli/util";
import { pause, tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { useFrame } from "@react-three/fiber";
import { ANY_QUERY_FILTER, findPath, type Vec3 } from "navcat";
import { createNavMeshHelper, type DebugObject as NavMeshHelperObject } from "navcat/three";
import { useContext, useEffect, useMemo, useRef } from "react";
import {
  attribute,
  Break,
  Fn,
  float,
  If,
  instanceIndex,
  int,
  Loop,
  normalView,
  positionWorld,
  pow,
  select,
  texture,
  uniformArray,
  uv,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { pickOpenDoorsKey, sguToWorldScale } from "../const";
import { createArrowGeo, createXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { getLightMetas } from "../service/texture";
import { MemoizedDebugPhysicsColliders } from "./DebugPhysicsColliders";
import { WorldContext } from "./world-context";

export function Debug() {
  const w = useContext(WorldContext);
  const navPathRef = useRef<THREE.InstancedMesh>(null);

  const doorNormalsRef = useRef<THREE.InstancedMesh>(null);
  const quad = useMemo(() => createXzQuad(), []);
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
      debugPointsInst: null as unknown as THREE.InstancedMesh,
      debugPointInstanceIdToDecorId: [],
      demoNavPath: [] as Vec3[],
      demoNavPathShown: false,
      doorNormalsShown: false,
      gridShown: false,
      lightSpheres: null,
      lightSpheresShown: false,
      lightSpherePolyInfo: Array.from({ length: maxLightSpheres }, () => new THREE.Vector4()),
      lightSpherePolyVerts: Array.from({ length: maxTotalPolyVerts }, () => new THREE.Vector2()),
      logGPUInfo: false,
      navMeshHelper: null,
      navMeshShown: false,
      doPointsShown: false,
      originShown: false,
      pickOpenDoors: tryLocalStorageGetParsed(pickOpenDoorsKey) ?? false,

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
          w.worker.worker.removeEventListener("message", state.onPhysicsDebugData);
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
          w.worker.worker.addEventListener("message", state.onPhysicsDebugData);
          w.worker.worker.postMessage({ type: "get-physics-debug-data" } satisfies WW.MsgToWorker);
        } else {
          pause().then(() => w.view.forceUpdate());
        }
      },
      updateLightSpheres() {
        const inst = state.lightSpheres;
        if (!inst) return;
        const positions: THREE.Vector3[] = [];
        const radii: number[] = [];
        let totalVerts = 0;
        let instanceIdx = 0;
        for (const gm of w.gms) {
          for (const p of getLightMetas(gm)) {
            const wp = gm.matrix.transformPoint(p);
            positions.push(new THREE.Vector3(wp.x, lightSphereHeight, wp.y));
            radii.push(p.radius);

            const roomId = typeof p.roomId === "number" ? p.roomId : -1;
            const room = roomId >= 0 ? gm.rooms[roomId] : null;
            const verts = room?.outline ?? [];
            const count = Math.min(verts.length, MAX_ROOM_POLY_VERTS);
            state.lightSpherePolyInfo[instanceIdx].set(totalVerts, count, 0, 0);
            for (let v = 0; v < count && totalVerts < maxTotalPolyVerts; v++, totalVerts++) {
              const wv = gm.matrix.transformPoint(verts[v]);
              state.lightSpherePolyVerts[totalVerts].set(wv.x, wv.y); // wv.y = world Z
            }
            instanceIdx++;
          }
        }
        inst.count = Math.min(positions.length, maxLightSpheres);
        for (let i = 0; i < inst.count; i++) {
          tmpMat4.makeTranslation(positions[i]).scale(new THREE.Vector3(radii[i], radii[i], radii[i]));
          inst.setMatrixAt(i, tmpMat4);
        }
        inst.instanceMatrix.needsUpdate = true;
      },
      updateDoorNormals() {
        const inst = doorNormalsRef.current;
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
            if (!entry) {
              count++;
              continue;
            }
            const dims = w.sheets.decorSheetDims[entry.sheetId];
            if (!dims) {
              count++;
              continue;
            }
            (decorPointsGeo.getAttribute("uvOffsets").array as Float32Array).set(
              [entry.rect.x / dims.width, entry.rect.y / dims.height],
              count * 2,
            );
            (decorPointsGeo.getAttribute("uvDimensions").array as Float32Array).set(
              [entry.rect.width / dims.width, entry.rect.height / dims.height],
              count * 2,
            );
            (decorPointsGeo.getAttribute("uvTextureIds").array as Uint32Array)[count] = entry.sheetId;
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
        decorPointsGeo.getAttribute("uvOffsets").needsUpdate = true;
        decorPointsGeo.getAttribute("uvDimensions").needsUpdate = true;
        decorPointsGeo.getAttribute("uvTextureIds").needsUpdate = true;
      },
      updateNavPathInstances() {
        const inst = navPathRef.current;
        if (!inst) return;
        const { demoNavPath: ps } = state;
        inst.count = Math.max(0, ps.length - 1);

        for (let i = 0; i + 1 < ps.length; i++) {
          const dx = ps[i + 1][0] - ps[i][0];
          const dz = ps[i + 1][2] - ps[i][2];
          const len = Math.sqrt(dx * dx + dz * dz);
          const nx = len > 0 ? dx / len : 1;
          const nz = len > 0 ? dz / len : 0;

          embedXZMat4(
            { a: dx, b: dz, c: -pathWidth * nz, d: pathWidth * nx, e: ps[i][0], f: ps[i][2] },
            { yHeight: 0.01, mat4: tmpMat4 },
          );
          inst.setMatrixAt(i, tmpMat4);
        }
        inst.instanceMatrix.needsUpdate = true;
      },
    }),
    {
      reset: { demoNavPathShown: true, originShown: true, pickOpenDoors: true, arrowGeo: false },
    },
  );

  w.debug = state;

  const lightSphereMat = useMemo(() => {
    const polyInfoNode = uniformArray<"vec4">(state.lightSpherePolyInfo, "vec4"); // (offset, count, 0, 0) per instance
    const polyVertsNode = uniformArray<"vec2">(state.lightSpherePolyVerts, "vec2"); // flat world XZ verts

    // Ray-casting point-in-polygon. Returns 1.0 inside room, 0.0 outside.
    // count == 0 (no roomId) → unclipped (returns 1.0).
    const clipFactor = Fn(() => {
      const info = polyInfoNode.element(instanceIndex);
      const count = info.y.toInt();
      const inside = int(0).toVar("pipInside");

      If(count.greaterThan(0), () => {
        const offset = info.x.toInt();
        const px = positionWorld.x;
        const pz = positionWorld.z;
        Loop(MAX_ROOM_POLY_VERTS, ({ i }) => {
          If(i.greaterThanEqual(count), () => {
            Break();
          });
          const a = polyVertsNode.element(offset.add(i));
          const b = polyVertsNode.element(offset.add(i.add(1).mod(count)));
          // horizontal ray from (px, pz) in +x direction — XOR via float comparison
          const yCross = a.y.greaterThan(pz).toFloat().notEqual(b.y.greaterThan(pz).toFloat());
          const t = b.x.sub(a.x).mul(pz.sub(a.y)).div(b.y.sub(a.y)).add(a.x);
          If(yCross.and(px.lessThan(t)), () => {
            inside.assign(inside.bitXor(int(1)));
          });
        });
      });

      return count.equal(0).select(float(1), inside.toFloat());
    })();

    const mat = new THREE.MeshBasicNodeMaterial({
      color: "white",
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const fresnel = pow(float(1).sub(normalView.z), float(3)).mul(float(0.8));
    mat.opacityNode = w.view.objectPick.greaterThan(0).select(0, fresnel.mul(clipFactor));
    return mat;
  }, []);

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
    state.updateLightSpheres();
    state.updateDoorNormals();
  }, [w.hash, w.gmsData]);

  useEffect(() => {
    state.updateDecorPoints();
    state.update();
  }, [w.hash, w.gmsData, w.decor?.ready, state.doPointsShown]);

  // option "Toggle Doors"
  useEffect(() => {
    const sub = w.events.subscribe({
      next(event) {
        if (state.pickOpenDoors === true && event.key === "picked" && event.meta.type === "door") {
          w.e.toggleDoor(event.meta.gdKey);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [state.pickOpenDoors]);

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
      material.opacityNode = select(w.view.objectPick.greaterThan(0), 0, 0.5)
    });

    state.set({ navMeshHelper });
    return navMeshHelper.dispose();
  }, [w.nav?.navMesh]);

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
    mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.debugPoint, 0.6);
    return { material: mat, uid: crypto.randomUUID() };
  }, [state.doPointsShown]);

  return (
    <>
      <mesh name="origin" position={[0, 5, 0]} visible={state.originShown}>
        <boxGeometry args={[0.05, 10, 0.05]} />
        <meshBasicMaterial color="red" transparent opacity={0.1} />
      </mesh>

      <instancedMesh
        ref={navPathRef}
        args={[quad, undefined, maxPathSegments]}
        frustumCulled={false}
        position={[0, 1, 0]}
        renderOrder={-6}
        visible={state.demoNavPathShown}
      >
        <meshBasicMaterial color="rgb(255, 50, 0)" transparent side={THREE.DoubleSide} />
      </instancedMesh>

      <instancedMesh
        ref={state.ref("lightSpheres")}
        args={[undefined, undefined, maxLightSpheres]}
        frustumCulled={false}
        visible={state.lightSpheresShown}
        renderOrder={6}
      >
        <sphereGeometry args={[1, 32, 32, undefined, undefined, undefined, Math.PI / 2]} />
        <primitive object={lightSphereMat} attach="material" />
      </instancedMesh>

      <instancedMesh
        ref={doorNormalsRef}
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
const maxLightSpheres = 1024;
const MAX_ROOM_POLY_VERTS = 64;
const maxTotalPolyVerts = 4096;
const maxDecorPoints = 1024;
const maxDoorNormals = 512;
const onPointHeight = 0.005;
const lightSphereHeight = 0;
const arrowLen = 0.5;
const arrowWidth = 0.25;
const doorNormalHeight = 0.05;
const tmpMat4 = new THREE.Matrix4();

export type State = {
  arrowGeo: THREE.BufferGeometry;
  debugPointsInst: THREE.InstancedMesh;
  debugPointInstanceIdToDecorId: { gmId: number; decorId: number }[];
  demoNavPath: Vec3[];
  demoNavPathShown: boolean;
  doorNormalsShown: boolean;
  gridShown: boolean;
  lightSpheres: null | THREE.InstancedMesh;
  lightSpheresShown: boolean;
  lightSpherePolyInfo: THREE.Vector4[];
  lightSpherePolyVerts: THREE.Vector2[];
  logGPUInfo: boolean;
  navMeshHelper: null | NavMeshHelperObject;
  navMeshShown: boolean;
  doPointsShown: boolean;
  originShown: boolean;
  pickOpenDoors: boolean;
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
  updateLightSpheres(): void;
  updateNavPathInstances(): void;
};
