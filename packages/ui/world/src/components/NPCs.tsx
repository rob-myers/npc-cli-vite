import { useStateRef } from "@npc-cli/util";
import { Suspense, useContext } from "react";
import { SkinnedMeshDemo } from "./SkinnedMeshDemo";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const _w = useContext(WorldContext);
  const _state = useStateRef(() => ({}));

  return (
    <group>
      {/* 🔔 fixes weird remount and object-pick async pixel read */}
      <Suspense>
        <SkinnedMeshDemo />
      </Suspense>
      {/* <group position={[1, 0, 1]}>
        <SkinnedMeshDemo />
      </group> */}
    </group>
  );
}
