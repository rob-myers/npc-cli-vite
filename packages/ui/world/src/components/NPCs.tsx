import { SkinnedMeshTemplateDemo } from "./Demo";

export default function NPCs() {
  return (
    <group>
      <SkinnedMeshTemplateDemo />
      {/* <group position={[1, 0, 1]}>
        <SkinnedMeshTemplateDemo />
      </group> */}
    </group>
  );
}
