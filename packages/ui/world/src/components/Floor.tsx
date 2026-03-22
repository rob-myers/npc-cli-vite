import { useStateRef } from "@npc-cli/util";
import { Box } from "@react-three/drei";
import { createCheckerBoxMaterial } from "../service/three-shader";

export default function Floor() {
  const state = useStateRef(() => ({
    testMaterial: createCheckerBoxMaterial(),
  }));

  return (
    <group>
      <Box args={[1, 1, 1, 10, 1, 10]} position={[0, 0, 0]} scale={[100, 0.001, 100]} material={state.testMaterial} />
    </group>
  );
}
