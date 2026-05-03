import { useStateRef } from "@npc-cli/util";
import { ANY_QUERY_FILTER, findPath, type Vec3 } from "navcat";
import { useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { MemoizedDebugPhysicsColliders } from "./DebugPhysicsColliders";
import { WorldContext } from "./world-context";

export function Debug() {
  const w = useContext(WorldContext);
  const instRef = useRef<THREE.InstancedMesh>(null);
  const quad = useMemo(() => createXzQuad(), []);

  const state = useStateRef(
    (): State => ({
      demoNavPath: [] as Vec3[],
      demoNavPathShown: true,
      originShown: false,
      openDoorsOnClick: true,

      physicsLines: new THREE.BufferGeometry(),
      staticColliders: [] as (WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey })[],
      staticCollidersShown: false,

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
      onPhysicsDebugData(e: MessageEvent<WW.MsgFromWorker>) {
        if (e.data.type === "physics-debug-data-response") {
          // console.log('🔔 RECEIVED', e.data);
          state.staticColliders = e.data.items;
          state.physicsLines.dispose();
          state.physicsLines = new THREE.BufferGeometry();
          state.physicsLines.setAttribute("position", new THREE.BufferAttribute(new Float32Array(e.data.lines), 3));
          w.worker.worker.removeEventListener("message", state.onPhysicsDebugData);
          w.view.forceUpdate();
        }
      },
      showStaticColliders(shouldShow = !state.staticCollidersShown) {
        state.set({
          staticCollidersShown: shouldShow,
          staticColliders: [],
          physicsLines: new THREE.BufferGeometry(),
        });
        if (shouldShow) {
          w.worker.worker.addEventListener("message", state.onPhysicsDebugData);
          w.worker.worker.postMessage({ type: "get-physics-debug-data" } satisfies WW.MsgToWorker);
        }
      },
      updateInstances() {
        const inst = instRef.current;
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
      reset: { demoNavPathShown: true, originShown: true, openDoorsOnClick: true },
    },
  );

  w.debug = state;

  useEffect(() => {
    state.computeDemoPath();
    state.updateInstances();
  }, [w.nav]);

  useEffect(() => {
    const sub = w.events.subscribe({
      next(event) {
        if (state.openDoorsOnClick && event.key === "picked" && event.meta.type === "door") {
          const { gmId, doorId } = event.meta;
          w.door.setOpen(gmId, doorId); // toggle
        }
      },
    });
    return () => sub.unsubscribe();
  }, [state.openDoorsOnClick]);

  return (
    <>
      <mesh name="origin" position={[0, 5, 0]} visible={state.originShown}>
        <boxGeometry args={[0.05, 10, 0.05]} />
        <meshBasicMaterial color="red" transparent opacity={0.1} />
      </mesh>

      <instancedMesh
        ref={instRef}
        args={[quad, undefined, maxPathSegments]}
        frustumCulled={false}
        position={[0, 1, 0]}
        renderOrder={-6}
        visible={state.demoNavPathShown}
      >
        <meshBasicMaterial color="rgb(255, 50, 0)" transparent side={THREE.DoubleSide} />
      </instancedMesh>

      {state.staticColliders.length > 0 && (
        <group name="static-colliders" visible={state.staticColliders.length > 0}>
          {/* <lineSegments geometry={state.physicsLines}>
            <lineBasicMaterial color="green" />
          </lineSegments> */}
          <MemoizedDebugPhysicsColliders staticColliders={state.staticColliders} />
        </group>
      )}
    </>
  );
}

const pathWidth = 0.02;
const maxPathSegments = 256;
const tmpMat4 = new THREE.Matrix4();

export type State = {
  demoNavPath: Vec3[];
  demoNavPathShown: boolean;
  originShown: boolean;
  openDoorsOnClick: boolean;
  physicsLines: THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>;
  staticColliders: (WW.PhysicDebugItem & {
    parsedKey: WW.PhysicsParsedBodyKey;
  })[];
  staticCollidersShown: boolean;
  computeDemoPath(): void;
  onPhysicsDebugData(e: MessageEvent<WW.MsgFromWorker>): void;
  showStaticColliders(shouldShow?: boolean): void;
  updateInstances(): void;
};
