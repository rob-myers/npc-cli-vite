import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { defaultPlayerKey, spawnPlayerAttempts } from "../const";
import { getWorldMapStore } from "../service/storage";
import type { State as WorldState } from "./World";

/**
 * The player of a World: which npc they are, where they appear on
 * arriving at a map, and the "intro" i.e. panning the camera onto them.
 *
 * Their per-map position is persisted alongside every other npc — see
 * `w.e.persistNpcs`.
 */
export default function useWorldPlayer(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      key: defaultPlayerKey,
      prevMapPosition: null,

      async ensure() {
        if (w.n[state.key] === undefined) {
          // a map keeps its own player position, so returning to it puts them back where they
          // were. Only a map we have never stood on carries their position over from the last
          (await state.restore()) ||
            (await state.restoreNearPrevMap()) ||
            (await state.restoreNearCamera()) ||
            (await state.spawnSomewhere());
        }
        state.prevMapPosition = null;
      },
      async panTo() {
        const npc = w.n[state.key];
        if (npc === undefined) return;

        // no `radius`, so this pans and turns without zooming — `lookAt` keeps the distance it
        // finds, which on load is whatever view we restored
        await w.view.lookAt(npc.point, {
          animate: true,
          // they walk whilst we pan, and the point of it is to be ON them — a destination fixed at
          // the moment of the press lands behind
          track: () => w.n[state.key]?.point,
        });
      },
      persist() {
        w.e.persistNpcs();
      },
      async restore() {
        const saved = getWorldMapStore(w.key, w.mapKey)
          .read()
          .npcs?.npcs.find((x) => x.key === state.key);
        if (saved === undefined) {
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
      async restoreNearCamera() {
        const target = w.view.controls?.target;
        if (target === undefined) {
          return false;
        }
        const at = { x: target.x, y: target.z };

        // the exact point if navigable, else the nearest room centres
        const candidates: JshCli.PointAnyFormat[] = [];
        const snapped = w.npc.getClosestPoly(at, "0.5");
        if (snapped.success === true) {
          candidates.push(snapped.position);
        }
        candidates.push(
          ...w.gms
            .flatMap((gm) => gm.rooms.map((room) => gm.matrix.transformPoint({ ...room.center })))
            .sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y))
            .slice(0, spawnPlayerAttempts),
        );

        for (const point of candidates) {
          try {
            await w.npc.spawn({ npcKey: state.key, at: point });
            return true;
          } catch {
            // e.g. "not placable": try the next candidate
          }
        }
        return false;
      },
      async restoreNearPrevMap() {
        if (state.prevMapPosition === null) {
          return false; // on load, rather than onchange map
        }

        const result = w.npc.getClosestPoly(state.prevMapPosition, "0.5");
        if (result.success === false) {
          return false; // nowhere nearby is navigable
        }

        try {
          await w.npc.spawn({ npcKey: state.key, at: result.position });
          return true;
        } catch (e) {
          error(e);
          return false;
        }
      },
      setKey(npcKey) {
        if (npcKey === state.key || w.n[npcKey] === undefined) {
          return;
        }
        w.e.setNpcLit(w.n[npcKey], false);
        state.set({ key: npcKey });
        // retargets the dynamic light, snapping it so it shows whilst paused
        state.persist();
        void state.panTo(); // as on load
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
}

export type State = {
  /** Key of the npc we consider the player — spawned on arrival if absent */
  key: string;
  /** Where they stood on the previous map, set by `w.e.onChangeMap` */
  prevMapPosition: null | Geom.VectJson;

  /** Place the player if absent, then track them */
  ensure(): Promise<void>;
  /** Pans the camera onto the player */
  panTo(): Promise<void>;
  /** Saves every npc for `w.mapKey` — see `w.e.persistNpcs` */
  persist(): void;
  /** Respawns the player where they were on this map — `false` if we couldn't */
  restore(): Promise<boolean>;
  /** Spawns the player as near the camera as we can manage — `false` if we couldn't */
  restoreNearCamera(): Promise<boolean>;
  /** Respawns the player near where they were on the previous map — `false` if we couldn't */
  restoreNearPrevMap(): Promise<boolean>;
  /** Make `npcKey` the player, retargeting the dynamic light and panning. No-op if absent */
  setKey(npcKey: string): void;
  /** Spawns the player in a random room — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};
