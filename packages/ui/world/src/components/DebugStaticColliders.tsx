import { memo } from "react";
import { colliderHeight } from "../const";
import { boxGeometry, cylinderGeometry } from "../service/geometry";

export const MemoizedStaticColliders = memo(DebugStaticColliders);

/**
 * 🔔 debug only (inefficient)
 */
export function DebugStaticColliders({
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
          <meshBasicMaterial color={toColliderMeta[parsedKey[0]]?.color ?? "blue"} transparent opacity={0.25} />
        </mesh>
      );
    }

    if (userData.type === "cuboid") {
      return (
        <mesh
          key={i}
          geometry={boxGeometry} // fix z-fighting
          position={[position.x, colliderHeight / 2 + i * 0.0001, position.z]}
          scale={[userData.width, colliderHeight, userData.depth]}
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
  inside: { color: "green", renderOrder: 1 },
  nearby: { color: "red", renderOrder: 0 },
} as Record<string, { color: string; renderOrder: number }>;
