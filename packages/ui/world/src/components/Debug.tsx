import { useStateRef } from "@npc-cli/util";

export function Debug() {
  const state = useStateRef(
    () => ({
      unitCubeShown: true,
    }),
    {
      reset: { unitCubeShown: true },
    },
  );

  return (
    <mesh name="origin" position={[0, 5, 0]} visible={state.unitCubeShown}>
      {/* <boxGeometry args={[0.175, 10, 0.175]} /> */}
      <boxGeometry args={[0.05, 10, 0.05]} />
      <meshBasicMaterial color="red" transparent opacity={0.1} />
    </mesh>
  );
}
