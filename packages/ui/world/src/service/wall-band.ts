import { attribute, float, lights, mix, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

type World = import("@npc-cli/util").UseStateRef<import("../components/World").State>;

/** `[alphaFade, colorFade]`: `prod` fades alpha out, the other modes fade colour to black */
export function fadeSplit(focus: THREE.Node<"float">, fade: THREE.Node<"float">) {
  return [mix(float(1), fade, focus), mix(fade, float(1), focus)] as const;
}

/**
 * The band a wall wears at either end of itself — the trim along the ceiling and the skirting
 * along the floor. ONE factory for both, so the two cannot drift apart in style or colour.
 *
 * White, and fading out with the wall it dresses — but lifted in `prod`, where the world ends in
 * BLACK and a half-opaque grey band over that is all but gone. Its colour comes from the INSTANCE,
 * which three multiplies into the node below
 */
export function createWallBandMaterial(w: World) {
  const m = new THREE.MeshStandardNodeMaterial({
    side: THREE.FrontSide, // 1 draw call
    transparent: true,
    depthWrite: false,
  });
  const fade = w.view.fadeRoomsFx.fadeAtPair(attribute<"vec2">("roomSlots", "vec2"));
  const prod = w.view.fadeRoomsFx.prodNode;
  const [alphaFade, colorFade] = fadeSplit(prod, fade);
  const bright = mix(float(1), float(wallBandProdBright), prod);
  const opacity = mix(float(wallBandOpacity), float(wallBandProdOpacity), prod);
  m.opacityNode = w.view.objectPick.equal(0).select(opacity.mul(alphaFade), float(0));
  m.colorNode = w.view.fadeRoomsFx.dropPickWhenHidden(vec3(bright).mul(colorFade), fade, w.view.objectPick);
  m.lightsNode = lights([new THREE.AmbientLight("#fff", 0.5)]);
  return m;
}

/** What every band instance is coloured, and how tall one stands */
export const wallBandColor = "#444";
export const wallBandHeight = 0.2;
/** Its opacity, and what `prod` lifts that and its colour to */
const wallBandOpacity = 0.6;
const wallBandProdOpacity = 0.5;
const wallBandProdBright = 1;
