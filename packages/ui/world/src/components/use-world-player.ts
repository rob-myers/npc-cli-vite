import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { defaultPlayerKey, spawnPlayerAttempts, spawnRoomLabels } from "../const";
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
          // were. A map we have never stood on starts them at one of its spawn points
          (await state.restore()) || (await state.restoreFromSpawnPoint()) || (await state.spawnSomewhere());
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
        w.e.persistDecor();
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
      async restoreFromSpawnPoint() {
        const points = Object.values(w.decor.byKey).filter(
          (decor): decor is Geomorph.DecorPoint => decor.type === "point" && decor.meta.spawn === true,
        );
        const point = points[Math.floor(Math.random() * points.length)];
        if (point === undefined) {
          return false; // a map without spawn points
        }
        await w.npc.spawn({ npcKey: state.key, at: { x: point.x, y: point.y } });
        return true;
      },
      assign(npcKey) {
        state.key = npcKey;
        w.events.next({ key: "set-player", playerKey: npcKey });
      },
      setKey(npcKey) {
        if (npcKey === state.key || w.n[npcKey] === undefined) {
          return;
        }
        w.e.setNpcLit(w.n[npcKey], false);
        state.assign(npcKey);
        state.update();
        // retargets the dynamic light, snapping it so it shows whilst paused
        state.persist();
        void state.panTo(); // as on load
      },
      async spawnSomewhere() {
        // the rooms labelled by `spawnRoomLabels`, judged by their labelling decor point
        const rooms = Object.values(w.decor.byKey).flatMap((decor) =>
          w.helper.isRoomLabel(decor) && spawnRoomLabels.includes(decor.meta.label) ? [decor.meta] : [],
        );
        for (let attempt = 0; attempt < spawnPlayerAttempts; attempt++) {
          const { gmId, roomId } = rooms[Math.floor(Math.random() * rooms.length)] ?? {};
          const gm = w.gms[gmId as number];
          const room = gm?.rooms[roomId as number];
          if (room === undefined) {
            break; // no such rooms
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
  /** Spawns the player at one of the map's `meta.spawn` decor points, at random — `false` if it has none */
  restoreFromSpawnPoint(): Promise<boolean>;
  /** Make `npcKey` the player, retargeting the dynamic light and panning. No-op if absent */
  /** Make them the player, telling everyone — the bare act, without `setKey`'s lit, persist and pan */
  assign(npcKey: string): void;
  setKey(npcKey: string): void;
  /** Spawns the player in a random room labelled by `spawnRoomLabels` — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};
