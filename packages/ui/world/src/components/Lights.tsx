import type { Vec3 } from "navcat";

export default function Lights() {
  return (
    <group name="lights">
      <ambientLight intensity={ambientLightIntensity} color="#fff" />

      <directionalLight
        position={[Math.cos(2 * Math.PI * (0 / 3)), 1, Math.sin(2 * Math.PI * (0 / 3))]}
        lookAt={origin}
        intensity={directionLightIntensity}
        // color="blue"
      />
      <directionalLight
        position={[Math.cos(2 * Math.PI * (1 / 3)), 1, Math.sin(2 * Math.PI * (1 / 3))]}
        lookAt={origin}
        intensity={directionLightIntensity}
      />
      <directionalLight
        position={[Math.cos(2 * Math.PI * (2 / 3)), 1, Math.sin(2 * Math.PI * (2 / 3))]}
        lookAt={origin}
        intensity={directionLightIntensity}
      />
    </group>
  );
}

const origin: Vec3 = [0, 0, 0];
const directionLightIntensity = 0.15;
const ambientLightIntensity = 1;
