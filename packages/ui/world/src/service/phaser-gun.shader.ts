import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fwidth,
  mix,
  normalize,
  normalLocal,
  positionLocal,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { type PhaserUniforms, type PhaserView, seenBy } from "./phaser.shader";
import {
  attachmentBoxes,
  attachmentHoles,
  type GunBox,
  gunAttachments,
  gunBoxes,
  gunColors,
  gunFaces,
  gunKindIndex,
  gunStripY,
  isHole,
} from "./phaser-gun";

export const MAX_PHASERS = 128;

export type GunResources = ReturnType<typeof createGunResources>;

/** One instance per gun shown, held along its npc's right forearm */
export function createGunResources() {
  /** The right forearm's origin, and its world scale by the gun's eased presence — then its world quaternion */
  const gunData = new Float32Array(MAX_PHASERS * 4);
  const quatData = new Float32Array(MAX_PHASERS * 4);
  /** Its npc's room slot, whether they are lit, and its attachment's index from `1`, else `0` */
  const roomData = new Float32Array(MAX_PHASERS * 3);
  /** Its beam's colour, then its glow as it charges or cools */
  const tintData = new Float32Array(MAX_PHASERS * 4);
  const attrs = [gunData, quatData, roomData, tintData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data.length / MAX_PHASERS).setUsage(THREE.DynamicDrawUsage),
  );

  const geo = new THREE.InstancedBufferGeometry();
  const { attributes, index } = gunGeometry();
  for (const [key, data] of Object.entries(attributes)) geo.setAttribute(key, new THREE.BufferAttribute(data, 3));
  geo.setIndex(index);
  ["phaserGun", "phaserQuat", "gunRooms", "gunTint"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // opaque, else drawn after the walls and over them
  const mat = new THREE.MeshBasicNodeMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return {
    mesh,
    mat,
    attrs,
    gunData,
    quatData,
    roomData,
    tintData,
    gunColor: uniform(new THREE.Color(gunShaderConfig.gunColor)),
    slotColor: uniform(new THREE.Color(gunShaderConfig.slotColor)),
    deadColor: uniform(new THREE.Color(gunShaderConfig.deadColor)),
    attachColor: uniform(new THREE.Color(gunShaderConfig.attachColor)),
    attachEdgeColor: uniform(new THREE.Color(gunShaderConfig.attachEdgeColor)),
    holeColor: uniform(new THREE.Color(gunShaderConfig.holeColor)),
  };
}

/**
 * Every box's faces as indexed triangles, bar those never seen: its position and flat normal, its box (`phaserBox`: kind, tone, and its
 * attachment's index from `1`, `0` for the gun, `-1` under any attachment), and per corner `gunBary`: `2` more
 * for a triangle's edge that is not its face's, so never edged. One attribute, as at most 8 buffers are bound.
 * A hole is drawn on its attachment's front instead (`gunNodes`). A cylinder's sides take normals from its axis, so shade round
 */
function gunGeometry() {
  const out: Record<string, number[]> = { position: [], normal: [], phaserBox: [], gunBary: [] };
  const index: number[] = [];
  const all = [
    ...gunBoxes.map((box) => ({ box, owner: box.under === true ? -1 : 0 })),
    ...gunAttachments.flatMap((key, i) => attachmentBoxes[key].map((box) => ({ box, owner: i + 1 }))),
  ].filter(({ box }) => isHole(box) === false);

  for (const { box, owner } of all) {
    const [cx, cz] = [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
    /** Another box shown whenever this is: the gun's own, or one of its kind */
    const covers = all.filter(
      (o) => o.box !== box && o.box.round === undefined && (o.owner === 0 || o.owner === owner),
    );
    for (const { points, normal, edges } of gunFaces(box)) {
      // flush against a box always there, it is never seen
      if (
        covers.some((o) =>
          points.every((p) =>
            within(
              p.map((v, i) => v + normal[i] * 1e-4),
              o.box,
            ),
          ),
        )
      )
        continue;
      const radial = box.round?.smooth === true && normal[1] === 0;
      const vertex = (p: number[], bary: number[]) => {
        out.position.push(...p);
        out.normal.push(...(radial ? unit([p[0] - cx, 0, p[2] - cz]) : normal));
        out.phaserBox.push(gunKindIndex[box.kind], box.tone, owner);
        out.gunBary.push(...bary);
        return out.position.length / 3 - 1;
      };
      const edged = (i: number) => (edges[i] === true ? 0 : 2);
      // a quad edged alike on its sides 0, 3 and 1, 2 shares its corners: its diagonal is never edged
      if (points.length === 4 && edged(0) === edged(3) && edged(1) === edged(2)) {
        const [x, z] = [edged(1), edged(0)];
        const at = [
          vertex(points[0], [1 + x, 2, z]),
          vertex(points[1], [x, 3, z]),
          vertex(points[2], [x, 2, 1 + z]),
          vertex(points[3], [x, 3, z]),
        ];
        index.push(at[0], at[1], at[2], at[0], at[2], at[3]);
        continue;
      }
      // else a fan from its first point: each triangle's edge opposite a corner is a face edge, or a diagonal
      const last = points.length - 1;
      for (let i = 1; i < last; i++) {
        const mask = [edged(i), i + 1 === last ? edged(last) : 2, i === 1 ? edged(0) : 2];
        [points[0], points[i], points[i + 1]].forEach((p, corner) => {
          index.push(
            vertex(
              p,
              [0, 1, 2].map((k) => (k === corner ? 1 : 0) + mask[k]),
            ),
          );
        });
      }
    }
  }
  return {
    attributes: Object.fromEntries(Object.entries(out).map(([key, values]) => [key, new Float32Array(values)])),
    index,
  };
}

/** Whether `p` lies in `box`, or on it */
const within = (p: number[], { min, max }: GunBox) => p.every((v, i) => v >= min[i] - 1e-6 && v <= max[i] + 1e-6);

/** The most holes an attachment has */
const maxHoles = Math.max(...attachmentHoles.map(({ holes }) => holes.length));

const unit = (v: number[]) => {
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
};

/** The gun, held along the forearm */
export function gunNodes(
  { gunColor, slotColor, deadColor, attachColor, attachEdgeColor, holeColor }: GunResources,
  { gain }: PhaserUniforms,
  view: PhaserView,
) {
  const { edgePx, attachEdgePx, edgeDarken, chargeBody, chargeEmitter, stripArmed, stripFull } = gunShaderConfig;
  const gun = attribute<"vec4">("phaserGun", "vec4");
  const quat = attribute<"vec4">("phaserQuat", "vec4");
  /** `v` turned by the forearm's quaternion */
  const turned = (v: THREE.Node<"vec3">) => {
    const inner = cross(quat.xyz, v).add(v.mul(quat.w)) as THREE.Node<"vec3">;
    return v.add(cross(quat.xyz, inner).mul(2)) as THREE.Node<"vec3">;
  };
  const rooms = attribute<"vec3">("gunRooms", "vec3");
  const box = attribute<"vec3">("phaserBox", "vec3");
  /** `0` for another attachment's box, or one under the attachment fitted, collapsed to nothing */
  const fitted = box.z
    .equal(0)
    .or(box.z.equal(rooms.z))
    .or(box.z.lessThan(0).and(rooms.z.equal(0)))
    .select(1, 0);
  const p = gun.xyz.add(turned(positionLocal.mul(gun.w.abs()).mul(fitted) as THREE.Node<"vec3">));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  // packed four to a varying: at most 16 are bound
  const glow = box.x.equal(gunKindIndex.emitter).select(1, 0) as THREE.Node<"float">;
  const isStrip = box.x.equal(gunKindIndex.strip).select(1, 0) as THREE.Node<"float">;
  /** Its emitter, its strip, an attachment's (white, edged black, its holes on its front), and its tone */
  const vKind = varying(vec4(glow, isStrip, box.z.greaterThan(0).select(1, 0), box.y), "vGunKind");
  const [vGlow, vStrip, vAttached, vTone] = [vKind.x, vKind.y, vKind.z, vKind.w];
  const tint = attribute<"vec4">("gunTint", "vec4");
  const charge = tint.w;
  const vTint = varying(tint.xyz, "vGunTint");
  /**
   * Armed (its quaternion's `w` positive: `q` and `-q` turn alike), dead (its scale negative), its charge, and how much
   * of the beam's colour it gains as it does: its emitter most, per vertex as each box is one or other
   */
  const vState = varying(
    vec4(
      quat.w.greaterThan(0).select(1, 0),
      gun.w.lessThan(0).select(1, 0),
      charge,
      charge.mul(mix(float(chargeBody), float(chargeEmitter), glow)).mul(isStrip.oneMinus()),
    ),
    "vGunState",
  );
  const [vArmed, vDead, vCharge, vCharged] = [vState.x, vState.y, vState.z, vState.w];
  /** Lit from above, so its faces tell apart */
  const lit = turned(normalLocal as THREE.Node<"vec3">).dot(normalize(vec3(0.3, 1, 0.2)));
  /** Seen, its shade, how far along the strip from its back (which a charge fills to), and the attachment fitted */
  const vMisc = varying(
    vec4(
      seenBy(view)(rooms.x, rooms.y),
      lit.mul(0.3).add(0.7),
      positionLocal.y.sub(gunStripY[0]).div(gunStripY[1] - gunStripY[0]),
      rooms.z,
    ),
    "vGunMisc",
  );
  const [vSeen, vShade, vStripT, vFitted] = [vMisc.x, vMisc.y, vMisc.z, vMisc.w];
  const vBary = varying(attribute<"vec3">("gunBary", "vec3"), "vGunBary");
  /** Where on its box, and whether it faces forward: an attachment's holes are drawn there */
  const vLocal = varying(vec4(positionLocal, normalLocal.y.lessThan(-0.5).select(1, 0)), "vGunLocal");
  const vForward = vLocal.w;
  const colorNode = Fn(() => {
    const a = view.objectPick.notEqual(0).select(0, vSeen.mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    // each face edged in a line a constant few pixels wide: pixels to the nearest of its triangle's edges that is its face's
    const toEdge = (b: THREE.Node<"float">) => b.div(fwidth(b).max(1e-6)) as THREE.Node<"float">;
    const fromEdge = toEdge(vBary.x).min(toEdge(vBary.y)).min(toEdge(vBary.z));
    const px = mix(float(edgePx), float(attachEdgePx), vAttached);
    const edge = smoothstep(px.sub(0.5), px.add(0.5), fromEdge).oneMinus();
    const beamColor = vTint.mul(gain.min(1));
    const emitter = mix(mix(mix(gunColor, holeColor, vAttached), deadColor, vDead).mul(vShade), beamColor, vArmed);
    /** Dark, faintly lit whilst armed, and filled from the back by the charge */
    const slot = mix(slotColor, beamColor, vArmed.mul(vDead.oneMinus()).mul(stripArmed)).mul(vShade);
    const filled = smoothstep(vStripT.sub(0.04), vStripT, vCharge);
    const strip = mix(slot, beamColor.mul(stripFull), filled);
    const shell = mix(mix(gunColor.mul(vTone), attachColor, vAttached).mul(vShade), emitter, vGlow);
    const body = mix(shell, strip, vStrip).add(beamColor.mul(vCharged));
    // the fitted attachment's holes, on its front: dark, glowing whilst armed, rimmed black
    const front = vForward.greaterThan(0.5).select(1, 0) as THREE.Node<"float">;
    /** Model units per pixel on its front, alike for every hole there */
    const unitsPx = fwidth(vLocal.x).max(fwidth(vLocal.z)).max(1e-6);
    let inHole = float(0) as THREE.Node<"float">;
    let rim = float(0) as THREE.Node<"float">;
    for (let k = 0; k < maxHoles; k++) {
      /** Of the fitted attachment's holes, its `k`th, else none: radius `-1` */
      const pick = (of: (h: (typeof attachmentHoles)[number]["holes"][number]) => number, none: number) =>
        attachmentHoles.reduceRight(
          (rest, { attachment, holes }) =>
            vFitted.equal(attachment).select(holes[k] === undefined ? none : of(holes[k]), rest),
          float(none) as THREE.Node<"float">,
        ) as THREE.Node<"float">;
      const [x, y, z, r] = [pick((h) => h.x, 0), pick((h) => h.y, 1), pick((h) => h.z, 0), pick((h) => h.r, -1)];
      const on = front.mul(vLocal.y.sub(y).abs().lessThan(0.002).select(1, 0));
      const fromRim = vLocal.xz.sub(vec2(x, z)).length().sub(r).div(unitsPx);
      inHole = inHole.max(smoothstep(0.5, -0.5, fromRim).mul(on));
      rim = rim.max(smoothstep(attachEdgePx + 0.5, attachEdgePx - 0.5, fromRim.abs()).mul(on));
    }
    const hole = mix(holeColor.mul(vDead.oneMinus()).add(deadColor.mul(vDead)), beamColor, vArmed).add(
      beamColor.mul(vCharge).mul(chargeEmitter),
    );
    // opaque, so it fades to black as the body does
    const darkened = mix(body, hole, inHole).mul(edge.mul(edgeDarken).oneMinus());
    const edged = mix(darkened, attachEdgeColor, edge.mul(vAttached).max(rim));
    return vec4(edged.mul(a), 1);
  })();

  return { vertexNode, colorNode };
}

export const gunShaderConfig = {
  /** Pixels of darker line along each of the gun's edges, and how far it darkens */
  edgePx: 1,
  edgeDarken: 0.6,
  /** An attachment's body, white, and its edges instead: pixels of line, and their colour. Its holes put away */
  attachColor: gunColors.attach,
  attachEdgePx: 1.5,
  attachEdgeColor: gunColors.attachEdge,
  holeColor: gunColors.hole,
  gunColor: gunColors.gun,
  paleGunColor: gunColors.paleGun,
  /** The strip along its side: dark, `stripArmed` of the beam's colour whilst armed, `stripFull` times it where charged */
  slotColor: gunColors.slot,
  stripArmed: 0.45,
  stripFull: 1.3,
  /** Its emitter, deactivated */
  deadColor: gunColors.dead,
  /** Charging, how much of the beam's colour the gun gains: its body, and its emitter */
  chargeBody: 0.25,
  chargeEmitter: 1.2,
} as const;
