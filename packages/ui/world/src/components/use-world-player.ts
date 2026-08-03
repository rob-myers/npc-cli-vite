import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { error, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import { defaultPlayerKey, defaultSkinKey, playerStorageKeyPrefix, spawnPlayerAttempts } from "../const";
import * as persisted from "../service/get-persisted";
import type { State as WorldState } from "./World";

/**
 * Brings the player into a World: restores them where the previous session left
 * them (else spawns them somewhere random), and runs the "intro" i.e. pans the
 * camera onto them.
 */
export default function useWorldPlayer(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      introEnabled: persisted.getIntroEnabled(),
      introMapKey: null,
      key: defaultPlayerKey,
      settled: false,

      async bootstrap() {
        // hmr re-runs this, so the intro is per-map rather than per-call
        const introDone = state.introMapKey === w.mapKey;
        state.introMapKey = w.mapKey;

        await state.ensure();

        if (introDone === false && state.introEnabled === true) {
          await state.panTo();
        }
      },
      async ensure() {
        if (w.n[state.key] === undefined && (await state.restore()) === false) {
          await state.spawnSomewhere();
        }

        const npc = w.n[state.key];
        if (npc !== undefined) {
          w.npc.trackNpc(npc.key);
        }
      },
      async panTo() {
        const npc = w.n[state.key];
        if (npc !== undefined) {
          // we look at the player rather than restoring a persisted point
          await w.view.lookAt(npc.point, { animate: true });
        }
      },
      persist() {
        const npc = w.n[state.key];
        if (npc === undefined) {
          return;
        }

        const player: PersistedPlayer = {
          at: { x: npc.point.x, y: npc.point.y },
          angle: npc.rotation.y,
          skinKey: w.npc.getSkinKeyBySkinIndex(npc.skinIndex) ?? defaultSkinKey,
          decorKey: w.e.npcToDoable[npc.key] ?? undefined,
        };
        tryLocalStorageSet(`${playerStorageKeyPrefix}:${w.mapKey}`, JSON.stringify(player));
      },
      async restore() {
        const saved = tryLocalStorageGetParsed<PersistedPlayer>(`${playerStorageKeyPrefix}:${w.mapKey}`);
        if (saved === null) {
          return false;
        }

        try {
          // the usual spawn, so e.g. colliders are triggered
          await w.npc.spawn({
            npcKey: state.key,
            // the decor meta re-establishes what they were doing e.g. sitting
            at: { ...saved.at, meta: saved.decorKey ? w.decor.byKey[saved.decorKey]?.meta : undefined },
            angle: saved.angle,
            as: saved.skinKey,
          });
          return true;
        } catch (e) {
          error(e); // e.g. no longer placable
          return false;
        }
      },
      setIntroEnabled(next) {
        persisted.setIntroEnabled(next);
        if (next === false) {
          // on load we'll restore this view, rather than pan to the player
          w.view.controls !== null && w.view.onCameraEnd();
        }

        state.set({ introEnabled: next });

        if (next === true) {
          void state.ensure().then(() => state.panTo());
        }
      },
      async spawnSomewhere() {
        for (let attempt = 0; attempt < spawnPlayerAttempts; attempt++) {
          const gm = w.gms[Math.floor(Math.random() * w.gms.length)];
          const room = gm?.rooms[Math.floor(Math.random() * gm.rooms.length)];
          if (room === undefined) {
            continue;
          }

          try {
            await w.npc.spawn({ npcKey: state.key, at: gm.matrix.transformPoint({ ...room.center }) });
            return true;
          } catch (e) {
            error(e); // e.g. "not placable": try another room
          }
        }
        return false;
      },
    }),
  );

  w.player = state;

  // gate the initial spawn, so the player doesn't mount whilst the world is still loading
  useEffect(() => {
    if (state.settled === true || Object.keys(w.pending).length > 0) return;
    const timer = setTimeout(() => state.set({ settled: true }), settledMs);
    return () => clearTimeout(timer);
  }, [Object.keys(w.pending).join(","), state.settled]);

  useEffect(() => {
    // decor must be ready, else the player cannot resume what they were doing
    if (w.npc?.gltf != null && w.decor?.ready === true && w.isReady() === true && state.settled === true) {
      void state.bootstrap();
    }
  }, [w.npc?.gltf, w.decor?.ready, state.settled, w.mapKey]);
}

export type State = {
  /** Should we pan to the player, on load or on demand? */
  introEnabled: boolean;
  /** The map whose intro already ran, so hmr doesn't repeat it */
  introMapKey: null | string;
  /** Key of the npc we consider the player — spawned on start if absent */
  key: string;
  /** Has nothing been pending for `settledMs`? Latched, gating the initial spawn */
  settled: boolean;

  /** Ensure the player exists, then run the intro once */
  bootstrap(): Promise<void>;
  /** Restores the player, else spawns them somewhere random, then tracks them */
  ensure(): Promise<void>;
  /** Pans the camera onto the player */
  panTo(): Promise<void>;
  /** Saves the player for `w.mapKey`, so `restore` can bring them back */
  persist(): void;
  /** Respawns the player saved by `persist` — `false` if there was none, or it failed */
  restore(): Promise<boolean>;
  /** Enabling replays the intro immediately; disabling remembers the current view */
  setIntroEnabled(next: boolean): void;
  /** Spawns the player in a random room — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};

/** How long nothing must be pending before `w.player.settled` */
const settledMs = 500;

type PersistedPlayer = {
  at: { x: number; y: number };
  /** Radians, CW from north viewed from above */
  angle: number;
  skinKey: string;
  /** Set when the player was doing something e.g. sitting */
  decorKey?: string;
};
