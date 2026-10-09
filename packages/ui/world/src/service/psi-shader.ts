import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  Discard,
  exp,
  Fn,
  float,
  fract,
  fwidth,
  If,
  int,
  ivec2,
  Loop,
  log,
  max,
  mix,
  positionLocal,
  smoothstep,
  textureLoad,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_GEOMORPH_INSTANCES } from "../const.env";
import { defaultPsiTune } from "../const.npc";
import type { FadeRooms } from "./fade-rooms";
import { type RoomSlots, slotUvPerMetre } from "./room-slots";

export type PsiResources = ReturnType<typeof createPsiResources>;

export function createPsiResources() {
  // a wedge off the player: its apex, a row at the ramp's end, a row at the span — see `psiNodes`
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, -1, 1, 0, 1, 0, 1, -1, 0, 1, 1], 3));
  geo.setIndex([0, 1, 2, 1, 3, 4, 1, 4, 2]);

  // a texel per slot, the player's first: world `xz`, eased presence, peak
  const npcData = new Float32Array(MAX_PSI * 4);
  const npcTex = new THREE.DataTexture(npcData, MAX_PSI, 1, THREE.RGBAFormat, THREE.FloatType);
  npcTex.minFilter = npcTex.magFilter = THREE.NearestFilter;
  npcTex.needsUpdate = true;
  const slotCount = uniform(0);
  /** Unit, the way the player faces in world `xz` — see `Psi.upload` */
  const facing = uniform(new THREE.Vector2(1, 0));
  const flowPhase = uniform(0);
  /** Metres along `facing` the sheet takes to reach `rampPeak`, level beyond */
  const rampEnd = uniform(0);
  /** The height of the sheet from `rampEnd` on: the target's peak, the player's own with none */
  const rampPeak = uniform(0);
  /** Metres along `facing` the wedge runs: past everyone's reach */
  const span = uniform(0);
  const reach = uniform(defaultPsiTune.reach);
  const gap = uniform(defaultPsiTune.gap);
  const width = uniform(defaultPsiTune.width);
  const opacity = uniform(defaultPsiTune.opacity);
  const color = uniform(new THREE.Color(defaultPsiTune.color));
  /** From `theme.npcs.fxStrength` */
  const gain = uniform(1);
  /** `1` whilst additive, when strength past full whitens the line; `0` over a pale deck */
  const whiten = uniform(1);
  /** Pixels of dark edging either side of a line, for contrast over a pale deck; `0` whilst additive */
  const casing = uniform(0);
  /** A cased line's core: the hue at its palest, down to white */
  const coreColor = uniform(new THREE.Color("#fff"));
  /** Scales the finished line's alpha: over a pale deck, where its strength only firms it up */
  const fade = uniform(1);
  // per geomorph, three `vec4`s — see `syncGms`
  const gmValues = Array.from({ length: MAX_GEOMORPH_INSTANCES * 3 }, () => new THREE.Vector4());
  const gmArray = uniformArray<"vec4">(gmValues, "vec4");
  const gmCount = uniform(0);

  // additive, so the lines glow over a dark floor — `Psi.syncTune` lays them over a pale one instead
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return {
    geo,
    mat,
    mesh,
    npcData,
    npcTex,
    slotCount,
    facing,
    flowPhase,
    rampEnd,
    rampPeak,
    span,
    reach,
    gap,
    width,
    opacity,
    color,
    gain,
    whiten,
    casing,
    coreColor,
    fade,
    gmValues,
    gmArray,
    gmCount,
  };
}

export function psiNodes(
  {
    npcTex,
    slotCount,
    facing,
    flowPhase,
    rampEnd,
    rampPeak,
    span,
    reach,
    gap,
    width,
    opacity,
    color,
    gain,
    whiten,
    casing,
    coreColor,
    fade,
    gmArray,
    gmCount,
  }: PsiResources,
  {
    fadeRoomsFx,
    objectPick,
    foldNode,
    roomSlots,
  }: {
    fadeRoomsFx: FadeRooms;
    roomSlots: RoomSlots;
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
  },
) {
  const { reachFade, blend, coneHalfDeg, coneSoftDeg } = shaderConfig;
  const slotAt = (i: THREE.Node<"int">) => textureLoad(npcTex, ivec2(i, 0));
  const slotCountInt = slotCount.toInt() as THREE.Node<"int">;
  const player = slotAt(int(0));
  /** The furthest a slot is pushed: not past `reachFade`, where `log` races the rings */
  const maxPush = reach.sub(reachFade);
  /** Distance to a slot, out by up to `push` as its presence falls */
  const distTo = (q: THREE.Node<"vec2">, slot: THREE.Node<"vec4">, push: THREE.Node<"float">) =>
    q.sub(slot.xy).length().add(slot.z.oneMinus().mul(push));
  /** Eased to nought at `reach`, since a hard cut steps the contours */
  const weigh = (r: THREE.Node<"float">) => exp(r.div(-blend)).mul(smoothstep(maxPush, reach, r).oneMinus());

  /** The field at world `q`: a smooth min of the distances to the player and the nearest other, so each keeps rings of their own */
  const fieldAt = Fn(([q]: [THREE.Node<"vec2">]) => {
    const rPlayer = distTo(q, player, maxPush);
    const rOther = float(1e9).toVar();
    Loop({ type: "int", start: 1, end: slotCountInt }, ({ i }: { i: THREE.Node<"int"> }) => {
      const slot = slotAt(i);
      // to just under the player's field, so it rises out of theirs for the whole of its fade
      rOther.assign(rOther.min(distTo(q, slot, distTo(slot.xy, player, float(blend * 2)).min(maxPush))));
    });
    return log(max(weigh(rPlayer).add(weigh(rOther)), 1e-20)).mul(-blend); // huge beyond reach
  });

  /** `(uv, gmId)` of world `q` in the room-slot texture, `gmId` `-1` off the map */
  const gmUvAt = Fn(([q]: [THREE.Node<"vec2">]) => {
    const gmId = float(-1).toVar();
    const uvAt = vec2(0).toVar();
    Loop({ type: "int", start: 0, end: gmCount.toInt() as THREE.Node<"int"> }, ({ i }: { i: THREE.Node<"int"> }) => {
      // `(a, b, c, d)`, `(e, f, x, y)`, `(width, height)`: inverse transform and local bounds
      const m = gmArray.element(i.mul(3));
      const t = gmArray.element(i.mul(3).add(1));
      const size = gmArray.element(i.mul(3).add(2));
      const local = vec2(m.x.mul(q.x).add(m.z.mul(q.y)).add(t.x), m.y.mul(q.x).add(m.w.mul(q.y)).add(t.y));
      const rel = local.sub(t.zw);
      const inside = rel.x.greaterThanEqual(0).and(rel.y.greaterThanEqual(0));
      If(gmId.lessThan(0).and(inside).and(rel.x.lessThanEqual(size.x)).and(rel.y.lessThanEqual(size.y)), () => {
        gmId.assign(i.toFloat());
        uvAt.assign(rel.mul(slotUvPerMetre));
      });
    });
    return vec3(uvAt, gmId);
  });

  // the wedge the fragments' cone keeps, so no vertex is wasted outside it
  const along = positionLocal.x.mul(rampEnd).add(positionLocal.y.mul(span));
  const across = positionLocal.z.mul(along).mul(Math.tan(((coneHalfDeg + coneSoftDeg) * Math.PI) / 180));
  const worldXZ = player.xy.add(facing.mul(along)).add(vec2(facing.y.negate(), facing.x).mul(across));
  // a sheet from the player's peak to the target's, level beyond
  const y = mix(player.w, rampPeak, positionLocal.x.add(positionLocal.y));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldXZ.x, y, worldXZ.y, 1)));

  const p = varying(worldXZ, "vPsiXZ");

  const colorNode = Fn(() => {
    // per fragment rather than a varying, so a line keeps its shape between vertices
    const g = fieldAt(p).toVar();

    const v = g.div(gap).sub(flowPhase);
    const toLine = float(0.5).sub(fract(v).sub(0.5).abs()); // 0 on a contour
    const px = toLine.div(max(fwidth(v), 1e-6));
    const half = width.mul(0.5);
    const core = smoothstep(half.sub(0.5), half.add(0.5), px).oneMinus(); // solid, 1px edge
    // the core and its casing, should it have one
    const line = smoothstep(half.add(casing).sub(0.5), half.add(casing).add(0.5), px).oneMinus();
    // the outermost dies away rather than ringing the reach
    const edge = smoothstep(maxPush, maxPush.add(gap), g).oneMinus();

    // only ahead of the player, within the cone they face down
    const away = p.sub(player.xy);
    const ahead = away.dot(facing).div(away.length().max(1e-4));
    const cone = smoothstep(cosDeg(coneHalfDeg + coneSoftDeg), cosDeg(coneHalfDeg - coneSoftDeg), ahead);

    const strength = opacity.mul(gain);
    // the player's presence: another fades by its push alone, else its part of the field would dim as it rose
    // clamped after the strength, so one past full firms up the line's soft edges too
    const shape = line.mul(edge).mul(cone).mul(player.z).mul(foldNode).mul(strength).min(1);

    // most of the wedge is off every line, and a discard alone would still look its room up
    const a = float(0).toVar();
    If(objectPick.equal(0).and(shape.greaterThanEqual(1 / 512)), () => {
      // a room out of view takes from them, but only in `sight`…
      const gmUv = gmUvAt(p).toVar();
      const gmId = gmUv.z;
      // not heeding broad walls, whose slot shows with any room they abut: within one reads as no room
      const slot = roomSlots.decodeUvVisibility(gmUv.xy, gmId.max(0).toUint() as THREE.Node<"uint">, {
        branched: true,
      });
      // …where it dims them rather than hides them: sensed past what is seen. Off the map they go
      const unseen = fadeRoomsFx.sightNode.oneMinus();
      const roomShown = gmId
        .greaterThanEqual(0)
        .select(fadeRoomsFx.getVisiblity(slot).max(unseen.max(unseenShown)), unseen);
      a.assign(shape.mul(roomShown));
    });
    Discard(a.lessThan(1 / 512)); // which would otherwise still blend
    // alpha stops at one, so strength past it whitens an additive line
    const ink = color.mul(mix(float(1), strength.max(1), whiten));
    // over a pale deck, near white cased in its own ink, darkened: read over white and grey alike
    return vec4(mix(ink.mul(casingShade), mix(coreColor, ink, whiten), core.max(whiten)), a.mul(fade));
  })();

  return { vertexNode, colorNode };
}

/** How much of a contour is left in a room out of view, in `sight` */
const unseenShown = 0.3;

const shaderConfig = {
  /** Metres before `reach` over which it fades out */
  reachFade: 0.75,
  /** Metres over which the player's and another's rings merge: smaller gives a sharper waist */
  blend: 0.3,
  /** Degrees either side of the player's facing the contours are drawn within, and the softening of that edge */
  coneHalfDeg: 30,
  coneSoftDeg: 3,
} as const;

const cosDeg = (degrees: number) => Math.cos((degrees * Math.PI) / 180);

/** The player, whom they influence, and whom they did */
const MAX_PSI = 3;

/** How dark a line's casing is, of its ink */
const casingShade = 0.18;
