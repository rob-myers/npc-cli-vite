import { useStateRef } from "@npc-cli/util";
import { useContext, useMemo } from "react";
import {
  Break,
  cameraProjectionMatrix,
  cameraViewMatrix,
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
  time,
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
      influenced: [],
      pending: undefined,
      tickedMs: performance.now(),
      influence(npcKey) {
        if (npcKey !== null && npcKey === w.player?.key) return; // not themself
        if (state.influenced.some((x) => x.target === 0)) {
          state.pending = npcKey; // one still fading out: wait for it, latest pick wins
          return;
        }
        state.pending = undefined;
        const current = state.influenced.find((x) => x.target === 1);
        if (current?.npcKey === npcKey) return;
        if (current !== undefined) current.target = 0;
        if (npcKey !== null) state.influenced.push({ npcKey, presence: 0, target: 1 });
        state.onTick();
        w.r3f?.invalidate();
      },
      onTick() {
        if (w.n === null) return; // <NPCs> mounts after us
        const now = performance.now();
        const step = Math.min((now - state.tickedMs) / 1000, 0.1) / commsConfig.fadeSecs;
        state.tickedMs = now;

        state.influenced = state.influenced.filter((x) => {
          x.presence += Math.max(-step, Math.min(step, x.target - x.presence));
          return w.n[x.npcKey] !== undefined && (x.presence > 0 || x.target > 0);
        });
        if (state.pending !== undefined && state.influenced.every((x) => x.target === 1)) {
          state.influence(state.pending);
        }

        const player = w.player === undefined ? undefined : w.n[w.player.key];
        const others = state.influenced.filter((x) => x.npcKey !== player?.key);
        const slots = player === undefined ? [] : [player, ...others.map((x) => w.n[x.npcKey])];
        const data = state.npcData;
        slots.forEach((npc, i) => {
          const presence = i === 0 ? 1 : others[i - 1].presence;
          data[i * 4] = npc.position.x;
          data[i * 4 + 1] = npc.position.z;
          data[i * 4 + 2] = presence * presence * (3 - 2 * presence); // eased
        });
        state.count.value = slots.length;
        state.geo.instanceCount = slots.length;
        state.mesh.visible = state.shown && slots.length > 0; // else no draw call
        state.npcTex.needsUpdate = true;
      },
      setShown(shown) {
        state.shown = shown;
        getWorldStore(w.key).patch({ commsShown: shown });
        state.onTick();
        w.r3f?.invalidate();
      },
    }),
    // a new `reach` or `segments` needs a new geometry, and the mesh and material go with it
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

export type State = ReturnType<typeof createCommsResources> & {
  shown: boolean;
  /** Instances after the player's: whom they influence, and whom they did whilst it fades out */
  influenced: { npcKey: string; presence: number; target: 0 | 1 }[];
  /** Who is next influenced, once the last has faded out — `null` for nobody */
  pending: undefined | null | string;
  tickedMs: number;
  /** Influence `npcKey` instead, or nobody */
  influence(npcKey: null | string): void;
  onTick(): void;
  setShown(shown: boolean): void;
};

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

  // a texel per slot: world `xz`, presence
  const npcData = new Float32Array(MAX_COMMS * 4);
  const npcTex = new THREE.DataTexture(npcData, MAX_COMMS, 1, THREE.RGBAFormat, THREE.FloatType);
  npcTex.minFilter = npcTex.magFilter = THREE.NearestFilter;
  npcTex.needsUpdate = true;
  const count = uniform(0);

  // additive, so the lines glow over a dark floor
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { geo, mat, mesh, npcData, npcTex, count };
}

function commsNodes(
  comms: ReturnType<typeof createCommsResources>,
  view: {
    playerLight: PlayerLight;
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
  },
) {
  const { npcTex, count } = comms;
  const npcAt = (i: THREE.Node<"int">) => textureLoad(npcTex, ivec2(i, 0));
  const { playerLight, objectPick, foldNode } = view;
  const { reach, reachFade, spacing, blend, flow, lineWidthPx, color, alpha, lift, height, cell } = commsConfig;
  const ownNpc = npcAt(instanceIndex.toInt() as THREE.Node<"int">);
  // on one world grid, so overlapping quads share vertices and their reliefs agree
  const worldXZ = positionLocal.xz.add(floor(ownNpc.xy.div(cell).add(0.5)).mul(cell));

  /**
   * `(g, slot of nearest)` at world `q`: a smooth min of the distances to the player and to the
   * nearest other, pointed at each so they keep rings of their own
   */
  const fieldAt = Fn(([q]: [THREE.Node<"vec2">]) => {
    const rPlayer = q.sub(npcAt(int(0)).xy).length();
    const rNearest = float(1e9).toVar();
    const nearest = float(0).toVar();

    Loop(MAX_COMMS, ({ i }: { i: THREE.Node<"int"> }) => {
      If(i.toFloat().greaterThanEqual(count), () => {
        Break();
      });
      If(i.greaterThan(0), () => {
        const npc = npcAt(i);
        // pushed out of reach as presence falls, so coming and going is continuous
        const r = q.sub(npc.xy).length().add(npc.z.oneMinus().mul(reach));
        If(r.lessThan(rNearest), () => {
          rNearest.assign(r);
          nearest.assign(i.toFloat());
        });
      });
    });

    // each eased to nought at `reach`, since a hard cut steps the contours
    const weigh = (r: THREE.Node<"float">) =>
      exp(r.div(-blend)).mul(smoothstep(reach - reachFade, reach, r).oneMinus());
    const g = log(max(weigh(rPlayer).add(weigh(rNearest)), 1e-20)).mul(-blend); // huge beyond reach
    return vec2(g, rPlayer.lessThanEqual(rNearest).select(float(0), nearest));
  });

  // each contour at a fixed height, as on a relief map
  const self = instanceIndex.toFloat() as THREE.Node<"float">;
  const y = max(fieldAt(worldXZ).x.div(-reach).add(1), 0).mul(height).add(lift);
  // const y = 0;
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldXZ.x, y, worldXZ.y, 1)));

  const p = varying(worldXZ, "vCommsXZ");
  const own = varying<"float">(self, "vCommsOwn");
  const shown = varying(ownNpc.z, "vCommsShown");

  const colorNode = Fn(() => {
    // per fragment rather than a varying, so a line keeps its shape between vertices
    const found = fieldAt(p).toVar();
    const g = found.x;
    const nearest = found.y;

    const v = g.div(spacing).sub(time.mul(flow));
    const toLine = float(0.5).sub(fract(v).sub(0.5).abs()); // 0 on a contour
    const px = toLine.div(max(fwidth(v), 1e-6));
    const line = smoothstep(lineWidthPx / 2 - 0.5, lineWidthPx / 2 + 0.5, px).oneMinus(); // solid core, 1px edge
    // the outermost dies away rather than ringing the reach
    const edge = smoothstep(reach - reachFade, reach - reachFade + spacing, g).oneMinus();
    const owned = nearest.sub(own).abs().lessThan(0.5).select(float(1), float(0));
    const fade = foldNode;
    const a = objectPick.notEqual(0).select(float(0), line.mul(edge).mul(owned).mul(shown).mul(fade).mul(alpha));

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
  /** Between the shadows (0.01) and rings (0.02), so neither z-fights it */
  lift: 0.5,
  /** Metres one npc's peak rises by: negative for a well */
  height: 0.6,
  /** Metres between relief vertices, on a grid shared by every npc */
  cell: 0.2,
  /** Seconds an influence takes to come or go */
  fadeSecs: 0.6,
} as const;

/** The player, whom they influence, and whom they did */
const MAX_COMMS = 3;
