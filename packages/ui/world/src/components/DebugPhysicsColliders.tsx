import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { colliderHeight, wallHeight } from "../const";
import { boxGeometry, cylinderGeometry } from "../service/geometry";

export const MemoizedDebugPhysicsColliders = memo(DebugPhysicsColliders);

type Collider = WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey };

/**
 * Every static collider, as two instanced meshes: the cuboids as boxes, the circles as cylinders.
 * An `inside` sensor sits within its `nearby` one, so it stands wall-high over the slab of it —
 * and is drawn LAST: nothing here writes depth, so the instance order is what shows through what
 */
export function DebugPhysicsColliders({
  staticColliders,
  w,
}: {
  staticColliders: Collider[];
  w: import("./World").State;
}) {
  const { tex, uid } = useMemo(() => createEdgeTexture(), []);
  const { cuboids, circles } = useMemo(() => {
    const sorted = [...staticColliders].sort((a, b) => lookOf(a).order - lookOf(b).order);
    return { cuboids: sorted.filter(isCuboid), circles: sorted.filter((x) => !isCuboid(x)) };
  }, [staticColliders]);
  const opacityWhenPicking = (opacity: number) => w.view.objectPick.greaterThan(0).select(0, opacity);

  return (
    <>
      <InstancedColliders items={cuboids} geometry={boxGeometry}>
        <meshStandardNodeMaterial
          key={uid}
          map={tex}
          transparent
          alphaTest={0}
          opacityNode={opacityWhenPicking(0.25)}
          depthWrite={false}
        />
      </InstancedColliders>
      <InstancedColliders items={circles} geometry={cylinderGeometry}>
        <meshBasicMaterial transparent opacityNode={opacityWhenPicking(0.025)} depthWrite={false} />
      </InstancedColliders>
    </>
  );
}

function InstancedColliders({
  items,
  geometry,
  children,
}: React.PropsWithChildren<{ items: Collider[]; geometry: THREE.BufferGeometry }>) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const inst = ref.current;
    if (inst === null) return;
    items.forEach(({ parsedKey, position, userData }, i) => {
      const { height, color } = lookOf({ parsedKey });
      // a hair apart in every dimension, else coincident colliders z-fight
      tmpPos.set(position.x, height / 2 + zFightDelta * i, position.z);
      if (userData.type === "cuboid") {
        tmpQuat.setFromAxisAngle(yAxis, userData.angle);
        tmpScale.set(userData.width + zFightDelta, height, userData.depth + zFightDelta);
      } else {
        tmpQuat.identity();
        tmpScale.set(userData.radius, height, userData.radius);
      }
      inst.setMatrixAt(i, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
      inst.setColorAt(i, tmpColor.set(color));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor !== null) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [items]);

  if (items.length === 0) return null;

  // keyed by the count: an instanced mesh cannot grow, so a change remakes it
  return (
    <instancedMesh key={items.length} ref={ref} args={[geometry, undefined, items.length]} renderOrder={3}>
      {children}
    </instancedMesh>
  );
}

const isCuboid = (x: Collider) => x.userData.type === "cuboid";

/** How a collider is drawn, by the kind its body key starts with */
const colliderLooks: Record<string, { color: string; order: number; height: number }> = {
  other: { color: "orange", order: 0, height: colliderHeight },
  nearby: { color: "white", order: 1, height: colliderHeight },
  inside: { color: "red", order: 2, height: wallHeight },
};
const lookOf = ({ parsedKey }: Pick<Collider, "parsedKey">) => colliderLooks[parsedKey[0]] ?? colliderLooks.other;

const zFightDelta = 0.0001;
const yAxis = new THREE.Vector3(0, 1, 0);
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpColor = new THREE.Color();

function createEdgeTexture() {
  const size = 128;
  const border = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  // diagonal hatching
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1;
  const spacing = 12;
  for (let offset = -size; offset < size * 2; offset += spacing) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + size, size);
    ctx.stroke();
  }

  // solid border edges
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.fillRect(0, 0, size, border);
  ctx.fillRect(0, size - border, size, border);
  ctx.fillRect(0, 0, border, size);
  ctx.fillRect(size - border, 0, border, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return { tex, uid: crypto.randomUUID() };
}
