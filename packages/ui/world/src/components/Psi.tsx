import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
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
import { defaultPsiTune, type PsiTune, psiMaxReach } from "../const.npc";
import type { FadeRooms } from "../service/fade-rooms";
import type { PlayerLight } from "../service/player-light";
import { type RoomSlots, slotUvPerMetre } from "../service/room-slots";
import { getWorldStore } from "../service/storage";
import { WorldContext } from "./world-context";

/**
 * Contour lines of a field between the player and the one npc they influence, a quad apiece. A new
 * influence fades in as the last fades out, so the player has at most two others.
 */
export default function Psi() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createPsiResources(),
      shown: getWorldStore(w.key).read().psiShown,
      tune: { ...defaultPsiTune, ...getWorldStore(w.key).read().psiTune },
      flowAt: 0,
      self: { presence: 0, target: 0 }, // off till someone is influenced
      influenced: [],
      pending: undefined,
      tickedMs: performance.now(),

      choose(npcKey) {
        if (w.disabled === true) state.snap(); // paused: nothing fades, so a change is at once
        if (state.influenced.some((x) => x.target === 0)) {
          state.pending = npcKey; // one still fading out: wait for it, latest pick wins
          return;
        }
        state.pending = undefined;
        // the player themself turns it off: their rings go too
        const off = npcKey === w.player?.key;
        const next = off ? null : npcKey;
        state.self.target = off ? 0 : 1;

        const current = state.influenced.find((x) => x.target === 1);
        if (current?.npcKey !== next) {
          if (current !== undefined) current.target = 0;
          if (next !== null) state.influenced.push({ npcKey: next, presence: 0, target: 1 });
        }
        if (w.disabled === true) state.snap();
        state.onTick();
        w.r3f?.invalidate();
      },
      onTick() {
        if (w.n === null) return; // <NPCs> mounts after us
        // world time, so a pause holds the rings still — and a phase, so a new speed does not jump them
        const worldSecs = w.timer.getElapsedTime();
        state.flowPhase.value += Math.max(0, worldSecs - state.flowAt) * state.tune.speed;
        state.flowAt = worldSecs;
        const now = performance.now();
        const secs = Math.min((now - state.tickedMs) / 1000, 0.1);
        state.tickedMs = now;

        const { self, tune } = state;
        for (const x of [self, ...state.influenced]) {
          approach(x, secs / tune.fadeSecs);
        }
        state.influenced = state.influenced.filter(
          (x) => w.n[x.npcKey] !== undefined && (x.presence > 0 || x.target > 0),
        );
        if (state.pending !== undefined && state.influenced.every((x) => x.target === 1)) {
          state.choose(state.pending);
        }

        const player = w.player === undefined ? undefined : w.n[w.player.key];
        const others = state.influenced.filter((x) => x.npcKey !== player?.key);
        const off = player === undefined || (self.presence === 0 && others.length === 0);
        state.mesh.visible = state.shown && off === false; // else no draw call
        if (player === undefined || state.mesh.visible === false) return; // nor any upload

        const slots = [{ npc: player, presence: self.presence }].concat(
          others.map((x) => ({ npc: w.n[x.npcKey], presence: x.presence })),
        );
        slots.forEach(({ npc, presence }, i) => {
          state.npcData[i * 4] = npc.position.x;
          state.npcData[i * 4 + 1] = npc.position.z;
          state.npcData[i * 4 + 2] = presence * presence * (3 - 2 * presence); // eased
          state.npcData[i * 4 + 3] = npc.position.y + npc.anim.headY + psiConfig.headAbove; // their peak
        });
        state.slotCount.value = slots.length;
        state.geo.instanceCount = slots.length;
        state.npcTex.needsUpdate = true;
      },
      snap() {
        for (const x of [state.self, ...state.influenced]) x.presence = x.target;
        state.influenced = state.influenced.filter((x) => x.target === 1);
      },
      syncGms() {
        w.gms.forEach((gm, gmId) => {
          const { a, b, c, d, e, f } = gm.inverseMatrix;
          const { x, y, width, height } = gm.bounds;
          state.gmValues[gmId * 3].set(a, b, c, d);
          state.gmValues[gmId * 3 + 1].set(e, f, x, y);
          state.gmValues[gmId * 3 + 2].set(width, height, 0, 0);
        });
        state.gmCount.value = w.gms.length;
      },
      turnOff() {
        state.choose(w.player?.key ?? null);
      },
      setTune(partial) {
        Object.assign(state.tune, partial);
        getWorldStore(w.key).patch({ psiTune: { ...state.tune } });
        state.syncTune();
        w.r3f?.invalidate();
      },
      syncTune() {
        state.tune = { ...defaultPsiTune, ...state.tune }; // a field added since, e.g. over hmr
        const { reach, gap, width, color } = state.tune;
        state.reach.value = Math.min(reach, psiMaxReach);
        state.gap.value = gap;
        state.width.value = width;
        state.color.value.set(color);
      },
      setShown(shown) {
        state.shown = shown;
        getWorldStore(w.key).patch({ psiShown: shown });
        state.onTick();
        w.r3f?.invalidate();
      },
    }),
    // a new `psiMaxReach` or `cell` needs a new geometry, and the mesh and material go with it
    { reset: { geo: true, mat: true, mesh: true } },
  );

  w.psi = state;

  useEffect(() => state.syncGms(), [w.hash]);
  useEffect(() => state.syncTune(), []);

  useMemo(() => {
    const { vertexNode, colorNode } = psiNodes(state, w.view);
    state.mat.vertexNode = vertexNode;
    state.mat.colorNode = colorNode;
    state.mat.needsUpdate = true;
    state.onTick(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid, w.view.playerLight.uid]);

  return <primitive object={state.mesh} />;
}

export type State = Resources & {
  shown: boolean;
  /** What the player's bubble adjusts, persisted — see `PsiControls` */
  tune: PsiTune;
  /** World seconds `flowPhase` was last advanced at */
  flowAt: number;
  /** The player's own rings, which go when the player is influenced — see `choose` */
  self: Presence;
  /** Instances after the player's: whom they influence, and whom they did whilst it fades out */
  influenced: (Presence & { npcKey: string })[];
  /** Who is next influenced, once the last has faded out — `null` for nobody */
  pending: undefined | null | string;
  tickedMs: number;

  /** Influence `npcKey` instead, or nobody. The player themself turns it all off, till the next */
  choose(npcKey: null | string): void;
  onTick(): void;
  /** Every fade straight to its end */
  snap(): void;
  /** Each geomorph's inverse transform and local bounds, for the shader to find a pixel's room */
  syncGms(): void;
  /** Fade out the influence and the player's rings with it, as choosing the player does */
  turnOff(): void;
  setShown(shown: boolean): void;
  setTune(partial: Partial<PsiTune>): void;
  /** `tune` into the uniforms */
  syncTune(): void;
};

/** How far into view a slot's rings are, and whither they are headed */
type Presence = { presence: number; target: 0 | 1 };

type Resources = ReturnType<typeof createPsiResources>;

/** Steps `x.presence` towards its target by at most `step` */
function approach(x: Presence, step: number) {
  x.presence += Math.max(-step, Math.min(step, x.target - x.presence));
}

function createPsiResources() {
  // subdivided, since the vertex shader raises it by the field. Even, with a cell to spare each side,
  // so a quad snapped to the world grid still covers its npc's reach
  const { cell } = psiConfig;
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
  const flowPhase = uniform(0);
  const reach = uniform(defaultPsiTune.reach);
  const gap = uniform(defaultPsiTune.gap);
  const width = uniform(defaultPsiTune.width);
  const color = uniform(new THREE.Color(defaultPsiTune.color));
  // per geomorph, three `vec4`s — see `syncGms`
  const gmValues = Array.from({ length: MAX_GEOMORPH_INSTANCES * 3 }, () => new THREE.Vector4());
  const gmArray = uniformArray<"vec4">(gmValues, "vec4");
  const gmCount = uniform(0);

  // additive, so the lines glow over a dark floor
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
    flowPhase,
    reach,
    gap,
    width,
    color,
    gmValues,
    gmArray,
    gmCount,
  };
}

function psiNodes(
  { npcTex, slotCount, flowPhase, reach, gap, width, color, gmArray, gmCount }: Resources,
  {
    fadeRoomsFx,
    playerLight,
    objectPick,
    foldNode,
    roomSlots,
  }: {
    fadeRoomsFx: FadeRooms;
    roomSlots: RoomSlots;
    playerLight: PlayerLight;
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
  },
) {
  const { reachFade, blend, alpha, lift, cell } = psiConfig;
  const slotAt = (i: THREE.Node<"int">) => textureLoad(npcTex, ivec2(i, 0));
  const slotCountInt = slotCount.toInt() as THREE.Node<"int">;
  const maxPush = reach.sub(reachFade);
  /** Distance to a slot, pushed out as its presence falls — not past `reachFade`, where `log` races the rings */
  const distTo = (q: THREE.Node<"vec2">, slot: THREE.Node<"vec4">) =>
    q.sub(slot.xy).length().add(slot.z.oneMinus().mul(maxPush));
  /** Each eased to nought at `reach`, since a hard cut steps the contours */
  const weigh = (r: THREE.Node<"float">) => exp(r.div(-blend)).mul(smoothstep(maxPush, reach, r).oneMinus());

  /**
   * `(g, slot of nearest)` at world `q`: a smooth min of the distances to the player and to the
   * nearest other, pointed at each so they keep rings of their own
   */
  const fieldAt = Fn(([q]: [THREE.Node<"vec2">]) => {
    const player = slotAt(int(0));
    const rPlayer = distTo(q, player);
    const rOther = float(1e9).toVar();
    const hOther = float(1).toVar();
    const nearest = float(0).toVar();
    Loop({ type: "int", start: 1, end: slotCountInt }, ({ i }: { i: THREE.Node<"int"> }) => {
      const slot = slotAt(i);
      const r = distTo(q, slot);
      If(r.lessThan(rOther), () => {
        rOther.assign(r);
        hOther.assign(slot.w);
        nearest.assign(i.toFloat());
      });
    });

    const wPlayer = weigh(rPlayer);
    const wOther = weigh(rOther);
    const total = max(wPlayer.add(wOther), 1e-20);
    const g = log(total).mul(-blend); // huge beyond reach
    // their peaks blended as their fields are, so the relief has no step between them
    const h = wPlayer.mul(player.w).add(wOther.mul(hOther)).div(total);
    return vec3(g, rPlayer.lessThanEqual(rOther).select(float(0), nearest), h);
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

  const ownSlot = slotAt(instanceIndex.toInt() as THREE.Node<"int">);
  // on one world grid, so overlapping quads share vertices and their reliefs agree
  const worldXZ = positionLocal.xz.add(floor(ownSlot.xy.div(cell).add(0.5)).mul(cell));
  // each contour at a fixed height, as on a relief map
  const field = fieldAt(worldXZ);
  const y = max(field.x.div(reach.negate()).add(1), 0).mul(field.z).add(lift); // `z` is the peak
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldXZ.x, y, worldXZ.y, 1)));

  const p = varying(worldXZ, "vPsiXZ");
  const own = varying<"float">(instanceIndex.toFloat() as THREE.Node<"float">, "vPsiOwn");
  const presence = varying(ownSlot.z, "vPsiPresence");
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
    const line = smoothstep(width.mul(0.5).sub(0.5), width.mul(0.5).add(0.5), px).oneMinus(); // solid core, 1px edge
    // the outermost dies away rather than ringing the reach
    const edge = smoothstep(maxPush, maxPush.add(gap), g).oneMinus();

    // as the floor has it: an unlit room hides them, but only in `sight`
    const gmId = gmUv.z.round();
    // not heeding broad walls, whose slot shows with any room they abut: within one reads as no room
    const slot = roomSlots.decodeUvVisibility(gmUv.xy, gmId.max(0).toUint() as THREE.Node<"uint">);
    const roomShown = gmId
      .greaterThanEqual(0)
      .select(fadeRoomsFx.getVisiblity(slot), float(0))
      .max(fadeRoomsFx.sightNode.oneMinus());

    const a = objectPick
      .notEqual(0)
      .select(0, line.mul(edge).mul(owned).mul(presence).mul(roomShown).mul(foldNode).mul(alpha));
    Discard(a.lessThan(1 / 512)); // most of a quad, which would otherwise still blend
    return playerLight.applyLightRgba(vec4(color, a));
  })();

  return { vertexNode, colorNode };
}

const psiConfig = {
  /** Metres before `reach` over which it fades out */
  reachFade: 0.75,
  /** Metres over which the player's and another's rings merge: smaller gives a sharper waist */
  blend: 0.3,
  alpha: 0.5,
  /** Metres the relief's rim sits above the floor */
  lift: 0,
  /** Metres an npc's peak sits above their head bone's pivot: standing, that is the tuned `1.3` */
  headAbove: 0.24,
  /** Metres between relief vertices, on a grid shared by every npc */
  cell: 0.2,
} as const;

/** The player, whom they influence, and whom they did */
const MAX_PSI = 3;
