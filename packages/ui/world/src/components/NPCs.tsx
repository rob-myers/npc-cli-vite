import { useStateRef } from "@npc-cli/util";
import { Suspense, useContext } from "react";
import { SkinnedMeshTemplateDemo } from "./SkinnedMeshTemplateDemo";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const _w = useContext(WorldContext);
  const _state = useStateRef(() => ({}));

  return (
    <group>
      {/* 🔔 fixes weird remount and object-pick async pixel read */}
      <Suspense>
        <SkinnedMeshTemplateDemo />
      </Suspense>
      {/* <group position={[1, 0, 1]}>
        <SkinnedMeshTemplateDemo />
      </group> */}
    </group>
  );
}
