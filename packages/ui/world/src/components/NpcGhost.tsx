import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { ghostConfig } from "../const.npc";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/** Ghost: they become a dot screen as the shot locks on, and it passes through them — see `docs/engagements.md` */
export default function NpcGhost() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ghosts: new Map(),

      ghost(npc) {
        // shot again whilst a ghost: they stay one
        const startSecs = w.gameTime.now() - (state.ghosts.has(npc.key) ? ghostConfig.inSecs : 0);
        state.ghosts.set(npc.key, { npc, startSecs, struckSecs: null });
        state.onTick(); // shown at once, even paused
      },
      isGhosting(npcKey) {
        const ghost = state.ghosts.get(npcKey);
        return ghost !== undefined && w.gameTime.now() < ghost.startSecs + ghostConfig.inSecs;
      },
      onTick() {
        if (state.ghosts.size === 0) return; // nearly always
        const now = w.gameTime.now();
        const { amount, inSecs, holdSecs, missSecs, outSecs } = ghostConfig;
        for (const [npcKey, { npc, startSecs, struckSecs }] of state.ghosts) {
          /** Seconds since they began to come back: unstruck, once the shot is surely gone */
          const back = now - (struckSecs === null ? startSecs + missSecs : struckSecs + holdSecs);
          const out = THREE.MathUtils.clamp(1 - back / outSecs, 0, 1);
          if (npc.dotScreen !== undefined) npc.dotScreen.value = amount * Math.min(1, (now - startSecs) / inSecs) * out;
          if (out === 0) state.ghosts.delete(npcKey);
        }
        w.r3f?.invalidate(); // one more frame once the last is back
      },
      struck(npc) {
        const ghost = state.ghosts.get(npc.key);
        if (ghost !== undefined) ghost.struckSecs = w.gameTime.now();
      },
    }),
    { reset: { ghosts: true } },
  );

  w.npcGhost = state;

  return null;
}

/** A shot at them that passes through */
type Ghost = {
  npc: Npc;
  startSecs: number;
  struckSecs: null | number;
};

export type State = {
  /** Each until they come back */
  ghosts: Map<string, Ghost>;
  /** A shot at `npc` locks on that will pass through them: they become a dot screen */
  ghost(npc: Npc): void;
  /** Becoming a ghost still, so a shot at them waits */
  isGhosting(npcKey: string): boolean;
  /** Each a tick further on: how much of a dot screen they are */
  onTick(): void;
  /** The shot at `npc` strikes, passing through them */
  struck(npc: Npc): void;
};
