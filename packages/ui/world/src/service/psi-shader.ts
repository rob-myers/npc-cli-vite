import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  Discard,
  exp,
  Fn,
  float,
  floor,
  fract,
  fwidth,
  If,
  instanceIndex,
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
import { defaultPsiTune, psiMaxReach } from "../const.npc";
import type { FadeRooms } from "./fade-rooms";
import { type RoomSlots, slotUvPerMetre } from "./room-slots";
import { selectAs } from "./tsl";

export type PsiResources = ReturnType<typeof createPsiResources>;

export function createPsiResources() {
  // subdivided, since the vertex shader raises it by the field. Even, with a cell to spare each side,
  // so a quad snapped to the world grid still covers its npc's reach
  const { cell } = shaderConfig;
  const segments = 2 * Math.ceil(psiMaxReach / cell) + 2;
  const side = segments * cell;
  const base = new THREE.PlaneGeometry(side, side, segments, segments).rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  geo.instanceCount = 0;

  // a texel per slot, the player's first: world `xz`, eased presence
  const npcData = new Float32Array(MAX_PSI * 4);
  const npcTex = new THREE.DataTexture(npcData, MAX_PSI, 1, THREE.RGBAFormat, THREE.FloatType);
  npcTex.minFilter = npcTex.magFilter = THREE.NearestFilter;
  npcTex.needsUpdate = true;
  const slotCount = uniform(0);
  /** Unit, the way the player faces in world `xz` — see `Psi.upload` */
  const facing = uniform(new THREE.Vector2(1, 0));
  const flowPhase = uniform(0);
  /** Metres out the relief holds its peak before it falls, so it clears someone lain along it */
  const flat = uniform(0);
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
    side: THREE.DoubleSide, // a hill's far slope faces away, and its rings show through the near one
    forceSinglePass: true, // additive, so back and front need no ordering: one draw, not two
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
    flat,
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
    flat,
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
  const { reachFade, blend, lift, cell, coneHalfDeg, coneSoftDeg } = shaderConfig;
  const slotAt = (i: THREE.Node<"int">) => textureLoad(npcTex, ivec2(i, 0));
  const slotCountInt = slotCount.toInt() as THREE.Node<"int">;
  const player = slotAt(int(0));
  /** The furthest a slot is pushed: not past `reachFade`, where `log` races the rings */
  const maxPush = reach.sub(reachFade);
  /** Distance to a slot, out by up to `push` as its presence falls */
  const distTo = (q: THREE.Node<"vec2">, slot: THREE.Node<"vec4">, push: THREE.Node<"float">) =>
    q.sub(slot.xy).length().add(slot.z.oneMinus().mul(push));
  /**
   * Each `eased` to nought at `reach`, since a hard cut steps the contours — not for the relief, whose
   * height that would plunge within a few vertices of the rim, faceting the outermost contour
   */
  const weigh = (r: THREE.Node<"float">, eased: boolean) =>
    eased ? exp(r.div(-blend)).mul(smoothstep(maxPush, reach, r).oneMinus()) : exp(r.div(-blend));

  /**
   * `(g, slot of nearest, peak)` at world `q`: a smooth min of the distances to the player and to
   * the nearest other, so each keeps rings of their own — the player's `pushed` or not
   */
  const fieldOf = (pushed: boolean, eased: boolean) =>
    Fn(([q]: [THREE.Node<"vec2">]) => {
      const rPlayer = distTo(q, player, pushed ? maxPush : float(0));
      const rOther = float(1e9).toVar();
      const hOther = float(1).toVar();
      const nearest = float(0).toVar();
      Loop({ type: "int", start: 1, end: slotCountInt }, ({ i }: { i: THREE.Node<"int"> }) => {
        const slot = slotAt(i);
        // to just under the player's field, so it rises out of theirs for the whole of its fade
        const r = distTo(q, slot, distTo(slot.xy, player, float(blend * 2)).min(maxPush));
        If(r.lessThan(rOther), () => {
          rOther.assign(r);
          hOther.assign(slot.w);
          nearest.assign(i.toFloat());
        });
      });

      const wPlayer = weigh(rPlayer, eased);
      const wOther = weigh(rOther, eased);
      const total = max(wPlayer.add(wOther), 1e-20);
      const g = log(total).mul(-blend); // huge beyond reach
      // their peaks blended as their fields are, so the relief has no step between them
      const h = wPlayer.mul(player.w).add(wOther.mul(hOther)).div(total);
      return vec3(g, rPlayer.lessThanEqual(rOther).select(float(0), nearest), h);
    });

  const fieldAt = fieldOf(true, true);
  /** The player's unpushed, so their rings fade in from the peak rather than the floor */
  const reliefAt = fieldOf(false, false);

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

  const ownSlot = slotAt(instanceIndex.toInt() as THREE.Node<"int">);
  // on one world grid, so overlapping quads share vertices and their reliefs agree
  const worldXZ = positionLocal.xz.add(floor(ownSlot.xy.div(cell).add(0.5)).mul(cell));
  // each contour at a fixed height, as on a relief map
  const field = reliefAt(worldXZ);
  const y = max(max(field.x.sub(flat), 0).div(flat.sub(reach)).add(1), 0)
    .mul(field.z)
    .add(lift); // `z` is the peak
  // a vertex well outside the cone the fragments keep is drawn onto the player, so a triangle of
  // them has no area and is never rasterised. "Well": by more than a triangle is wide, so none that
  // reaches into the cone is bent. Metres outside the wedge's nearer edge, as a half-plane
  const fromPlayer = worldXZ.sub(player.xy);
  const coneRad = ((coneHalfDeg + coneSoftDeg) * Math.PI) / 180;
  const outside = fromPlayer
    .dot(vec2(facing.y.negate(), facing.x))
    .abs()
    .mul(Math.cos(coneRad))
    .sub(fromPlayer.dot(facing).mul(Math.sin(coneRad)));
  const culled = outside.greaterThan(cell * 3);
  const vertexNode = cameraProjectionMatrix.mul(
    cameraViewMatrix.mul(selectAs<"vec4">(culled, vec4(player.x, lift, player.y, 1), vec4(worldXZ.x, y, worldXZ.y, 1))),
  );

  const p = varying(worldXZ, "vPsiXZ");
  const own = varying<"float">(instanceIndex.toFloat() as THREE.Node<"float">, "vPsiOwn");
  // found per vertex, the uv being affine in position: the texture is read per pixel
  const gmUv = varying<"vec3">(gmUvAt(worldXZ) as THREE.Node<"vec3">, "vPsiGmUv");

  const colorNode = Fn(() => {
    // per fragment rather than a varying, so a line keeps its shape between vertices
    const found = fieldAt(p).toVar();
    const g = found.x;
    const owned = found.y.sub(own).abs().lessThan(0.5).select(float(1), float(0)); // drawn once, by the nearest

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
    const shape = line.mul(edge).mul(cone).mul(owned).mul(player.z).mul(foldNode).mul(strength).min(1);

    // most of a quad is off every line, and a discard alone would still look its room up
    const a = float(0).toVar();
    If(objectPick.equal(0).and(shape.greaterThanEqual(1 / 512)), () => {
      // a room out of view takes from them, but only in `sight`…
      const gmId = gmUv.z.round();
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
  /** Metres the relief's rim sits above the floor */
  lift: 0,
  /** Metres between relief vertices, on a grid shared by every npc */
  cell: 0.2,
  /** Degrees either side of the player's facing the contours are drawn within, and the softening of that edge */
  coneHalfDeg: 30,
  coneSoftDeg: 3,
} as const;

const cosDeg = (degrees: number) => Math.cos((degrees * Math.PI) / 180);

/** The player, whom they influence, and whom they did */
const MAX_PSI = 3;

/** How dark a line's casing is, of its ink */
const casingShade = 0.18;
