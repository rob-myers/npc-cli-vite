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
    <mesh name="origin" position={[0, 5, 0]} visible={state.unitCubeShown}>
      <boxGeometry args={[0.1, 10, 0.1]} />
      <meshBasicMaterial color="red" />
    </mesh>
  );
}
