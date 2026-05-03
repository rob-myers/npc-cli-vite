import { memo } from "react";
import { colliderHeight } from "../const";
import { boxGeometry, cylinderGeometry } from "../service/geometry";

export const MemoizedDebugPhysicsColliders = memo(DebugPhysicsColliders);

/**
 * 🔔 debug only (inefficient)
 */
export function DebugPhysicsColliders({
  staticColliders,
}: {
  staticColliders: (WW.PhysicDebugItem & { parsedKey: WW.PhysicsParsedBodyKey })[];
}) {
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
          <meshBasicMaterial
            color={toColliderMeta[parsedKey[0]]?.color ?? "blue"}
            transparent
            // wireframe
            opacity={0.25}
          />
        </mesh>
      );
    }

    if (userData.type === "cuboid") {
      return (
        <mesh
          key={i}
          geometry={boxGeometry} // fix z-fighting
          position={[position.x, colliderHeight / 2 + zFightDelta, position.z]}
          scale={[userData.width + zFightDelta, colliderHeight, userData.depth + zFightDelta]} // fix z-fighting
          rotation={[0, userData.angle, 0]}
          renderOrder={toColliderMeta[parsedKey[0]]?.renderOrder ?? 3}
        >
          <meshBasicMaterial color={toColliderMeta[parsedKey[0]]?.color ?? "blue"} transparent opacity={0.25} />
        </mesh>
      );
    }

    return null;
  });
}

const toColliderMeta = {
  inside: { color: "yellow", renderOrder: 1 },
  nearby: { color: "green", renderOrder: 0 },
} as Record<string, { color: string; renderOrder: number }>;

const zFightDelta = 0.0001;
