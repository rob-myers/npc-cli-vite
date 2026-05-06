import { memo, useMemo } from "react";
import * as THREE from "three/webgpu";
import { colliderHeight } from "../const";
import { boxGeometry, cylinderGeometry } from "../service/geometry";

export const MemoizedDebugPhysicsColliders = memo(DebugPhysicsColliders);

export function DebugPhysicsColliders({
  staticColliders,
  w,
}: {
  staticColliders: (WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey })[];
  w: import("./World").State;
}) {
  const { tex, uid } = useMemo(() => createEdgeTexture(), []);

  return staticColliders.map(({ parsedKey, position, userData }, i) => {
    if (userData.type === "cylinder") {
      return (
        <mesh
          key={i}
          geometry={cylinderGeometry}
          position={[position.x, colliderHeight / 2, position.z]}
          scale={[userData.radius, colliderHeight, userData.radius]}
          renderOrder={toColliderMeta[parsedKey[0]]?.renderOrder ?? 3}
        >
          <meshBasicMaterial color={toColliderMeta[parsedKey[0]]?.color ?? "blue"} transparent />
        </mesh>
      );
    }

    if (userData.type === "cuboid") {
      return (
        <mesh
          key={i}
          geometry={boxGeometry}
          position={[position.x, colliderHeight / 2 + zFightDelta * i, position.z]}
          scale={[userData.width + zFightDelta, colliderHeight, userData.depth + zFightDelta]}
          rotation={[0, userData.angle, 0]}
          renderOrder={toColliderMeta[parsedKey[0]]?.renderOrder ?? 3}
        >
          <meshStandardNodeMaterial
            key={uid}
            map={tex}
            color={toColliderMeta[parsedKey[0]]?.color ?? "blue"}
            transparent
            alphaTest={0.1}
            opacityNode={w.view.objectPick.greaterThan(0).select(0, collidersOpacity)}
          />
        </mesh>
      );
    }

    return null;
  });
}

const toColliderMeta = {
  inside: { color: "yellow", renderOrder: 1 },
  nearby: { color: "white", renderOrder: 2 },
} as Record<string, { color: string; renderOrder: number }>;

const zFightDelta = 0.0001;

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

const collidersOpacity = 0.25;
