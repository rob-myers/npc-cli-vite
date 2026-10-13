import { attribute, float, lights, mix, positionGeometry, smoothstep, step, uniform, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

type World = import("@npc-cli/util").UseStateRef<import("../components/World").State>;

/** `[alphaFade, colorFade]`: `sight` fades alpha out, the other modes fade colour to black */
export function fadeSplit(focus: THREE.Node<"float">, fade: THREE.Node<"float">) {
  return [mix(float(1), fade, focus), mix(fade, float(1), focus)] as const;
}

/**
 * The band a wall wears at either end of itself — the trim along the ceiling and the skirting
 * along the floor. ONE factory for both, so the two cannot drift apart in style or colour.
 *
 * Ribbed along its length (`wallBandRibs`). White, and fading out with the wall it dresses — but lifted in `sight`, where the world ends in
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
  const sight = w.view.fadeRoomsFx.sightNode;
  const [alphaFade, colorFade] = fadeSplit(sight, fade);
  const bright = mix(float(1), float(wallBandSightBright), sight).mul(wallBandBrightness);
  const opacity = mix(float(wallBandOpacity), float(wallBandSightOpacity), sight);
  m.opacityNode = w.view.objectPick.equal(0).select(opacity.mul(alphaFade), float(0));
  // ribbed along its length, with no upright seam: an obstacle's skirt runs the other way
  const { count, grooveWidth, grooveShade, lipWidth, lipLight, soften } = wallBandRibs;
  const up = positionGeometry.y;
  /** Signed metres to the nearest line between two ribs */
  const fromGroove = up
    .mul(count)
    .add(0.5)
    .fract()
    .sub(0.5)
    .mul(wallBandHeight / count);
  const within = step(up.sub(0.5).abs(), 0.5 - 0.5 / count); // not the band's own edges
  const groove = smoothstep(grooveWidth / 2, grooveWidth / 2 + soften, fromGroove.abs())
    .oneMinus()
    .mul(within);
  const lip = step(grooveWidth / 2, fromGroove)
    .mul(step(fromGroove, grooveWidth / 2 + lipWidth))
    .mul(within);
  const ribs = mix(float(1), float(grooveShade), groove).add(lip.mul(lipLight));
  m.colorNode = w.view.fadeRoomsFx.dropPickWhenHidden(vec3(bright).mul(ribs).mul(colorFade), fade, w.view.objectPick);
  m.lightsNode = lights([new THREE.AmbientLight("#fff", 0.5)]);
  return m;
}

/** `theme.walls.bandBrightness`, set on a theme change. One for every World: bands share a look */
export const wallBandBrightness = uniform(1);

/** What every band instance is coloured, and how tall one stands */
export const wallBandColor = "#444";
export const wallBandHeight = 0.2;
/** The ribs run along a band: how many, and the groove between two with its lit lip, in metres */
const wallBandRibs = {
  count: 3,
  grooveWidth: 0.012,
  grooveShade: 0.5,
  lipWidth: 0.008,
  lipLight: 0.35,
  /** Metres an edge is softened over */
  soften: 0.003,
};
/** Its opacity, and what `sight` lifts that and its colour to */
const wallBandOpacity = 0.6;
const wallBandSightOpacity = 0.5;
const wallBandSightBright = 1;
