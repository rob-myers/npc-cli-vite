import { color, float, mix, positionWorld, smoothstep, step, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { panelSeams } from "./panel-seams";
import { deckConfig } from "./texture";

/** How an obstacle's skirt is drawn: a skirt's kind is its index here */
export const skirtKinds = ["panelled", "upholstered", "glass", "cargo"] as const;

/** A skirt's kind, an index of `skirtKinds`, from its obstacle's meta */
export function skirtKindOf(meta: Meta) {
  if (meta.window === true) return 2;
  if (meta.cargo === true) return 3;
  return meta.chair === true || meta.bed === true || meta.sofa === true ? 1 : 0;
}

/**
 * A skirt's colour as a multiple, by `kind`, a node of an index of `skirtKinds`.
 * `along` is metres along its face, `y` metres off the deck, `top` its top's height, and `u, v` across and up it `0`-`1`
 */
export function skirtPanel({ kind, along, y, top, u, v }: SkirtPanelArgs) {
  const c = skirtPanelConfig;
  /** Darker towards the deck, as a contact shadow */
  const grounded = mix(float(c.floorShade), float(1), y.div(c.shadeHeight).clamp(0, 1));
  // its rivets hang off the skirt's top
  const hardPanel = grounded.mul(panelSeams(along, top.sub(y).sub(deckConfig.rivet.inset)));
  /** Upholstery: no seams, and a face that swells from its borders to its middle */
  const dome = u.oneMinus().mul(u).mul(v.oneMinus()).mul(v).mul(16);
  /** `dome` plumped, by a polynomial where a sine and a root would do the same */
  const swell = dome.mul(dome.oneMinus().add(1));
  const softPanel = grounded.mul(mix(float(c.softEdgeShade), float(c.softMidLight), swell));
  /** Frosted glass: opaque and pale, lighter towards its top, mottled at two sizes */
  const speck = (perMetre: number) => hashCell(vec2(along, y).mul(perMetre).floor());
  const frost = speck(c.glassFinePerMetre).add(speck(c.glassCoarsePerMetre)).mul(0.5);
  const glassPanel = color(c.glassTint)
    .mul(mix(float(c.glassLowLight), float(c.glassTopLight), v))
    .mul(mix(float(1 - c.glassGrain), float(1), frost));
  /** A cargo container: trapezoid corrugation, between rails at its foot and top, and posts at its ends */
  const pitch = along.div(c.cargoPitchMetres).fract();
  /** `0` before `at` in its pitch, `1` after, softened */
  const past = (at: number) => smoothstep(at - c.cargoSoften, at + c.cargoSoften, pitch);
  const { crest, fall, trough, rise } = c.cargoShades;
  const [toFall, toTrough, toRise] = c.cargoProfile;
  const corrugated = mix(
    mix(mix(float(crest), float(fall), past(toFall)), float(trough), past(toTrough)),
    float(rise),
    past(toRise),
  );
  /** Within `metres` of its foot or top */
  const nearEdge = (metres: number) => step(y, metres).max(step(top.sub(y), metres));
  const rail = nearEdge(c.cargoRailMetres);
  /** A rail's lip, lit along its inner edge */
  const lip = rail.oneMinus().mul(nearEdge(c.cargoRailMetres + c.cargoLipMetres));
  const post = step(u, c.cargoPostFraction).max(step(u.oneMinus(), c.cargoPostFraction));
  const postEdge = step(u, c.cargoPostFraction * 1.25)
    .max(step(u.oneMinus(), c.cargoPostFraction * 1.25))
    .sub(post);
  const frame = mix(float(c.cargoRailShade), float(c.cargoPostShade), post);
  const cargoPanel = grounded.mul(
    mix(mix(corrugated, frame, rail.max(post)), float(c.cargoLipLight), lip.max(postEdge).clamp(0, 1)),
  );

  const isSoft = step(0.5, kind).mul(step(kind, 1.5));
  const isGlass = step(1.5, kind).mul(step(kind, 2.5));
  const isCargo = step(2.5, kind);
  return mix(mix(vec3(mix(hardPanel, softPanel, isSoft)), glassPanel, isGlass), vec3(cargoPanel), isCargo);
}

/** One canvas per kind of `skirtKinds`, each a flat skirt drawn by `renderer` */
export async function renderSkirtPreviews(renderer: THREE.WebGPURenderer) {
  const { width, height, pxPerMetre, grey } = skirtPreview;
  const [pw, ph] = [Math.round(width * pxPerMetre), Math.round(height * pxPerMetre)];
  const target = new THREE.RenderTarget(pw, ph);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(width, height).translate(width / 2, height / 2, 0);
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1, 1);
  const before = renderer.getRenderTarget();
  const canvases: HTMLCanvasElement[] = [];
  try {
    // one at a time: they share the target
    for (const kind of skirtKinds.keys()) {
      const material = new THREE.MeshBasicNodeMaterial();
      const panel = skirtPanel({
        kind: float(kind),
        along: positionWorld.x,
        y: positionWorld.y,
        top: float(height),
        u: uv().x,
        v: uv().y,
      });
      material.colorNode = vec3(grey).mul(panel);
      const scene = new THREE.Scene().add(new THREE.Mesh(geometry, material));
      renderer.setRenderTarget(target);
      await renderer.renderAsync(scene, camera);
      const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, pw, ph)) as Uint8Array;
      material.dispose();
      // each row padded to WebGPU's 256-byte alignment
      const [rowBytes, image] = [Math.ceil((pw * 4) / 256) * 256, new ImageData(pw, ph)];
      for (let row = 0; row < ph; row++)
        image.data.set(pixels.subarray(row * rowBytes, row * rowBytes + pw * 4), row * pw * 4);
      const canvas = Object.assign(document.createElement("canvas"), { width: pw, height: ph });
      canvas.getContext("2d")?.putImageData(image, 0, 0);
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    renderer.setRenderTarget(before);
    target.dispose();
    geometry.dispose();
  }
}

/** A cell's `0`-`1` hash, with no trig in it (Hoskins' `hash12`) */
function hashCell(cell: THREE.Node<"vec2">) {
  const p = cell.xyx.mul(0.1031).fract();
  const q = p.add(p.dot(p.yzx.add(33.33)));
  return q.x.add(q.y).mul(q.z).fract() as THREE.Node<"float">;
}

/** A skirt's look by kind, over `panelSeams`, and its shadow towards the deck */
export const skirtPanelConfig = {
  /** The multiple at the deck, easing to none `shadeHeight` metres up */
  floorShade: 0.55,
  shadeHeight: 0.6,
  /** An upholstered face's multiple at its borders, and at its middle */
  softEdgeShade: 0.7,
  softMidLight: 1.3,
  /** Frosted glass: its colour as a multiple of the base, from its foot to its top */
  glassTint: "#cfe0f2",
  glassLowLight: 1.6,
  glassTopLight: 2.4,
  /** How far the frosting darkens, and its two sizes of speck to the metre */
  glassGrain: 0.45,
  glassFinePerMetre: 140,
  glassCoarsePerMetre: 35,
  /** A container's corrugation: metres from one crest to the next, and where its fall, trough and rise start in it */
  cargoPitchMetres: 0.28,
  cargoProfile: [0.32, 0.46, 0.82] as const,
  /** Each part's multiple: the rise faces the light, the fall away from it */
  cargoShades: { crest: 1, fall: 0.62, trough: 0.82, rise: 1.18 },
  /** Its parts' edges softened over this share of a pitch */
  cargoSoften: 0.02,
  /** Its rails' height in metres, and the lit lip along each, then their multiple */
  cargoRailMetres: 0.12,
  cargoLipMetres: 0.015,
  cargoRailShade: 0.7,
  cargoLipLight: 1.3,
  /** Its posts' share of a face's width at either end, and their multiple */
  cargoPostFraction: 0.035,
  cargoPostShade: 0.6,
};

/** The modal's previews: metres wide and high, pixels to the metre, and their grey before `skirtPanel` */
const skirtPreview = { width: 2.4, height: 1.8, pxPerMetre: 120, grey: 0.45 };

type SkirtPanelArgs = Record<"kind" | "along" | "y" | "top" | "u" | "v", THREE.Node<"float">>;
