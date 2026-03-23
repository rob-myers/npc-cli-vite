import { useStateRef } from "@npc-cli/util";

export function Debug() {
  const state = useStateRef(
    () => ({
      unitCubeShown: false,
    }),
    {
      reset: { unitCubeShown: true },
    },
  );

  return (
    <mesh name="origin" position={[0, 0, 0]} visible={state.unitCubeShown}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="red" />
    </mesh>
  );
}
