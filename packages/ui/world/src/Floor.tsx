import { Box } from "@react-three/drei";

export default function Floor() {
  return (
    <group>
      <Box args={[1, 1, 1, 10, 1, 10]} position={[0, 0, 0]} scale={[100, 0.1, 100]}>
        <meshBasicMaterial wireframe />
      </Box>
    </group>
  );
}
