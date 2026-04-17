import { useStateRef } from "@npc-cli/util";
import { ANY_QUERY_FILTER, findPath, type Vec3 } from "navcat";
import { useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { WorldContext } from "./world-context";

export function Debug() {
  const w = useContext(WorldContext);
  const instRef = useRef<THREE.InstancedMesh>(null);
  const quad = useMemo(() => createXzQuad(), []);

  const state = useStateRef(
    () => ({
      demoNavPath: [] as Vec3[],
      demoNavPathShown: true,
      originShown: false,
      openDoorsOnClick: true,
      doorAnims: new Map<number, number>(), // instanceId → raf

      animateDoor(instanceId: number, target: number) {
        const existing = state.doorAnims.get(instanceId);
        if (existing !== undefined) cancelAnimationFrame(existing);
        let lastT = performance.now();
        const step = (now: number) => {
          const cur = w.door.openDoorsRatio[instanceId];
          const next = cur + Math.sign(target - cur) * ((now - lastT) / 1000) * doorSpeed;
          lastT = now;
          if ((target - cur) * (target - next) <= 0) {
            w.door.setOpen(instanceId, target);
            state.doorAnims.delete(instanceId);
          } else {
            w.door.setOpen(instanceId, next);
            state.doorAnims.set(instanceId, requestAnimationFrame(step));
          }
          if (w.disabled) w.r3f.invalidate();
        };
        state.doorAnims.set(instanceId, requestAnimationFrame(step));
      },

      computeDemoPath() {
        const gm = w.gms[0];
        const navMesh = w.nav?.navMesh;
        if (!navMesh || !gm) return void (state.demoNavPath = []);

        const { x, y, height } = gm.gridRect;
        const result = findPath(
          navMesh,
          [x + 0.5, 0, y + 0.5],
          [x + 0.5, 0, y + height * 0.95],
          [0.5, 0.1, 0.5],
          ANY_QUERY_FILTER,
        );
        state.demoNavPath = result.success ? result.path.map((p) => p.position) : [];
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

  useEffect(() => {
    state.computeDemoPath();
    state.updateInstances();
  }, [w.nav]);

  useEffect(() => {
    const sub = w.events.subscribe({
      next(event) {
        if (state.openDoorsOnClick && event.key === "picked" && event.meta.type === "doors") {
          const { instanceId } = event.meta;
          const current = w.door.openDoorsRatio[instanceId] ?? 0;
          state.animateDoor(instanceId, current > 0 ? 0 : 0.8);
        }
      },
    });
    return () => {
      sub.unsubscribe();
      for (const raf of state.doorAnims.values()) cancelAnimationFrame(raf);
      state.doorAnims.clear();
    };
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
    </>
  );
}

const doorSpeed = 2; // ratio units per second
const pathWidth = 0.02;
const maxPathSegments = 256;
const tmpMat4 = new THREE.Matrix4();
