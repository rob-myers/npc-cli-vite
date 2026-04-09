import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import { SkinnedMeshTemplateDemo } from "./SkinnedMeshTemplateDemo";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const _w = useContext(WorldContext);
  const _state = useStateRef(() => ({}));

  return (
    <group>
      <SkinnedMeshTemplateDemo />
      {/* <group position={[1, 0, 1]}>
        <SkinnedMeshTemplateDemo />
      </group> */}
    </group>
  );
}
