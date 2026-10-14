import { float, mix, positionWorld, smoothstep, step, vec2 } from "three/tsl";
import type * as THREE from "three/webgpu";
import { deckConfig } from "./texture";

/**
 * Metres along an upright face, given its unit XZ normal.
 * On an axis-aligned face that is the world's x or z, so a seam meets the floor's
 */
export function alongFace(normalXZ: THREE.Node<"vec2">) {
  return positionWorld.xz.dot(vec2(normalXZ.y.negate(), normalXZ.x)) as THREE.Node<"float">;
}

/**
 * The deck's plate seams carried up a face, as a multiple for its colour.
 * Each plate line gets a groove with a lit lip, and a rivet each side
 * @param fromRivetRow metres from the height the rivets sit at
 */
export function panelSeams(along: THREE.Node<"float">, fromRivetRow: THREE.Node<"float">) {
  const { size, seamWidth, lipWidth } = deckConfig.plate;
  const { inset, radius } = deckConfig.rivet;
  const { grooveShade, rivetShade, lipLight, soften } = panelSeamConfig;
  /** Signed metres to the nearest plate line */
  const fromSeam = along.div(size).add(0.5).fract().sub(0.5).mul(size);
  const groove = smoothstep(seamWidth / 2, seamWidth / 2 + soften, fromSeam.abs()).oneMinus();
  const lip = step(seamWidth / 2, fromSeam).mul(step(fromSeam, seamWidth / 2 + lipWidth));
  // squared, to spare the root
  const toRivet = vec2(fromSeam.abs().sub(inset), fromRivetRow);
  const rivet = smoothstep((radius - soften) ** 2, radius ** 2, toRivet.dot(toRivet)).oneMinus();
  return mix(float(1), float(grooveShade), groove)
    .mul(mix(float(1), float(rivetShade), rivet))
    .add(lip.mul(lipLight)) as THREE.Node<"float">;
}

export const panelSeamConfig = {
  /** A groove's and a rivet's darkening, as a multiple */
  grooveShade: 0.45,
  rivetShade: 0.5,
  /** Added beside a groove, towards the light */
  lipLight: 0.5,
  /** Metres an edge is softened over */
  soften: 0.005,
};
