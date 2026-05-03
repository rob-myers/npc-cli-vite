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
          position={[position.x, colliderHeight / 2 + zFightDelta * i, position.z]}
          scale={[userData.width + zFightDelta, colliderHeight, userData.depth + zFightDelta]} // fix z-fighting
          rotation={[0, userData.angle, 0]}
          renderOrder={toColliderMeta[parsedKey[0]]?.renderOrder ?? 3}
        >
          <meshBasicMaterial
            color={toColliderMeta[parsedKey[0]]?.color ?? "blue"}
            wireframe={true}
            transparent
            opacity={1}
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
