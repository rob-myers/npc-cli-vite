import { useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { warn } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const.env";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import {
  addedBlending,
  createShieldResources,
  MAX_SHIELDS,
  type ShieldResources,
  shaderConfig,
  shieldFrameNodes,
  shieldNodes,
  shieldStride,
} from "../service/shield-shader";
import { WorldContext } from "./world-context";

/**
 * Shields: every decor rect tagged `shield` stands as a see-through panel along its length. Anyone may
 * walk through one; a phaser's beam stops at it unless tuned to its frequency. See `docs/shields.md`
 */
export default function Shields() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createShieldResources(),
      segs: new Map(),
      stoppedBy: null,
      overrides: new Map(),
      crossing: new Map(),

      onTick() {
        if (state.segs.size === 0) return;
        // once a tick here, not once a fragment there
        state.fade.value = 0.5 + 0.5 * Math.sin((w.timer.getElapsedTime() / shaderConfig.hatchFadeSecs) * 2 * Math.PI);
        const secs = Math.min(w.timer.getDelta(), 0.1);
        const step = secs / shieldConfig.fadeSecs;

        state.crossLines();

        let live = false;
        for (const { index, hit } of state.segs.values()) {
          const idle = hit.wanted === 0 && hit.shown === 0 && hit.struck === 0;
          hit.shown += Math.max(-step, Math.min(step, hit.wanted - hit.shown));
          // struck, the whole of it thickens at once, and thins again once the fire stops
          hit.struck = Math.max(hit.wanted, hit.struck - secs / shieldConfig.struckSecs, 0);
          hit.wanted = 0; // unless a beam says so again, next tick
          if (idle) continue;
          state.data.set([hit.along, hit.up, hit.shown, hit.struck], index * shieldStride + 8);
          live = true;
        }
        if (live) state.buffer.needsUpdate = true;
      },
      crossLines() {
        for (const [key, npcs] of state.crossing) {
          const seg = state.segs.get(key);
          for (const [npcKey, side] of npcs) {
            const npc = w.n?.[npcKey];
            // well over its line, so that stood on it they do not cross and recross
            if (seg === undefined || npc === undefined || offOf(seg, npc) * side > -shieldConfig.lineSlack) continue;
            npcs.set(npcKey, -side);
            state.onCross(npcKey, seg);
          }
        }
      },
      stop(keys, from, tip, to, freqs = noFreqs) {
        if (keys.length === 0) return null;
        const [p0, p1] = [
          { x: from.x, y: from.z },
          { x: to.x, y: to.z },
        ];
        let [nearest, struck] = [Infinity, undefined as undefined | Seg];
        for (const key of keys) {
          const seg = state.segs.get(key);
          if (seg === undefined || seg.on === false || passes(freqs, seg)) continue;
          const lambda = geomService.getLineSegsIntersection(p0, p1, seg.a, seg.b);
          if (lambda === null) continue;
          [nearest, struck] = [lambda, seg];
          break; // nearest first
        }
        state.stoppedBy = null;
        if (struck === undefined) return null;
        const at = tmpStopped.copy(from).lerp(to, nearest);
        if (at.y > wallHeight) return null; // over it
        state.stoppedBy = struck;
        // a muzzle poked through it fires nothing
        const reach = Math.hypot(tip.x - from.x, tip.z - from.z);
        if (nearest * Math.hypot(p1.x - p0.x, p1.y - p0.y) < reach) at.copy(tip);
        return at;
      },
      strike(end, strength) {
        const seg = state.stoppedBy;
        if (seg === null || strength < seg.hit.wanted) return;
        const along = (end.x - seg.a.x) * seg.dir.x + (end.z - seg.a.y) * seg.dir.y;
        Object.assign(seg.hit, { along, up: end.y, wanted: strength });
      },
      configure(key, { on, freq }) {
        if (state.segs.has(key) === false) throw Error(`no shield "${key}"`);
        if (on !== undefined) state.overrides.set(key, { on });
        if (freq !== undefined) state.setFreq(key, freq);
        state.sync();
      },
      setFreq(key, freq) {
        w.decor.byKey[key].meta.freq = freq;
        const def = w.decor.runtime.defByKey[key];
        if (def === undefined) return; // the map's own: as its symbol has it, on a reload
        (def.meta ??= {}).freq = freq;
        if (w.isMapChanging() === false) w.e.persistDecor();
      },
      sendToRaycast() {
        w.navWorker.worker.postMessage({
          type: "set-raycast-shields",
          shields: [...state.segs].map(([key, { points }]) => ({ key, points })),
        } satisfies WW.MsgToNavWorker);
        w.phasers?.markDirty();
      },
      isIn(npcKey) {
        for (const [key, npcs] of state.crossing) {
          if (npcs.has(npcKey) && state.segs.get(key)?.on === true) return true;
        }
        return false;
      },
      phaserOf(npcKey) {
        return w.e.carried[npcKey]?.items.find((def) => def.meta?.item === "phaser");
      },
      freqsOf(npcKey) {
        return state.phaserOf(npcKey)?.meta?.freqs ?? noFreqs;
      },
      isDead(npcKey) {
        return (state.phaserOf(npcKey)?.meta?.dead?.length ?? 0) > 0;
      },
      tune(npcKey, freqs) {
        const meta = state.phaserOf(npcKey)?.meta;
        if (meta === undefined) throw Error(`${npcKey} carries no phaser: give ${npcKey} item:phaser`);
        meta.freqs = freqs;
        const dead: number[] = meta.dead ?? [];
        state.setDead(
          npcKey,
          meta,
          dead.filter((freq) => freqs.includes(freq) === false),
        );
      },
      setDead(npcKey, meta, dead) {
        const was = (meta.dead?.length ?? 0) > 0;
        meta.dead = dead;
        const now = dead.length > 0;
        if (now === true) w.phasers?.disarm(npcKey);
        if (now !== was && npcKey === w.player.key) w.hud?.say(now ? "phaser deactivated" : "phaser reactivated");
        w.e.onCarriedChange(npcKey);
        w.r3f?.invalidate();
      },
      onCross(npcKey, seg) {
        const meta = state.phaserOf(npcKey)?.meta;
        if (meta === undefined || seg.on === false || seg.freq === null || passes(meta.freqs, seg)) return;
        const { freq } = seg;
        const dead: number[] = meta.dead ?? [];
        state.setDead(npcKey, meta, dead.includes(freq) ? dead.filter((f) => f !== freq) : [...dead, freq]);
      },
      sync() {
        const before = state.segs;
        state.segs = new Map();
        for (const d of Object.values(w.decor.byKey)) {
          if (d.type !== "rect" || Boolean(d.meta.shield) === false || d.points.length !== 4) continue;
          if (state.segs.size === MAX_SHIELDS) break;
          // along its length, between the middles of its two ends
          const [p0, p1, p2, p3] = d.points;
          const [w01, w12] = [Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p2.x - p1.x, p2.y - p1.y)];
          if (d.meta.freq !== null && Math.min(w01, w12) < shieldConfig.minSize - 0.01) {
            // too thin to lower a drawn phaser before its muzzle is through
            if (tooSmall.has(d.key) === false) warn(`shield "${d.key}" ignored: under ${shieldConfig.minSize}m a side`);
            tooSmall.add(d.key);
            continue;
          }
          tooSmall.delete(d.key);
          if (d.meta.freq === undefined) state.setFreq(d.key, shieldConfig.freq); // every shield's decor says
          const ends = w01 <= w12;
          const a = ends ? mid(p0, p1) : mid(p1, p2);
          const b = ends ? mid(p2, p3) : mid(p3, p0);
          const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
          const { gmId, roomId } = d.meta;
          state.segs.set(d.key, {
            index: state.segs.size,
            points: d.points.map(({ x, y }) => ({ x, y })),
            a,
            b,
            dir,
            front: { x: -dir.y, y: dir.x },
            length,
            on: state.overrides.get(d.key)?.on ?? d.meta.shield !== "off",
            freq: d.meta.freq === null ? null : Number(d.meta.freq) || shieldConfig.freq,
            hit: before.get(d.key)?.hit ?? { along: 0, up: 0, shown: 0, wanted: 0, struck: 0 },
            slot: gmId >= 0 && roomId >= 0 ? slotOf(gmId, roomId) : alwaysShownSlot,
          });
        }
        for (const key of state.crossing.keys()) if (state.segs.has(key) === false) state.crossing.delete(key);

        for (const key of state.overrides.keys()) if (state.segs.has(key) === false) state.overrides.delete(key);

        for (const { index, a, b, on, slot, hit } of state.segs.values()) {
          // biome-ignore format: a row an attribute
          state.data.set([
            a.x, a.y, b.x, b.y,
            slot, on ? 1 : 0, 0, 0,
            hit.along, hit.up, hit.shown, hit.struck,
          ], index * shieldStride);
        }
        state.sendToRaycast();
        state.mesh.visible = state.frameMesh.visible = state.segs.size > 0; // else no draw call
        state.mesh.geometry.instanceCount = state.frameMesh.geometry.instanceCount = state.segs.size;
        state.buffer.needsUpdate = true;
        w.r3f?.invalidate();
      },
      syncTheme() {
        const theme = w.getTheme();
        const pale = theme.floor.deck === "light";
        state.color.value.set(pale ? shaderConfig.paleColor : shaderConfig.color);
        state.fill.value = pale ? shaderConfig.paleFill : shaderConfig.fill;
        state.lineWidth.value = pale ? shaderConfig.paleLineWidth : shaderConfig.lineWidth;
        state.gain.value = pale ? shaderConfig.paleGain : shaderConfig.darkGain * theme.npcs.fxStrength;
        state.glowGain.value = pale ? shaderConfig.paleGlow : state.gain.value;
        // light cannot be added to a pale deck, so there a shield is laid over it
        state.added.value = pale ? 0 : 1;
        const blending = pale ? THREE.NormalBlending : addedBlending.blending;
        if (state.mat.blending !== blending)
          Object.assign(state.mat, { ...addedBlending, blending, needsUpdate: true });
        w.r3f?.invalidate();
      },
    }),
    // the attributes wrap the data
    { reset: { mesh: true, mat: true, frameMesh: true, frameMat: true, data: true, buffer: true } },
  );

  w.shields = state;

  useEffect(() => {
    const sub = w.events.subscribe({
      next(e) {
        if (e.key === "decor-ready" || e.key === "decor-created" || e.key === "decor-removed") state.sync();
        else if (e.key === "removed-npcs")
          for (const npcs of state.crossing.values()) for (const key of e.npcKeys) npcs.delete(key);
        else if ((e.key === "enter-collider" || e.key === "exit-collider") && Boolean(e.meta.shield)) {
          const key = String(e.meta.decorKey);
          const [seg, npc] = [state.segs.get(key), w.n?.[e.npcKey]];
          if (seg === undefined || npc === undefined) return;
          const npcs = state.crossing.get(key) ?? new Map<string, number>();
          if (e.key === "exit-collider") npcs.delete(e.npcKey);
          else {
            npcs.set(e.npcKey, Math.sign(offOf(seg, npc)) || 1);
            // none is raised in one: so a gun may die, or revive, at its line — see `crossLines`
            if (seg.on === true) w.phasers?.disarm(e.npcKey);
          }
          npcs.size === 0 ? state.crossing.delete(key) : state.crossing.set(key, npcs);
        }
      },
    });
    if (w.decor?.ready === true) state.sync();
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => state.syncTheme(), []);

  useEffect(() => {
    Object.assign(state.mat, shieldNodes(state, w.view), { needsUpdate: true });
    Object.assign(state.frameMat, shieldFrameNodes(w.view), { needsUpdate: true });
    state.sync(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid]);

  return (
    <>
      <primitive object={state.mesh} />
      <primitive object={state.frameMesh} />
    </>
  );
}

const mid = (p: Geom.VectJson, q: Geom.VectJson) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

const noFreqs: readonly number[] = [];

/** Metres they stand off its line, signed by side */
const offOf = (seg: Seg, { position: { x, z } }: { position: THREE.Vector3 }) =>
  (x - seg.a.x) * seg.front.x + (z - seg.a.y) * seg.front.y;

/** Whether a phaser knowing `freqs` is let through: never, by a shield of no frequency */
const passes = (freqs: undefined | readonly number[], seg: Seg) =>
  seg.freq !== null && (freqs ?? noFreqs).includes(seg.freq);

/** Decor keys already warned of */
const tooSmall = new Set<string>();

const tmpStopped = new THREE.Vector3();

const shieldConfig = {
  /** Seconds the glow round a beam takes to come, or go */
  fadeSecs: 0.2,
  /** Seconds a shield fired on takes to thin again, once the fire stops */
  struckSecs: 1.5,
  /** Metres a shield's rect is at least, each way, unless of no frequency: a phaser is lowered before its muzzle is through */
  minSize: 1,
  /** Metres past a shield's line that count as over it */
  lineSlack: 0.05,
  /** Given a shield whose decor has no `freq`: `null` there is none, on purpose */
  freq: 1,
} as const;

type Seg = {
  /** Its instance */
  index: number;
  /** Its rect's corners, which a ray is cast against */
  points: Geom.VectJson[];
  /** Its ends in the plan, the unit way from `a` to `b`, and `front`, a unit normal: which side someone is */
  a: Geom.VectJson;
  b: Geom.VectJson;
  dir: Geom.VectJson;
  front: Geom.VectJson;
  length: number;
  /** Off, it does nothing */
  on: boolean;
  /** A phaser tuned to this is let through — `null` lets none through, and kills none */
  freq: null | number;
  /** Where a beam meets it, in metres from `a` and up, and how far that shows — `wanted` by the beams, this tick */
  hit: {
    along: number;
    up: number;
    shown: number;
    wanted: number /** How far it is thickened by being fired on */;
    struck: number;
  };
  /** Its room's, which it fades with */
  slot: number;
};

export type State = ShieldResources & {
  /** By decor key: every shield there is */
  segs: Map<string, Seg>;
  /** By decor key: what it was since set to, over its decor's own */
  overrides: Map<string, { on: boolean }>;
  /** By decor key: the npcs stood in it, and the side of its line each is on, `1` or `-1` */
  crossing: Map<string, Map<string, number>>;
  /** Moves the field's clock on, counts line crossings, and fades each struck shield's glow and thickening */
  onTick(): void;
  /**
   * Where one of the shields `keys`, nearest first, stops a beam of those `freqs`, from their body `from` out of `tip`
   * to `to`, else `null`. The point is kept: copy it to hold it
   */
  stop(
    keys: readonly string[],
    from: THREE.Vector3,
    tip: THREE.Vector3,
    to: THREE.Vector3,
    freqs?: readonly number[],
  ): null | THREE.Vector3;
  /** Gives the nav worker's raycast every shield, and has the phasers cast again */
  sendToRaycast(): void;
  /** Whoever stands in a shield and has stepped over its line has crossed it: no event tells of that */
  crossLines(): void;
  /** The shield that last stopped one, which `strike` is on */
  stoppedBy: null | Seg;
  /** A beam stopped by the last `stop` ends at `end`, as far landed as `strength`: where the shield shows it */
  strike(end: THREE.Vector3, strength: number): void;
  /** Switches a shield, or retunes it, until it is next made */
  configure(key: string, opts: { on?: boolean; freq?: null | number }): void;
  /** Writes a shield's frequency to its decor's meta, and a runtime one's def: kept */
  setFreq(key: string, freq: null | number): void;
  /** Whether they stand in a shield that is on, where no phaser may be raised */
  isIn(npcKey: string): boolean;
  /** The phaser they carry, whose `meta` has the `freqs` it knows and those it went `dead` to */
  phaserOf(npcKey: string): undefined | Geomorph.DecorDef;
  freqsOf(npcKey: string): readonly number[];
  /** Whether their phaser cannot be raised */
  isDead(npcKey: string): boolean;
  /** Sets the frequencies their phaser knows, which revives it of those */
  tune(npcKey: string, freqs: number[]): void;
  setDead(npcKey: string, meta: Meta, dead: number[]): void;
  /** They crossed a shield, which kills their phaser or revives it */
  onCross(npcKey: string, seg: Seg): void;
  /** Reads the shields off the decor, and writes them all */
  sync(): void;
  /** Their ink and blending, by the deck's theme — see `Phasers.syncTheme` */
  syncTheme(): void;
};
