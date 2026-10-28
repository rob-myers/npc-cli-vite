import { Mat } from "@npc-cli/util/geom";
import * as THREE from "three/webgpu";
import { decorCuboidHeight, sguToWorldScale } from "../const.env";
import { embedXZMat4, getRotAxisMatrix, setRotMatrixAboutPoint } from "./geometry";

/** A decor that stops a phaser shot: a quad, bar a switch or a keycard */
export function stopsShots(d: Geomorph.Decor): d is Geomorph.DecorQuad {
  return d.type === "quad" && d.meta.switch === undefined && d.meta.item !== "keycard";
}

/** The matrix `Decor` draws quad `decor` with, onto its unit cuboid. `entry`: its image's size on the decor sheets */
export function quadMatrix(decor: Geomorph.DecorQuad, entry: QuadImage, out: THREE.Matrix4) {
  tmpMat.setMatrixValue(decor.transform);
  // e.g. key=switch and screen
  const shouldTilt = decor.meta.tilt === true;
  let tiltMat4: THREE.Matrix4 | null = null;
  if (shouldTilt) {
    const { a, b, c, d } = tmpMat;
    // NORMALISED: `makeRotationAxis` takes a unit axis, and this one is a column of the
    // decor's own transform — so a scaled decor would hand it a longer vector, and what
    // came back would not be a rotation at all
    const axisLength = Math.hypot(a, b) || 1;
    tiltMat4 = getRotAxisMatrix(a / axisLength, 0, b / axisLength, (a * d - b * c > 0 ? 1 : -1) * 90);
    setRotMatrixAboutPoint(tiltMat4, decor.topCenter.x, decor.meta.y, decor.topCenter.y);
  }
  //biome-ignore format: preserve newlines
  tmpMat.preMultiply([ entry.originalWidth * sguToWorldScale, 0, 0, entry.originalHeight * sguToWorldScale, 0, 0]);
  // meta.y is top and meta.h is height (unsupported for tilt)
  const yScale = decor.meta.h ?? decorCuboidHeight;
  //biome-ignore format: preserve newlines
  const mat4 = embedXZMat4(tmpMat, { yScale, yHeight: (decor.meta.y ?? 0) + (shouldTilt ? 0 : -yScale), mat4: out });
  if (tiltMat4) mat4.premultiply(tiltMat4);
  return mat4;
}

/** Quad `decor` as a ray meets it: its drawn cuboid's outline in plan, and its heights */
export function quadBox(decor: Geomorph.DecorQuad, entry: QuadImage): WW.RayDecor {
  const m = quadMatrix(decor, entry, tmpMat4);
  const points: Geom.VectJson[] = [];
  let [bottom, top] = [Infinity, -Infinity];
  for (const [x, y, z] of unitCorners) {
    const v = tmpVec.set(x, y, z).applyMatrix4(m);
    points.push({ x: v.x, y: v.z });
    [bottom, top] = [Math.min(bottom, v.y), Math.max(top, v.y)];
  }
  return { decorKey: decor.key, outline: hullOf(points), top, bottom };
}

/** Its convex hull, anticlockwise: monotone chain */
function hullOf(points: Geom.VectJson[]) {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (ps: Geom.VectJson[]) => {
    const out: Geom.VectJson[] = [];
    for (const p of ps) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

type QuadImage = { originalWidth: number; originalHeight: number };

const unitCorners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z] as const)));
const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpVec = new THREE.Vector3();
