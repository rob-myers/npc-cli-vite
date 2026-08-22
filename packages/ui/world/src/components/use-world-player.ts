import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { defaultPlayerKey, npcfg, spawnPlayerAttempts } from "../const";
import { getWorldMapStore, getWorldStore } from "../service/storage";
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
      introEnabled: getWorldStore(w.key).read().introEnabled,
      introMapKey: null,
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

        const npc = w.n[state.key];
        if (npc !== undefined) {
        }
      },
      async panTo() {
        const npc = w.n[state.key];
        if (npc === undefined) return;

        // pressed again once already on them, it goes round BEHIND them instead: an npc turned to
        // `atan2(vx, vz) + π` faces `(-sin y, -cos y)`, and the camera stands at `(sin θ, cos θ)`
        // from its target, so behind them is `θ = rotation.y`. A one-off swing, not a follow —
        // the view stays wherever this leaves it
        const target = w.view.controls?.target;
        const onThem =
          target !== undefined && Math.hypot(target.x - npc.point.x, target.z - npc.point.y) < panBehindFrom;

        // asking to look AT them outranks wherever a pan last chose to stand: without this the
        // follow eases straight back to that vantage, and the pan appears to bounce
        w.view.followOffset.set(0, 0);

        // no `radius`, so the intro pans and turns without zooming — `lookAt` keeps the
        // distance it finds, which on load is whatever view we restored. Their height, so
        // the camera settles on the npc rather than on the floor they stand on
        await w.view.lookAt(npc.point, {
          animate: true,
          height: npcfg.dist.height,
          azimuthal: onThem === true ? npc.rotation.y : undefined,
          // they walk whilst we pan, and following means the camera is expected to be ON them —
          // a destination fixed at the moment of the press lands behind
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
        state.set({ key: npcKey });
        // retargets the dynamic light, snapping it so it shows whilst paused
        state.persist();
        void state.panTo(); // as on load
      },
      setIntroEnabled(next) {
        getWorldStore(w.key).patch({ introEnabled: next });
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
}

export type State = {
  /** Should we pan to the player, on load or on demand? */
  introEnabled: boolean;
  /** The map whose intro already ran, so hmr doesn't repeat it */
  introMapKey: null | string;
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
  /** Enabling replays the intro immediately; disabling remembers the current view */
  setIntroEnabled(next: boolean): void;
  /** Make `npcKey` the player, retargeting the dynamic light and panning. No-op if absent */
  setKey(npcKey: string): void;
  /** Spawns the player in a random room — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};

/** Within this of the player, the camera button swings behind them rather than panning */
const panBehindFrom = 0.5;
