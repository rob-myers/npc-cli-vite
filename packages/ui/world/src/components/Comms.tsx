import { useStateRef } from "@npc-cli/util";
import { useContext, useMemo } from "react";
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
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { PlayerLight } from "../service/player-light";
import { getWorldStore } from "../service/storage";
import { WorldContext } from "./world-context";

/**
 * Contour lines of a field between the player and the one npc they influence, a quad apiece. A new
 * influence fades in as the last fades out, so the player has at most two others.
 */
export default function Comms() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createCommsResources(),
      shown: getWorldStore(w.key).read().commsShown,
      self: { presence: 0, target: 0 }, // off till someone is influenced
      influenced: [],
      pending: undefined,
      tickedMs: performance.now(),

      influence(npcKey) {
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
        state.flowSecs.value = w.timer.getElapsedTime(); // world time, so a pause holds the rings still
        const now = performance.now();
        const step = Math.min((now - state.tickedMs) / 1000, 0.1) / commsConfig.fadeSecs;
        state.tickedMs = now;

        const { self } = state;
        for (const x of [self, ...state.influenced]) approach(x, step);
        state.influenced = state.influenced.filter(
          (x) => w.n[x.npcKey] !== undefined && (x.presence > 0 || x.target > 0),
        );
        if (state.pending !== undefined && state.influenced.every((x) => x.target === 1)) {
          state.influence(state.pending);
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
        });
        state.slotCount.value = slots.length;
        state.geo.instanceCount = slots.length;
        state.npcTex.needsUpdate = true;
      },
      snap() {
        for (const x of [state.self, ...state.influenced]) x.presence = x.target;
        state.influenced = state.influenced.filter((x) => x.target === 1);
      },
      turnOff() {
        state.influence(w.player?.key ?? null);
      },
      setShown(shown) {
        state.shown = shown;
        getWorldStore(w.key).patch({ commsShown: shown });
        state.onTick();
        w.r3f?.invalidate();
      },
    }),
    // a new `reach` or `cell` needs a new geometry, and the mesh and material go with it
    { reset: { geo: true, mat: true, mesh: true } },
  );

  w.comms = state;

  useMemo(() => {
    const { vertexNode, colorNode } = commsNodes(state, w.view);
    state.mat.vertexNode = vertexNode;
    state.mat.colorNode = colorNode;
    state.mat.needsUpdate = true;
    state.onTick(); // a fresh geometry has no instances yet
  }, [w.view.playerLight.uid]);

  return <primitive object={state.mesh} />;
}

export type State = Resources & {
  shown: boolean;
  /** The player's own rings, which go when the player is influenced — see `influence` */
  self: Presence;
  /** Instances after the player's: whom they influence, and whom they did whilst it fades out */
  influenced: (Presence & { npcKey: string })[];
  /** Who is next influenced, once the last has faded out — `null` for nobody */
  pending: undefined | null | string;
  tickedMs: number;

  /** Influence `npcKey` instead, or nobody. The player themself turns it all off, till the next */
  influence(npcKey: null | string): void;
  onTick(): void;
  /** Every fade straight to its end */
  snap(): void;
  /** Fade out the influence and the player's rings with it, as influencing the player does */
  turnOff(): void;
  setShown(shown: boolean): void;
};

/** How far into view a slot's rings are, and whither they are headed */
type Presence = { presence: number; target: 0 | 1 };

type Resources = ReturnType<typeof createCommsResources>;

/** Steps `x.presence` towards its target by at most `step` */
function approach(x: Presence, step: number) {
  x.presence += Math.max(-step, Math.min(step, x.target - x.presence));
}

function createCommsResources() {
  // subdivided, since the vertex shader raises it by the field. Even, with a cell to spare each side,
  // so a quad snapped to the world grid still covers its npc's reach
  const { reach, cell } = commsConfig;
  const segments = 2 * Math.ceil(reach / cell) + 2;
  const side = segments * cell;
  const base = new THREE.PlaneGeometry(side, side, segments, segments).rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  geo.instanceCount = 0;

  // a texel per slot, the player's first: world `xz`, eased presence
  const npcData = new Float32Array(MAX_COMMS * 4);
  const npcTex = new THREE.DataTexture(npcData, MAX_COMMS, 1, THREE.RGBAFormat, THREE.FloatType);
  npcTex.minFilter = npcTex.magFilter = THREE.NearestFilter;
  npcTex.needsUpdate = true;
  const slotCount = uniform(0);
  const flowSecs = uniform(0);

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

  return { geo, mat, mesh, npcData, npcTex, slotCount, flowSecs };
}

function commsNodes(
  { npcTex, slotCount, flowSecs }: Resources,
  {
    playerLight,
    objectPick,
    foldNode,
  }: {
    playerLight: PlayerLight;
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
  },
) {
  const { reach, reachFade, spacing, blend, flow, lineWidthPx, color, alpha, lift, height, cell } = commsConfig;
  const slotAt = (i: THREE.Node<"int">) => textureLoad(npcTex, ivec2(i, 0));
  const slotCountInt = slotCount.toInt() as THREE.Node<"int">;
  /** Distance to a slot, pushed out of reach as its presence falls, so coming and going is continuous */
  const distTo = (q: THREE.Node<"vec2">, slot: THREE.Node<"vec4">) =>
    q.sub(slot.xy).length().add(slot.z.oneMinus().mul(reach));
  /** Each eased to nought at `reach`, since a hard cut steps the contours */
  const weigh = (r: THREE.Node<"float">) => exp(r.div(-blend)).mul(smoothstep(reach - reachFade, reach, r).oneMinus());

  /**
   * `(g, slot of nearest)` at world `q`: a smooth min of the distances to the player and to the
   * nearest other, pointed at each so they keep rings of their own
   */
  const fieldAt = Fn(([q]: [THREE.Node<"vec2">]) => {
    const rPlayer = distTo(q, slotAt(int(0)));
    const rOther = float(1e9).toVar();
    const nearest = float(0).toVar();
    Loop({ type: "int", start: 1, end: slotCountInt }, ({ i }: { i: THREE.Node<"int"> }) => {
      const r = distTo(q, slotAt(i));
      If(r.lessThan(rOther), () => {
        rOther.assign(r);
        nearest.assign(i.toFloat());
      });
    });

    const g = log(max(weigh(rPlayer).add(weigh(rOther)), 1e-20)).mul(-blend); // huge beyond reach
    return vec2(g, rPlayer.lessThanEqual(rOther).select(float(0), nearest));
  });

  const ownSlot = slotAt(instanceIndex.toInt() as THREE.Node<"int">);
  // on one world grid, so overlapping quads share vertices and their reliefs agree
  const worldXZ = positionLocal.xz.add(floor(ownSlot.xy.div(cell).add(0.5)).mul(cell));
  // each contour at a fixed height, as on a relief map
  const y = max(fieldAt(worldXZ).x.div(-reach).add(1), 0).mul(height).add(lift);
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldXZ.x, y, worldXZ.y, 1)));

  const p = varying(worldXZ, "vCommsXZ");
  const own = varying<"float">(instanceIndex.toFloat() as THREE.Node<"float">, "vCommsOwn");
  const presence = varying(ownSlot.z, "vCommsPresence");

  const colorNode = Fn(() => {
    // per fragment rather than a varying, so a line keeps its shape between vertices
    const found = fieldAt(p).toVar();
    const g = found.x;
    const owned = found.y.sub(own).abs().lessThan(0.5).select(float(1), float(0)); // drawn once, by the nearest

    const v = g.div(spacing).sub(flowSecs.mul(flow));
    const toLine = float(0.5).sub(fract(v).sub(0.5).abs()); // 0 on a contour
    const px = toLine.div(max(fwidth(v), 1e-6));
    const line = smoothstep(lineWidthPx / 2 - 0.5, lineWidthPx / 2 + 0.5, px).oneMinus(); // solid core, 1px edge
    // the outermost dies away rather than ringing the reach
    const edge = smoothstep(reach - reachFade, reach - reachFade + spacing, g).oneMinus();

    const a = objectPick.notEqual(0).select(0, line.mul(edge).mul(owned).mul(presence).mul(foldNode).mul(alpha));
    Discard(a.lessThan(1 / 512)); // most of a quad, which would otherwise still blend
    return playerLight.applyLightRgba(vec4(vec3(color.r, color.g, color.b), a));
  })();

  return { vertexNode, colorNode };
}

const commsConfig = {
  /** Metres an npc's field reaches */
  reach: 2.5,
  /** Metres before `reach` over which it fades out */
  reachFade: 0.75,
  /** Metres between contours */
  spacing: 0.5,
  /** Metres over which the player's and another's rings merge: smaller gives a sharper waist */
  blend: 0.3,
  /** Contours per second the rings drift by: outwards when positive */
  flow: 0.4,
  lineWidthPx: 2.5,
  color: /* @__PURE__ */ new THREE.Color("#9fe8ff"),
  alpha: 0.5,
  /** Metres the relief's rim sits above the floor */
  lift: 0,
  /** Metres one npc's peak rises by: negative for a well */
  height: 1.3,
  /** Metres between relief vertices, on a grid shared by every npc */
  cell: 0.2,
  /** Seconds an influence takes to come or go */
  fadeSecs: 0.6,
} as const;

/** The player, whom they influence, and whom they did */
const MAX_COMMS = 3;
