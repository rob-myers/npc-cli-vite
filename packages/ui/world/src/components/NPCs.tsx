import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import { SkinnedMeshTemplateDemo } from "./demo";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const w = useContext(WorldContext);
  const state = useStateRef(() => ({}));

  // ensure initial render on show hidden World tab
  useEffect(() => void (w.view?.canvas && state.update()), [w.view?.canvas]);

  return (
    <group>
      <SkinnedMeshTemplateDemo />
      {/* <group position={[1, 0, 1]}>
        <SkinnedMeshTemplateDemo />
      </group> */}
    </group>
  );
}
