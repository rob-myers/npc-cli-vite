import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  Discard,
  Fn,
  float,
  fwidth,
  If,
  Loop,
  mix,
  positionLocal,
  smoothstep,
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
  // a square about whoever sends a wave, level with their head: `x` and `z` from `-1` to `1`
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1], 3));
  geo.setIndex([0, 2, 1, 1, 2, 3]);

  /** The player, and whom psi is on: world `xz`, eased presence, the height of their crown — see `Psi.upload` */
  const playerAt = uniform(new THREE.Vector4());
  const otherAt = uniform(new THREE.Vector4());
  /**
   * The two waves, each as metres its front has come, less than nought for none — see `Psi.exchange`.
   * The player's intention out from them, and the other's thought out from them
   */
  const intent = uniform(-1);
  const thought = uniform(-1);
  /** The colour of the thought on its way: its khandha's — see `Psi.syncTune` */
  const thoughtColor = uniform(new THREE.Color(defaultPsiTune.color));
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

  // additive, so a line glows over a dark floor — `Psi.syncTune` lays it over a pale one instead
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  // a mesh to each wave
  const [mesh, thoughtMesh] = [mat, mat.clone()].map((material) => {
    const made = new THREE.Mesh(geo, material);
    made.frustumCulled = false;
    made.renderOrder = +5;
    made.visible = false;
    return made;
  });

  return {
    geo,
    mesh,
    thoughtMesh,
    playerAt,
    otherAt,
    intent,
    thought,
    thoughtColor,
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

/** The nodes of the player's intention, and of the other's thought: for `mesh` and `thoughtMesh` */
export function psiNodes(
  {
    playerAt,
    otherAt,
    intent,
    thought,
    thoughtColor,
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
  const { coneHalfDeg, coneSoftDeg, startOver, landFrom } = shaderConfig;
  const between = otherAt.xy.sub(playerAt.xy).length();
  const half = width.mul(0.5);
  const strength = opacity.mul(gain);

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

  /** A wave `come` metres out `from` one of them, on its way `to` the other, in `ink`: one line, at its front */
  const waveNodes = (
    from: THREE.Node<"vec4">,
    to: THREE.Node<"vec4">,
    come: THREE.Node<"float">,
    ink: THREE.Node<"vec3">,
    /** How much of it there is to see, by whose presence */
    present: THREE.Node<"float">,
    name: string,
  ) => {
    // the square reaches as far as whom it makes for
    const at = from.xy.add(positionLocal.xz.mul(between));
    const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(at.x, from.w, at.y, 1)));
    const q = varying(at, name);

    const colorNode = Fn(() => {
      const away = q.sub(from.xy);
      const gone = away.length();
      // pixels from its front: metres, over what a pixel covers
      const px = come.sub(gone).abs().div(fwidth(q).length().mul(Math.SQRT1_2).max(1e-6));
      const core = smoothstep(half.sub(0.5), half.add(0.5), px).oneMinus(); // solid, 1px edge
      // the core and its casing, should it have one
      const line = smoothstep(half.add(casing).sub(0.5), half.add(casing).add(0.5), px).oneMinus();
      // it grows out of nothing, and is gone by the time it is there
      const shown = smoothstep(0, startOver, come).mul(smoothstep(between.sub(landFrom), between, come).oneMinus());
      // only towards whom it makes for
      const ahead = away.dot(to.xy.sub(from.xy)).div(gone.mul(between).max(1e-4));
      const cone = smoothstep(cosDeg(coneHalfDeg + coneSoftDeg), cosDeg(coneHalfDeg - coneSoftDeg), ahead);
      // clamped after the strength, so one past full firms up the line's soft edges too
      const shape = line.mul(shown).mul(cone).mul(present).mul(foldNode).mul(strength).min(1);

      // most of the square is off the line, and a discard alone would still look its room up
      const a = float(0).toVar();
      If(objectPick.equal(0).and(shape.greaterThanEqual(1 / 512)), () => {
        // a room out of view takes from them, but only in `sight`…
        const gmUv = gmUvAt(q).toVar();
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
      const inked = ink.mul(mix(float(1), strength.max(1), whiten));
      // over a pale deck, near white cased in its own ink, darkened: read over white and grey alike
      return vec4(mix(inked.mul(casingShade), mix(coreColor, inked, whiten), core.max(whiten)), a.mul(fade));
    })();

    return { vertexNode, colorNode };
  };

  return {
    // the player's is theirs alone to send: the other's needs psi to be on them
    intent: waveNodes(playerAt, otherAt, intent, color, playerAt.z, "vPsiIntent"),
    thought: waveNodes(otherAt, playerAt, thought, thoughtColor, playerAt.z.mul(otherAt.z), "vPsiThought"),
  };
}

/** How much of a wave is left in a room out of view, in `sight` */
const unseenShown = 0.3;

const shaderConfig = {
  /** Degrees either side of the way to whom it makes for a wave is drawn within, and the softening of that edge */
  coneHalfDeg: 30,
  coneSoftDeg: 3,
  /** Metres a front has come by the time it is fully there */
  startOver: 0.4,
  /** Metres short of whom it makes for a front begins to go */
  landFrom: 0.7,
} as const;

const cosDeg = (degrees: number) => Math.cos((degrees * Math.PI) / 180);

/** How dark a line's casing is, of its ink */
const casingShade = 0.18;
