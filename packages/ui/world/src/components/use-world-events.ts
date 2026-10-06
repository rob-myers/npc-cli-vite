import { ExhaustiveError, type UseStateRef, useStateRef } from "@npc-cli/util";
import { Rect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import shortUuid from "short-uuid";
import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import {
  decorCuboidHeight,
  defaultDoorCloseMs,
  defaultPlayerKey,
  defaultSkinKey,
  floorFadeDelayMs,
  type ItemKind,
  inventoryConfig,
  MAX_NPCS,
  mapVeilMs,
  roomLabel,
  sguToWorldScale,
} from "../const.env";
import type { AStarSearchResult } from "../pathfinding/AStar";
import { MODE_FADE_SECS } from "../service/fade-rooms";
import { helper } from "../service/helper";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import * as persisted from "../service/storage";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

export default function useWorldEvents(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      carried: structuredClone(persisted.getWorldStore(w.key).read().carried), // the default is shared
      changingMap: false,
      handling: new Set(),
      reachedRight: new Set(),
      insideDoorways: new Map(),
      doorOpen: {},
      doorToNpcs: {},
      externalNpcs: new Set(),
      handLitRooms: new Set(),
      keyedListener: new Map(),
      litRooms: new Map(),
      npcToAccess: {},
      npcToDoors: {},
      pendingRaycast: {},
      pendingUnreachable: {},

      addFrameCallback(cb) {
        return w.r3f.internal.subscribe({ current: cb }, 0, w.r3fStore);
      },
      addKeyedListener(key, listener) {
        state.keyedListener.set(key, listener);
      },
      canAutoCloseDoor(door) {
        const closeNpcs = state.doorToNpcs[door.gdKey];

        // if (door.auto === false && door.locked === true) {
        //   // never auto-close manual locked doors
        //   return false;
        // }

        if (closeNpcs === undefined || closeNpcs.nearby.size === 0) {
          // auto or unlocked manual doors auto-close when no nearby npcs
          return true;
        }

        if (door.proximity === true) {
          return false; // proximity door won't close until npc leaves
        }

        if (closeNpcs.inside.size > 0) {
          return false;
        }

        return [...closeNpcs.nearby].every((npcKey) => w.n[npcKey].isMoving() === false);
      },
      chainKey(npcKey, itemKey) {
        const had = state.carried[npcKey];
        const index = had?.items.findIndex((def) => def.key === itemKey) ?? -1;
        const { door, map } = had?.items[index]?.meta ?? {};
        // a gdKey means nothing on another map
        if (helper.isGmDoorKey(door) === false || !(door in w.door.byKey) || (map ?? w.mapKey) !== w.mapKey)
          return false;
        had.items.splice(index, 1);
        state.setAccess(npcKey, door, true);
        state.onCarriedChange(npcKey);
        return true;
      },
      clearHandLitRooms() {
        state.handLitRooms.clear();
        state.syncFadeRooms();
      },
      dropItem(npcKey, name) {
        const had = state.carried[npcKey];
        if (had === undefined) return false;
        if (name === "psi") {
          if (had.psi !== true) return false;
          delete had.psi;
          if (npcKey === w.player.key) w.psi?.choose(null);
          state.onCarriedChange(npcKey);
          return true;
        }
        const def = had.items.find((def) => def.key === name || def.meta?.item === name);
        const npc = w.n?.[npcKey];
        if (def === undefined || npc === undefined) return false;
        // onto a surface in reach — else a point goes on the floor, unless sat or lain: those are not on it
        let spot = state.getDropSpot(npcKey, def);
        if (spot === null && def.type !== "quad" && w.npc.npcToDoable[npcKey] == null) {
          // where their hand comes down, so it is taken up again from where they stand — else at their feet
          const { x, y } = npc.point;
          const ry = npc.rotation.y;
          const ahead = {
            x: x - Math.sin(ry) * inventoryConfig.standOff,
            y: y - Math.cos(ry) * inventoryConfig.standOff,
          };
          spot = { ...(w.npc.getClosestPoly(ahead, 0.1).success === true ? ahead : { x, y }), y3d: 0 };
        }
        if (spot === null) return false;
        state.handle(npcKey, async () => {
          /** Out of the hand it is in */
          const gun = def.meta?.item === "phaser";
          const put = () => {
            const items = state.carried[npcKey]?.items ?? [];
            const index = items.indexOf(def);
            if (index === -1) return; // gone meanwhile
            items.splice(index, 1);
            w.decor.create(state.getItemDefAt(def, spot));
            state.onCarriedChange(npcKey);
          };
          /** Its top, as it is taken from: so the arm goes out the same either way */
          const top = { ...spot, y3d: spot.y3d + (Number(def.meta?.h) || 0) };
          await state.reachFor(npc, "drop", top, put, gun === true ? "right" : undefined);
        });
        return true;
      },
      dispatchToKeyedListeners(e) {
        for (const listener of state.keyedListener.values()) {
          listener(e, w);
        }
      },
      findPathAsync(srcGrKey, dstGrKey, opts) {
        return w.gmRoomGraph.findPathAsync(srcGrKey, dstGrKey, {
          setNodeWeights: opts?.setNodeWeights,
        });
      },
      getPoint(npcKey) {
        const npc = w.npc.get(npcKey);
        return {
          x: npc.position.x,
          y: npc.position.z,
          meta: { npcKey, ...w.npc.npcToRoom.get(npcKey) },
        };
      },
      async move({ npcKey, to, arrive = true, fast, backwards, backstep, strafe }) {
        /** Can be overriden if unreachable due to locked doors */
        let groundPoint = helper.parseGroundPoint(to);

        const npc = w.npc.get(npcKey);
        const result = w.npc.getClosestPoly(groundPoint, 0.5);
        const doResult = w.npc.findFreeDoMeta(to?.meta ?? emptyMeta, npcKey);
        const { config } = w.npc;

        if (doResult.type === "occupied") {
          throw Error("occupied");
        }

        // so can resume doable or nav
        npc.last.dst = helper.parseGroundPoint(to);

        npc.rejectAll(new Error("move again"));

        if (doResult.type !== "none") {
          // doable overrides navigable
          if (doResult.type === "use-current") {
            await w.npc.spawn({ npcKey, at: to }); // respawn
          } else {
            w.events.next({ key: "npc-pre-do", npcKey });

            if (w.npc.npcToDoable[npcKey] === null && npc.distanceTo(groundPoint) < config.dist.doableLook) {
              // look when standing nearby
              // else an npc interrupted mid-move keeps its momentum and slides through the look
              w.npc.clearMomentum(npc);
              await npc.look({ at: to, minMs: config.time.look * 1000 });
            }

            await npc.fadeSpawn({ at: to });
          }
          // fix contiguous move
          npc.anim.moving = false;
          return;
        }

        if (!result.success) {
          throw Error("not navigable");
        }

        if (npc.agentId === null) {
          // fade spawn from doable to nav
          await npc.fadeSpawn({ at: result.position, facingTarget: true });
          return;
        }

        w.npc.setNpcDo(npcKey, null); // in case do=stand

        await npc.ensureLegalPosition();

        // code below is interruptible by next move
        try {
          // navigation unreachable relative to locked doors?
          const unreachableResult = await state.testTargetUnreachable(npc, w.findRoomContaining(groundPoint));
          npc.last.unreachableResult = unreachableResult;

          if (unreachableResult !== null) {
            // destination unreachable
            if (npc.distanceTo(unreachableResult.nearbyPoint) < config.dist.blockedLook) {
              // too close: look instead of walk
              await npc.look({ at: unreachableResult.nearbyPoint, minMs: config.time.look * 1000 });
              return;
            }
            // change destination to point near eventual locked door
            const nearDoor = w.npc.getClosestPoly(unreachableResult.nearbyPoint);
            groundPoint = helper.parseGroundPoint(nearDoor.position);
          }

          npc.anim.strafe = strafe ?? Boolean(npc.anim.face.aim); // aiming, they strafe unless told not to
          npc.anim.strafeFollowsAim = strafe === undefined; // so an npc armed mid-move strafes at once
          npc.anim.backwards =
            npc.anim.strafe === false && (backwards ?? (backstep === true && isBackStep(npc, groundPoint, config)));
          npc.anim.fast = fast === true && npc.anim.backwards === false && npc.anim.strafe === false; // the gait itself follows their speed — see `syncGait`
          npc.anim.fastAsked = fast === true;
          npc.anim.aimAt({ groundPoint, result });
          await w.npc.turnBeforeMoving(npc);
          npc.anim.startMoving(arrive);

          w.npc.postCrowdTickEvents.push({ key: "started-moving", npcKey });

          await new Promise<string>((resolve, reject) => {
            npc.resolve.move = resolve;
            npc.reject.move = reject;
          });
        } catch (e) {
          if (e instanceof Error && e.message === "move again") {
            return; // interrupting move owns npc now
          }
          if (!(e instanceof Error && e.message === "look again")) {
            npc.anim.startIdle({ force: true }); // delegated to look
          }
          w.npc.postCrowdTickEvents.push({ key: "stopped-moving", npcKey });
          throw e;
        }
      },
      npcCanAccess(npcKey, gdKey, planning = true) {
        const door = w.d[gdKey];
        if (!door || door.locked === false) {
          return true; // absent onchange map
        }
        // An npc without access can slip through a locked door whilst it stands OPEN, but only
        // from right beside it. Asked whether they could get somewhere — rather than whether they
        // could step through from where they are standing — the proximity is beside the point:
        // they would walk up to it first, and satisfy it on arrival
        if (door.open === true && (planning === true || state.doorToNpcs[door.gdKey]?.nearby.has(npcKey))) {
          return true;
        }
        // only if npc has been granted access
        return !!state.npcToAccess[npcKey]?.[door.gdKey];
      },
      getDropSpot(npcKey, def) {
        const [npc, room] = [w.n?.[npcKey], w.npc.npcToRoom.get(npcKey)];
        if (npc === undefined || room === undefined) return null;
        const { reach, surface } = inventoryConfig;
        const { x: px, y: py } = npc.point;
        /** Half its footprint: along the edge it is laid by, and in from it */
        const [halfW, halfH] = halfSizeOf(w.sheets, def);
        const inset = halfH + surface.margin;
        const items = Object.values(w.decor.runtime.byKey).filter((d) => d.meta.item !== undefined);
        const tables = [...(w.decor.byRoom[room.gmId]?.[room.roomId] ?? [])]
          .filter((d) => d.meta.surface === true && d.meta.refinedOutline !== undefined)
          .map((d) => ({ outline: d.meta.refinedOutline as Geom.VectJson[], y3d: Number(d.meta.y) || 0 }));

        let best: null | DropSpot = null;
        /** No further than it could be taken back from */
        const within = npc.anim.pose === "sit" ? reach.seated : reach.raised;
        let bestDist: number = within;
        for (const { outline, y3d } of tables) {
          /** Tables are often several obstacles abutting, as one top: it may lie across them */
          const onTop = (p: Geom.VectJson) =>
            tables.some((t) => t.y3d === y3d && geomService.outlineProperlyContains(t.outline, p));
          const edges = outline.map((a, i) => [a, outline[(i + 1) % outline.length]]);
          /** Which way round it runs: its inside is to that side of every edge, concave or not */
          const side = Math.sign(edges.reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0)) || 1;
          for (const [a, b] of edges) {
            const near = geomService.getClosestOnSeg(npc.point, a, b);
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (near.dst > within || length === 0) continue;
            const [tx, ty] = [(b.x - a.x) / length, (b.y - a.y) / length];
            const [nx, ny] = [-ty * side, tx * side]; // inwards
            // slid along the edge: the nearest place that is all on a table, and on no other item
            for (let along = -surface.span; along <= surface.span; along += surface.step) {
              const [x, y] = [near.x + tx * along + nx * inset, near.y + ty * along + ny * inset];
              const dist = Math.hypot(x - px, y - py);
              if (dist >= bestDist) continue;
              const corners = [-halfW, halfW].flatMap((u) =>
                [-halfH, halfH].map((v) => ({ x: x + u * tx + v * nx, y: y + u * ty + v * ny })),
              );
              const box = Rect.fromPoints(...corners).inset(0.01); // they may touch
              if (corners.every(onTop) === false || items.some((d) => d.bounds.intersects(box))) continue;
              // squared up to the edge, its image the right way up for whoever stands there: turned, never mirrored
              [best, bestDist] = [{ x, y, y3d, linear: [-tx * side, -ty * side, -nx, -ny] }, dist];
            }
          }
        }
        return best;
      },
      getItemDefAt(def, at) {
        const kind = String(def.meta?.item);
        let key = def.key;
        for (let i = 1; key in w.decor.byKey; i++) key = `${kind}-${i}`;
        if (def.type !== "quad") {
          return { ...def, key, x: at.x, y: at.y, y3d: at.y3d || undefined, transform: undefined } as Geomorph.DecorDef;
        }
        // a quad's transform starts at its image's corner
        const [halfW, halfH] = halfSizeOf(w.sheets, def);
        const [a, b, c, d] = at.linear ?? def.transform ?? [1, 0, 0, 1];
        const transform: Geom.SixTuple = [a, b, c, d, at.x - (a * halfW + c * halfH), at.y - (b * halfW + d * halfH)];
        return { ...def, key, transform, y3d: at.y3d + (def.meta?.h ?? decorCuboidHeight) }; // its top: stood on it
      },
      getHeldDoors(npcKey) {
        const held = Object.entries(state.npcToAccess[npcKey] ?? {}).flatMap(([gdKey, has]) =>
          has === true ? gdKey : [],
        );
        return held.length === 0 ? undefined : (held as Geomorph.GmDoorKey[]);
      },
      giveItem(npcKey, name, extra) {
        const had = (state.carried[npcKey] ??= { items: [] });
        if (name === "psi") {
          had.psi = true;
        } else {
          if (state.hasRoomFor(npcKey, name) === false) return false;
          let key = `${name}-0`;
          for (let i = 1; had.items.some((def) => def.key === key); i++) key = `${name}-${i}`;
          const h = inventoryConfig.height[name];
          const meta = { item: name, h, shown: true, ...extra };
          had.items.push(
            h === undefined
              ? { type: "point", key, img: name, x: 0, y: 0, scale: inventoryConfig.pointScale, meta }
              : { type: "quad", key, img: name, transform: [1, 0, 0, 1, 0, 0], meta },
          );
        }
        state.onCarriedChange(npcKey);
        return true;
      },
      handle(npcKey, run) {
        if (state.handling.has(npcKey)) return; // one thing at a time
        state.handling.add(npcKey);
        void run().finally(() => state.handling.delete(npcKey));
      },
      hasItem(npcKey, name) {
        const had = state.carried[npcKey];
        return name === "psi" ? had?.psi === true : had?.items.some((def) => def.meta?.item === name) === true;
      },
      hasRoomFor(npcKey, kind) {
        const items = state.carried[npcKey]?.items ?? [];
        if (kind === "phaser") return items.every((def) => def.meta?.item !== "phaser");
        return items.filter((def) => def.meta?.item !== "phaser").length < inventoryConfig.maxCarried;
      },
      onCarriedChange(npcKey) {
        const had = state.carried[npcKey];
        if (had !== undefined && had.items.length === 0 && had.psi !== true) delete state.carried[npcKey];
        state.persistCarried();
        w.hud?.update();
      },
      async openDoorwaysWithNpcs() {
        await w.physics?.settle();
        for (const npcKey in w.n) {
          const gdKey = state.npcToDoors[npcKey]?.inside;
          if (gdKey === null || gdKey === undefined) continue;
          const door = w.d[gdKey];
          if (door === undefined || w.door.snapOpen(door) === false) continue;
          state.tryCloseDoor(gdKey);
        }
      },
      async onBootstrapMap() {
        const { player } = w;
        const saved = persisted.getWorldMapStore(w.key, w.mapKey).read().npcs;

        // NOT "is there a player to come from": removing them left the veil up on the next map
        const firstBootstrap = state.changingMap === false;
        state.changingMap = false;
        if (firstBootstrap) {
          player.assign(saved?.playerKey ?? defaultPlayerKey);
          // The arrival is shown whole: folded (or flat, on a phone), then the fade comes on, then
          // the world rises. Left to itself the fade would arrive the moment the player spawns —
          // which is before any of that, and would hide all of it but the one room they are in
          w.view.setFadeRoomsActive("ship");
          // ...but the NAMES do not join that: shown whole means every room's, and they would then
          // go out again as the fade lands, which reads as a fault rather than a reveal
          w.view.revealRoomLabels(0);
        }

        /**
         * Was the player provided in save data for this map?
         * - it won't be if we never visited the map before
         * - it won't be if we `remove {playerKey}` and refreshed
         */
        let playerWasSaved = false;

        try {
          // decor first: a restored npc's may be sitting on a chair (decorKey)
          state.restoreDecor();

          // - player first, else next restored npc becomes player
          // - the player should always be ensured but it might not have been saved before
          playerWasSaved = await player.ensure();
          await state.restoreNpcs(saved);
          await state.openDoorwaysWithNpcs();

          // ensure npcs drawn
          w.view.forceUpdate(0.01);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

          // with everything drawn once, the pick pass compiles now rather than on the first tap.
          // Awaited: no frame is drawn whilst it runs, and the pan below wants its frames
          await w.view.warmPick();
          if (firstBootstrap === true && playerWasSaved === false) {
            await player.panTo();
          }
        } finally {
          if (firstBootstrap === true) {
            // the first map is on screen as a flat hull: held a beat with the fade brought on,
            // then unfolded with a delayed floor fade-in
            await w.view.holdBeforeUnfold();
            const rising = w.foldTo(1);
            await pause(floorFadeDelayMs);
            void w.floor?.fadeTo(1);
            await rising;
            // the names come back once the fade the unfold started has settled — by then only the
            // rooms that stay are still shown, so only their labels appear. Not awaited: the
            // intro pan has nothing to do with it
            w.view.revealRoomLabels(1, roomLabel.revealMs, MODE_FADE_SECS * 1000);
          } else {
            // behind black since `fadeOut` — snap onto the player, so it lifts onto them
            await player.panTo({ animate: false });
            await w.view.veilCanvas(false, mapVeilMs);
          }
        }

        if (firstBootstrap === true && playerWasSaved === true) {
          // on load the view is the one we restored, and is left alone: taking the camera off
          // whatever we were looking at is a poor greeting. Instead it is offered — see WorldView
          w.view.showCentreHint();
        }
      },
      onChangeMap() {
        w.settledMapKey = null; // changing from here to "map-settled" — see `isMapChanging`
        state.changingMap = true;
        // whilst the outgoing map still exists
        state.persistNpcs();
        state.persistDecor();

        state.removeNpcs(...Object.keys(w.n));
        // runtime decor is per-map, like the npcs — the incoming map restores its own
        w.decor.remove(...Object.keys(w.decor.runtime.byKey));

        state.doorOpen = {};
        state.doorToNpcs = {};
        state.externalNpcs = new Set();
        state.npcToAccess = {};
        Object.assign(w.npc, { doableToNpc: {}, npcToDoable: {}, npcToRoom: new Map(), roomToNpcs: [] });
        state.npcToDoors = {};
        state.handLitRooms = new Set(); // a `grKey` means nothing to the map coming in
        state.litRooms = new Map(); // the map's own save carries these across, via `restoreNpcs`

        // anything still waiting on the worker asked about the old map's rooms
        state.rejectPendingUnreachable(new Error("map changed"));

        // arm "map-settled" ahead of the world query
        w.setNextPending({ assets: true });
      },
      onEditMap() {
        state.recomputeNpcRoomRelationships();
        state.syncLitRooms();
        // WorldView's own `gmsHash` effect syncs the fade, snapped
        state.rejectPendingUnreachable(new Error("map edited"));
      },
      reseatAllNpcs() {
        if (w.client === true) return; // mirrors have no agents

        for (const npc of Object.values(w.n)) {
          if (npc.agentId === null) continue;

          const at = npc.point;
          const onNav = w.npc.getClosestPoly(at, 0.5);
          // `at` overrides unless their floor went, when the nearest that remains takes them
          const result = onNav.success === true ? onNav : w.npc.getClosestPoly(at, 4);
          w.npc.placeNpcAt(npc, result, onNav.success === true || result.success === false ? at : undefined);

          if (result.success === false) {
            state.strandNpc(npc); // left agentless where they stood
          } else if (npc.isMoving() === true) {
            // re-aim under the promise `move` awaits, so the walk carries on
            const groundPoint = helper.parseGroundPoint(npc.last.dst);
            const dstResult = w.npc.getClosestPoly(groundPoint, 0.5);
            if (dstResult.success === true) {
              npc.anim.aimAt({ groundPoint, result: dstResult });
              npc.anim.startMoving(npc.anim.arrive);
            } else {
              npc.rejectAll(Error("map edited")); // `move` idles them and rethrows
            }
          }
        }
      },
      standUpStrandedDoers() {
        // navmesh and decor rebuild on separate queries, so whichever lands last does this
        if (w.client === true || w.npc === undefined || w.decor?.ready !== true || w.nav.navMesh === undefined) {
          return;
        }
        for (const npc of Object.values(w.n)) {
          const decorKey = w.npc.npcToDoable[npc.key];
          if (typeof decorKey !== "string" || w.decor.byKey[decorKey] !== undefined) {
            continue; // idle, or what they are doing is still there
          }
          const near = w.npc.getClosestPoly(npc.point, 4); // an edit took their decor
          if (near.success === false) state.strandNpc(npc);
          // faded, as any teleport; nothing waits on it, and a doer has no agent to go stale
          else void npc.fadeSpawn({ at: helper.parseGroundPoint(near.position) }).catch(warn);
        }
      },
      strandNpc(npc) {
        // nowhere to stand, and no "map-settled" follows an edit to put the player back
        if (npc.key !== w.player.key) return void state.removeNpcs(npc.key);
        void w.player.restoreFromSpawnPoint().then((ok) => ok || w.player.spawnSomewhere());
      },
      restoreAccess(saved) {
        for (const gdKey of saved.access ?? []) {
          if (gdKey in w.door.byKey) state.setAccess(saved.key, gdKey as Geomorph.GmDoorKey, true);
        }
      },
      setAccess(npcKey, gdKey, held) {
        (state.npcToAccess[npcKey] ??= {})[gdKey] = held;
        if (npcKey === w.player.key) w.hud?.update();
      },
      syncDoorsState() {
        for (const gdKey of Object.keys(state.doorOpen) as Geomorph.GmDoorKey[]) {
          if (w.d[gdKey] === undefined) delete state.doorOpen[gdKey];
        }
        for (const gdKey of Object.keys(state.doorToNpcs) as Geomorph.GmDoorKey[]) {
          if (w.d[gdKey] === undefined) delete state.doorToNpcs[gdKey];
        }
        for (const [npcKey, access] of Object.entries(state.npcToAccess)) {
          for (const gdKey of Object.keys(access) as Geomorph.GmDoorKey[]) {
            if (w.d[gdKey] === undefined) delete state.npcToAccess[npcKey][gdKey];
          }
        }
        for (const doors of Object.values(state.npcToDoors)) {
          if (doors.inside !== null && w.d[doors.inside] === undefined) doors.inside = null;
          for (const gdKey of doors.nearby) {
            if (w.d[gdKey] === undefined) doors.nearby.delete(gdKey);
          }
        }
      },
      onChangeTheme() {
        const { obstacles, doors, npcs, lights, post } = w.getTheme();
        w.obs.setBrightness(obstacles.brightness);
        w.door.setBrightness(doors.brightness);
        w.door.setOpacity(doors.opacity, doors.labelOpacity);
        w.door.setDissolve(doors.dissolve);
        w.npc?.setAmbient(npcs.ambient);
        w.npcBrightness = persisted.getWorldStore(w.key).read().npcBrightnessByTheme[w.themeKey] ?? npcs.brightness;
        w.npc?.setBrightness(w.npcBrightness);
        w.psi?.syncTune();
        w.phasers?.syncTheme();
        w.floor.setFadedTint(post.fadedFloorTint);
        w.obs.setFadedTint(post.fadedObstacleTint);
        w.view.postFx.lightBg.value.set(post.lightBg);
        w.view.postFx.darkBg.value.set(post.darkBg);
        w.view.fadeRoomsFx.shade.value.set(post.darkBg);
        w.view.playerLight.shade.value.set(lights.unlitTint);
        w.view.playerLight.unlitScale.value = lights.unlit;
        w.view.playerLight.coneAmount.value = lights.cone;
        // w.view.forceUpdate();
      },
      onEnterCollider(e, npc) {
        const door = w.door.byKey[e.meta.gdKey];
        if (!door) return; // onchange map

        if (e.type === "nearby" || e.type === "inside") {
          state.toggleDoor(e.meta.gdKey, {
            open: true,
            npcKey: e.npcKey,
            // avoid ignoring "inside" sensor when path does not intersect
            npcIntention: e.type === "nearby" ? (npc.getCornersPath() ?? undefined) : undefined,
          });
        }

        if (e.type === "inside") {
          const gmRoomId = w.npc.npcToRoom.get(npc.key) as Geomorph.GmRoomId;
          const nextGmRoomId = w.gmGraph.getOtherGmRoomId(door, gmRoomId.roomId);
          nextGmRoomId !== null && w.events.next({ key: "enter-doorway", npcKey: npc.key, gmRoomId, nextGmRoomId });
        }
      },
      onEvent(e) {
        if ("npcKey" in e) {
          state.onNpcEvent(e);
          state.dispatchToKeyedListeners(e);
          return;
        }

        switch (e.key) {
          case "decor-created":
          case "decor-removed":
            // whoever edits is saved — not whilst a map changes, which removes the outgoing map's
            // decor after saving it, and restores the incoming one's
            if (w.isMapChanging() === false) state.persistDecor();
            break;
          case "decor-ready":
            // an edit may have taken the decor somebody was using
            state.standUpStrandedDoers();
            break;
          case "door-open":
            state.doorOpen[e.gdKey] = true;
            state.syncFadeRooms();
            break;
          case "door-opening": {
            const door = w.d[e.gdKey]; // may be gone: onchange map, or a map edit
            // clients skip: the server sends both sides of a hull door
            if (door?.hull === true && w.client === false) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(door.gmId, door.doorId);
              adj !== null && w.e.toggleDoor(adj.adjGdKey, { open: true, access: true });
            }
            break;
          }
          case "door-closed":
            state.doorOpen[e.gdKey] = false;
            state.syncFadeRooms();
            break;
          case "door-closing": {
            const door = w.d[e.gdKey];
            if (door?.hull === true && w.client === false) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(door.gmId, door.doorId);
              adj !== null && w.e.toggleDoor(adj.adjGdKey, { open: false, access: true });
            }
            break;
          }
          case "removed-npcs": {
            for (const npcKey of e.npcKeys) {
              const gmRoomId = w.npc.npcToRoom.get(npcKey);
              if (gmRoomId !== undefined) {
                w.npc.npcToRoom.delete(npcKey);
                w.npc.roomToNpcs[gmRoomId.gmId]?.[gmRoomId.roomId]?.delete(npcKey);
              } else {
                state.externalNpcs.delete(npcKey);
              }
            }

            w.bubble.delete(...e.npcKeys);

            break;
          }
          case "requested-physics": {
            state.recomputeNpcRoomRelationships();
            break;
          }
          case "try-close-door": {
            // clients have no door policy — the server decides and its events mirror over
            if (w.client === false) state.tryCloseDoor(e.gdKey);
            break;
          }
          case "map-settled":
            if (w.client === true) w.net.onMapSettledAsClient();
            // a persisted parent world takes over the boot — see `maybeAutoReconnect`
            else if (w.net?.maybeAutoReconnect() !== true) void state.onBootstrapMap();
            break;
          case "door-unlocked":
            if (w.client === false) state.tryCloseDoor(e.gdKey);
            break;
          case "door-locked":
            break;
          case "net-changed":
          case "npcs-restored":
            break;
          case "disabled":
          case "enabled":
            w.npc?.warmCrowd();
            break;
          case "set-player":
            state.syncFadeRooms(); // the rooms in view are the player's
            if (e.playerKey !== null && state.hasItem(e.playerKey, "psi") === false) w.psi?.choose(null);
            break;
          case "nav-updated":
            // npcs outlived the swap, so any agent holds refs into the mesh that went. NOT keyed on
            // the crowd: one doing something (e.g. abed) has no agent, and still needs re-seating
            if (w.npc !== undefined && Object.keys(w.n).length > 0) {
              state.syncDoorsState();
              state.reseatAllNpcs();
              state.standUpStrandedDoers(); // no-op until the decor is rebuilt too
              state.recomputeNpcRoomRelationships(); // the displaced moved
              state.syncFadeRooms();
            }
            // the crowd is empty at this point, which is what makes it safe to walk a spare agent
            w.npc?.warmCrowd();
            break;
          case "picked": {
            if (e.meta.type === "floor") {
              w.rings?.showPickRing(e); // marked with a ring — see `NpcRings`
            }
            // a long press is how you get at an npc: they say "...", and the history opens on it, its
            // npcKey the handle onto everything else — see `WorldSpeech`. Clients skip: the pick is
            // forwarded, and the server's mirrored speech comes back instead
            if (
              e.longDown === true &&
              e.meta.type === "npc" &&
              typeof e.meta.npcKey === "string" &&
              w.client === false
            ) {
              w.speech.say(e.meta.npcKey, "...");
              w.speech.set({ panelOpen: true, panelTab: "speech" });
            }
            // debug: as the speech menu's "debug", but Enter closes it. Our own picks only, not a client's forwarded
            if (
              (e.rightDown === true || (w.touchDevice && e.longDown === true)) &&
              e.meta.type === "npc" &&
              typeof e.meta.npcKey === "string" &&
              e.srcWorld === w.key &&
              w.debug?.npcContextMenu === true
            ) {
              w.bubble.openDebug(e.meta.npcKey, { focus: true });
            }
            break;
          }
          case "spawned-many": {
            // `spawnMany` goes via `rawSpawn`, which does not fire `spawned` — so this is where its
            // npcs are put into the rooms they stand in, as that would have done
            for (const npcKey of e.npcKeys) {
              if (npcKey in w.n) state.tryPutNpcIntoRoom(w.n[npcKey]);
            }
            state.syncFadeRooms();
            break;
          }
          case "phasers":
            break;
          case "update-faded-rooms":
            if (w.view.roomOutline === true) w.view.roomOutlineFx.sync(w);
            break;
          default:
            throw new ExhaustiveError(e);
        }

        state.dispatchToKeyedListeners(e);
      },
      onExitCollider(e, npc) {
        const door = w.door.byKey[e.meta.gdKey];
        if (!door) {
          return; // onchange map
        }

        if (e.type === "inside") {
          state.tryCloseDoor(e.meta.gdKey);

          const gmRoomId = w.npc.npcToRoom.get(npc.key);
          const nextGmRoomId = w.findRoomContaining(npc.position, true);
          if (gmRoomId === undefined || nextGmRoomId === null) {
            return;
          }

          w.events.next({
            key: "enter-room",
            npcKey: npc.key,
            gmRoomId: nextGmRoomId,
            reEntered: nextGmRoomId.grKey === gmRoomId.grKey,
          });
        }

        if (e.type === "nearby") {
          state.tryCloseDoor(e.meta.gdKey);
        }
      },
      onNpcEvent(e) {
        const npc = w.npc.npc[e.npcKey];
        if (npc === undefined) {
          return; // removing an npc fires its exit colliders afterwards
        }
        switch (e.key) {
          case "enter-collider": {
            if (e.type === "nearby") {
              (state.doorToNpcs[e.meta.gdKey] ??= { inside: new Set(), nearby: new Set() }).nearby.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).nearby.add(e.meta.gdKey);
            }
            if (e.type === "inside") {
              (state.doorToNpcs[e.meta.gdKey] ??= { inside: new Set(), nearby: new Set() }).inside.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).inside = e.meta.gdKey;
              state.trackDoorway(npc.key, e.meta.gdKey);
            }

            state.onEnterCollider(e, npc);
            break;
          }
          case "enter-room": {
            if (e.reEntered === false) {
              // changed room
              const gmRoomId = w.npc.npcToRoom.get(npc.key);
              if (gmRoomId) {
                w.npc.roomToNpcs[gmRoomId.gmId]?.[gmRoomId.roomId]?.delete(npc.key);
              } else {
                state.externalNpcs.delete(npc.key);
              }
              w.npc.npcToRoom.set(npc.key, e.gmRoomId);
              if (w.npc.roomToNpcs[e.gmRoomId.gmId]) {
                (w.npc.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(npc.key);
              }
            }

            if (state.syncLitRoom(npc) === true) {
              state.syncFadeRooms();
            }

            break;
          }
          case "exit-collider": {
            if (e.type === "nearby") {
              state.doorToNpcs[e.meta.gdKey]?.nearby.delete(npc.key);
              state.npcToDoors[e.npcKey]?.nearby.delete(e.meta.gdKey);
            }
            if (e.type === "inside") {
              state.doorToNpcs[e.meta.gdKey]?.inside.delete(npc.key);
              if (state.npcToDoors[e.npcKey]) state.npcToDoors[e.npcKey].inside = null;
              if (state.insideDoorways.get(npc.key)?.gdKey === e.meta.gdKey) state.insideDoorways.delete(npc.key);
            }

            state.onExitCollider(e, npc);
            break;
          }
          case "spawned": {
            if (e.spawns === 1) {
              if (w.client === false) {
                const { x, y, z } = npc.position;
                w.physics.worker.postMessage({
                  type: "add-physics-npcs",
                  npcs: [{ npcKey: e.npcKey, position: { x, y, z } }],
                } satisfies WW.MsgToWorker);
              }
            } else {
              // respawn
              const prevGrId = w.npc.npcToRoom.get(npc.key);
              if (prevGrId !== undefined) {
                w.npc.roomToNpcs[prevGrId.gmId][prevGrId.roomId]?.delete(npc.key);
              }
              if (e.npcKey === w.player.key) w.view.onPlayerRespawn();
            }

            w.npc.npcToRoom.set(npc.key, { ...e.gmRoomId });
            (w.npc.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(e.npcKey);
            // a spawn is how an npc ARRIVES somewhere: `fadeSpawn` and teleports land here rather
            // than at `enter-room`, which only fires for one who walked there
            state.syncFadeRooms();

            break;
          }
          case "started-moving": {
            const nearbyGdKeys = state.npcToDoors[e.npcKey]?.nearby ?? emptySet;
            const npcIntention = nearbyGdKeys.size > 0 ? npc.getCornersPath() : null;
            for (const gdKey of nearbyGdKeys) {
              state.toggleDoor(gdKey, {
                open: true,
                npcKey: e.npcKey,
                npcIntention: npcIntention ?? undefined,
              });
            }
            break;
          }
          case "npc-pre-do":
            if (w.phasers?.isArmed(e.npcKey)) w.phasers.disarm(e.npcKey);
            break;
          case "npc-do":
            if (e.decorKey !== null && w.phasers?.isArmed(e.npcKey)) w.phasers.disarm(e.npcKey);
            break;
          case "enter-doorway":
            // a doorway belongs to two rooms, and a lit npc standing in one lights both
            if (state.syncLitRoom(npc, e.nextGmRoomId) === true) {
              state.syncFadeRooms();
            }
            break;
          case "speech":
          case "stopped-moving":
            break;
          default:
            throw new ExhaustiveError(e);
        }
      },
      persistCarried() {
        if (w.client === true) return;
        persisted.getWorldStore(w.key).patch({ carried: structuredClone(state.carried) });
      },
      persistDecor() {
        if (w.client === true) return; // mirrors must never clobber our own save
        persisted.getWorldMapStore(w.key, w.mapKey).patch({
          decor: Object.values(w.decor.runtime.defByKey).filter((def) => def.meta?.noPersist !== true),
        });
      },
      persistNpcs() {
        if (w.client === true) return; // mirrors must never clobber our own save
        persisted.getWorldMapStore(w.key, w.mapKey).patch({
          npcs: {
            playerKey: w.n[w.player.key] === undefined ? null : w.player.key,
            npcs: Object.values(w.n).map((npc) => ({
              key: npc.key,
              at: { x: npc.point.x, y: npc.point.y },
              angle: npc.rotation.y,
              skinKey: w.npc.getSkinKeyBySkinIndex(npc.skinIndex) ?? defaultSkinKey,
              decorKey: w.npc.npcToDoable[npc.key] ?? undefined,
              lit: npc.lit === true ? true : undefined,
              access: state.getHeldDoors(npc.key),
            })),
          },
        });
      },
      async reachFor(npc, clip, at, act, side) {
        // turned to it, unless it is at their own feet
        if (npc.distanceTo(at) > 0.05) await npc.look({ at }).catch(() => {});
        const { anim, key } = npc;
        // the free hand: not the one with a gun in it, nor one at their temple — else each in turn
        /** Sat or lain: no stepping up to it, so their right arm goes out to it */
        const seated = w.npc.npcToDoable[key] != null;
        if (seated) side ??= "right";
        side ??=
          w.phasers?.holds(key) === true
            ? "left"
            : anim.upperLeft.target === 1 || state.reachedRight.delete(key) === false
              ? (state.reachedRight.add(key), "right")
              : "left";
        /** Down to the floor for it, unless off it themselves */
        const crouch = (at.y3d ?? 0) < inventoryConfig.reach.raisedFrom && w.npc.npcToDoable[key] == null;
        const shown = `${crouch ? "crouch" : clip}${side === "left" ? "_left" : ""}` as const;
        /** What that hand was doing e.g. psi, which it goes back to */
        const u = anim.upperOf(side);
        const before = u.target === 1 ? u.key : null;
        if (crouch) anim.setPose(shown);
        anim.setUpper(shown, { side });
        const aim =
          seated && side === "right"
            ? {
                at: new THREE.Vector3(at.x, at.y3d ?? 0, at.y),
                from: reachFrom,
                weight: reachAimWeight,
                maxRad: Math.PI,
              }
            : null;
        if (aim !== null) anim.upper.aim = aim;
        // an aim is let go only now, so the arm goes from it straight to the reach
        if (side === "right") w.phasers?.disarm(key);
        const until = w.timer.getElapsedTime() + inventoryConfig[crouch ? "crouchSecs" : "reachSecs"];
        while (w.timer.getElapsedTime() < until) await w.npc.nextTick(); // held whilst paused
        if (w.n[key] === npc) act();
        w.view.forceUpdate();
        // back as they were, unless something else has moved them on
        if (anim.pose === shown) anim.setPose(anim.idleClip.name as AnimationClipKey);
        if (u.key === shown) anim.setUpper(before, { side });
        // let go with the arm, unless another pose takes it over at once
        if (before !== null && anim.upper.aim === aim) anim.upper.aim = null;
      },
      async raycast(origSrc, origDst) {
        let src = helper.parseGroundPoint(origSrc);
        const dst = helper.parseGroundPoint(origDst);

        // Both points must reside in a room or doorway
        const srcGrId = w.findRoomContaining(src, true);
        const dstGrId = w.findRoomContaining(dst, true);
        if (srcGrId === null) {
          throw Error(`${"raycast"}: src must be in a room/doorway ${JSON.stringify({ x: src.x, y: src.y })}`);
        } else if (dstGrId === null) {
          throw Error(`${"raycast"}: dst must be in a room/doorway ${JSON.stringify({ x: dst.x, y: dst.y })}`);
        }

        if (Math.abs(src.x - dst.x) < 0.01 && Math.abs(src.y - dst.y) < 0.01) {
          // avoid 'detect-collisions' throw on zero-length rays
          return { success: true, hit: null, gmDoorIds: [], rooms: [srcGrId.grKey], doors: [], hitDoor: null };
        }

        const [grIds, gdIds] = [[] as Geomorph.GmRoomId[], [] as Geomorph.GmDoorId[]];
        let gmId = srcGrId.gmId;
        let roomId = srcGrId.roomId;
        let hit: null | Geom.VectJson = null;
        let hitDoor: null | Geomorph.GmDoorKey = null;

        const raycastUid = shortUuid.generate();
        let maxAdjGeomorphs = 2; // 🔔 detect ray between at most 2 geomorphs

        while (maxAdjGeomorphs-- > 0) {
          grIds.push(helper.getGmRoomId(gmId, roomId));

          w.navWorker.worker.postMessage({
            type: "get-raycast",
            uid: raycastUid,
            src,
            dst,
            gmId,
          } satisfies WW.MsgToNavWorker);

          const result = await new Promise<WW.RaycastResultResponse>(
            (resolve, reject) => (state.pendingRaycast[raycastUid] = { resolve, reject }),
          );

          hit = result.hit;
          // check whether ray is blocked by a door panel (accounting for partial open)
          for (const gdId of result.gmDoorIds) {
            const door = w.d[gdId.gdKey];
            const blockResult = w.door.checkRayDoorBlock(src, dst, gdId.gdKey);
            if (blockResult.blocked) {
              // `null` if ray intersects door rect but not door seg (ends inside doorway)
              if (blockResult.hit !== null) hit = blockResult.hit;
              if (hit !== null) hitDoor = gdId.gdKey;
              break;
            }
            // ray passes through gap
            gdIds.push(gdId);
            const otherRoomId = door.connector.roomIds.find((x) => x !== roomId) ?? null;
            otherRoomId !== null && grIds.push(helper.getGmRoomId(gmId, otherRoomId));
          }

          const lastGdId = gdIds[gdIds.length - 1];

          if (
            hit !== null || // hit something
            lastGdId === undefined || // no doors touched
            w.d[lastGdId.gdKey].hull === false // last open door NOT a hull door
          ) {
            break;
          }

          // check open hull door intersect
          hit = w.door.computeRayDoorIntersect(src, dst, lastGdId.gdKey);
          const adjCtxt = w.gmGraph.getAdjacentRoomCtxt(gmId, lastGdId.doorId);

          if (
            hit === null || // dst in hull doorway (distinct gmId since hull doorways overlap)
            adjCtxt === null // should be unreachable: sealed hull door always closed
          ) {
            break;
          }

          // next, start from hull door intersection
          src = hit;
          hit = null;
          gmId = adjCtxt.adjGmId;
          roomId = adjCtxt.adjRoomId;
        }

        return {
          success: hit === null,
          hit: hit === null ? null : geomService.precision2d(hit, 2),
          hitDoor,
          doors: gdIds.map(({ gdKey }) => gdKey),
          rooms: grIds.map(({ grKey }) => grKey),
        };
      },
      rejectPendingUnreachable(err) {
        for (const uid of Object.keys(state.pendingUnreachable)) {
          state.pendingUnreachable[uid].reject(err);
          delete state.pendingUnreachable[uid];
        }
      },
      rejectPendingRaycast(err) {
        for (const uid of Object.keys(state.pendingRaycast)) {
          state.pendingRaycast[uid].reject(err);
          delete state.pendingRaycast[uid];
        }
      },
      async requestUnreachable(npc, srcIndex, dstIndex) {
        if (w.navWorker?.worker === undefined) {
          return null; // asked before the worker was up, e.g. a scripted move on bootstrap
        }

        // A flag per NODE, so the worker reads a door's state at the index it knows the door by.
        // Sent with the query rather than kept in step as doors lock and swing: they change far
        // more often than they are asked about, and this way there is nothing to go stale
        const nodes = w.gmRoomGraph.nodesArray;
        const locked = new Uint8Array(nodes.length);
        const open = new Uint8Array(nodes.length);
        for (const [index, node] of nodes.entries()) {
          if (node.type !== "door") continue;
          locked[index] = w.d[node.gdKey]?.locked === true ? 1 : 0;
          open[index] = w.d[node.gdKey]?.open === true ? 1 : 0;
        }

        const uid = shortUuid.generate();
        w.navWorker.worker.postMessage(
          {
            type: "request-unreachable",
            uid,
            srcIndex,
            dstIndex,
            // likewise: an npc holds few keys, read afresh each time
            accessDoorIndices: Object.entries(state.npcToAccess[npc.key] ?? {}).flatMap(([gdKey, granted]) =>
              granted === true ? (w.gmRoomGraph.getNode(gdKey as Geomorph.GmDoorKey)?.index ?? []) : [],
            ),
            locked,
            open,
          } satisfies WW.MsgToNavWorker,
          [locked.buffer, open.buffer],
        );

        let cancel = (_e: Error): void => {};
        try {
          const result = await new Promise<WW.UnreachableResult>((resolve, reject) => {
            state.pendingUnreachable[uid] = { resolve, reject };
            npc.reject.worker = cancel = reject;
          });
          return result.blocked;
        } finally {
          delete state.pendingUnreachable[uid];
          if (npc.reject.worker === cancel) {
            npc.reject.worker = () => {};
          }
        }
      },
      async restoreFromWorld(fromWorldKey) {
        // cloned, else both worlds would share the arrays we just adopted
        const saved = structuredClone(persisted.getWorldMapStore(fromWorldKey, w.mapKey).read());
        // ours from now on, so a reload keeps it
        persisted.getWorldMapStore(w.key, w.mapKey).patch(saved);

        w.door.applyLocks(saved.doorLocks ?? []);
        w.view.setPostProcessingEnabled(true);

        state.removeNpcs(...Object.keys(w.n));
        w.decor.remove(...Object.keys(w.decor.runtime.byKey));
        state.restoreDecor(saved.decor);
        w.player.assign(saved.npcs?.playerKey ?? w.player.key);
        // the player goes first, else a restored npc would be adopted as them
        await w.player.ensure();
        await state.restoreNpcs(saved.npcs);
        await state.openDoorwaysWithNpcs();
        w.view.forceUpdate();
      },
      async resetWorldState() {
        w.door.resetLocks(); // back to the map's own `meta.locked`
        w.view.setPostProcessingEnabled(true);

        state.removeNpcs(...Object.keys(w.n));
        w.decor.remove(...Object.keys(w.decor.runtime.byKey));
        persisted.getWorldMapStore(w.key, w.mapKey).patch({ npcs: null, decor: null });
        // nothing saved to restore now, so the player respawns near the camera
        await w.player.ensure();
        await state.openDoorwaysWithNpcs();
        state.persistNpcs();
        w.view.forceUpdate();
        void w.player.panTo(); // as on load
      },
      restoreDecor(saved = persisted.getWorldMapStore(w.key, w.mapKey).read().decor) {
        if (saved === null) {
          return;
        }
        for (const def of saved) {
          try {
            w.decor.create(def);
          } catch (e) {
            warn(`decor ${def.key}: could not restore`, e);
          }
        }
      },
      recomputeNpcRoomRelationships() {
        w.npc.roomToNpcs = w.gms.map(() => []);
        state.externalNpcs = new Set();
        // every npc: a map edit can drop a whole gmId, and one left out keeps a stale `grKey`
        for (const npc of Object.values(w.n)) {
          state.tryPutNpcIntoRoom(npc);
        }
      },
      removeNpcs(...npcKeys) {
        const npcs = npcKeys.flatMap((npcKey) => w.n[npcKey] ?? []);

        w.npc.removeAgents(npcs);

        for (const npc of npcs) {
          npc.anim.mixer.stopAllAction();
          npc.material.dispose();
          npc.geometry.dispose();
          delete w.npc.byPickId[npc.pickId];
          delete w.n[npc.key];
          w.npc.setNpcDo(npc.key, null);
          state.litRooms.delete(npc.key);
          state.insideDoorways.delete(npc.key); // their exit colliders come too late
          npc.rejectAll(new Error("removed npc"));
        }

        w.shadows?.onTick();
        w.rings?.onTick();
        w.psi?.onTick();
        w.npc.update();
        // `update` only SCHEDULES the React commit that unmounts the mesh, and a PAUSED world
        // draws on demand — so nothing would draw the world without them, and it goes on showing
        // the npc in its bind pose (the mixer having been stopped). Ask once the commit is in, and
        // again after: one demand frame is not enough here, as spawning found too — see the two
        // `requestAnimationFrame`s in `restoreNpcs`
        requestAnimationFrame(() => {
          w.view.forceUpdate();
          requestAnimationFrame(() => w.view.forceUpdate());
        });
        w.events.next({ key: "removed-npcs", npcKeys });
        if (npcKeys.includes(w.player.key)) w.events.next({ key: "set-player", playerKey: null });
      },
      async restoreNpcs(saved = persisted.getWorldMapStore(w.key, w.mapKey).read().npcs) {
        for (const { key, at, angle, skinKey, decorKey, lit, access } of saved?.npcs ?? []) {
          if (key === w.player.key || w.n[key] !== undefined) {
            continue;
          }
          try {
            // the decor meta re-establishes what they were doing e.g. sitting
            await w.npc.spawn({
              npcKey: key,
              at: { ...at, meta: decorKey ? w.decor.byKey[decorKey]?.meta : undefined },
              angle,
              as: skinKey,
            });
            const spawned = w.npc.npc[key];
            if (lit === true && spawned !== undefined) state.setNpcLit(spawned, true);
            state.restoreAccess({ key, access });
          } catch (e) {
            warn(`${key}: could not restore`, e); // e.g. no longer placable
          }
        }
        w.events.next({ key: "npcs-restored" });
      },
      setNpcLit(npc, next = npc.lit === false) {
        if (npc.key === w.player.key) {
          return;
        }
        npc.npcLit.value = next === true ? 1 : 0;
        if (state.syncLitRoom(npc) === true) {
          state.syncFadeRooms();
        }
      },
      setRoomLit(input, next) {
        const { grKey, gmId, roomId } = typeof input === "string" ? helper.getGmRoomId(input) : input;
        if (w.gms[gmId]?.rooms[roomId] === undefined) {
          warn(`${grKey}: setRoomLit: no such room`); // e.g. onchange map, or a malformed key
          return;
        }
        // syncing where nothing changed costs nothing: every morph is already headed where it goes
        if (next ?? state.handLitRooms.has(grKey) === false) state.handLitRooms.add(grKey);
        else state.handLitRooms.delete(grKey);
        state.syncFadeRooms();
      },
      async spawnMany(opts) {
        const baseKey = opts.baseKey ?? "npc";
        const numPermitted = MAX_NPCS - (w.npc.npcToRoom.size + state.externalNpcs.size);
        const groundPoints = opts.ats.slice(0, numPermitted).map(helper.parseGroundPoint);
        const npcKeys = groundPoints.map((_, i) => opts.keys?.[i] ?? `${baseKey}-${i}`);

        /** Ground point should either be doable or navigable */
        const doResults = groundPoints.map((p, i) => w.npc.findFreeDoMeta(p.meta ?? emptyMeta, npcKeys[i]));

        const angles = doResults.map((doResult, i) => {
          const angleOrPoint = opts.looks?.[i];
          return w.npc.determineSpawnedAngle({
            groundPoint: groundPoints[i],
            meta: doResult?.meta ?? emptyMeta,
            angle: typeof angleOrPoint === "number" ? angleOrPoint : undefined,
            facing: helper.isPointAnyFormat(angleOrPoint) ? angleOrPoint : undefined,
            npc: w.n[npcKeys[i]],
          });
        });

        // 1st spawn only, no respawning
        const npcs: Npc[] = [];
        for (const [i, npcKey] of npcKeys.entries()) {
          const doResult = doResults[i];
          const groundPoint = doResult?.meta.groundPoint ?? groundPoints[i];
          npcs.push(
            w.npc.rawSpawn({
              npcKey,
              groundPoint,
              doResult,
              as: opts.skins?.[i] ?? defaultSkinKey,
              angle: angles[i],
            }),
          );
        }

        w.shadows?.onTick(); // ensure shadow visible even when paused
        w.rings?.onTick();
        w.psi?.onTick();
        w.view.forceUpdate();

        await Promise.all(
          npcs.map(
            (npc) =>
              npc.spawns++ === 0 &&
              new Promise((resolve, reject) => ((npc.resolve.spawn = resolve), (npc.reject.spawn = reject))),
          ),
        );

        w.events.next({ key: "spawned-many", npcKeys });
      },
      syncFadeRooms() {
        w.view.fadeRoomsFx.sync(w);
        state.syncNpcRoomSlots();
        w.view.forceUpdate();
        w.events.next({ key: "update-faded-rooms" });
      },
      syncLitRoom(npc, alsoAt) {
        if (npc.key === w.player.key) {
          return true; // player must sync
        }
        // a psi target's rooms are shown too — see `fadeRoomsFx.sync`
        const psiTarget = npc.key === w.psi?.getTarget();
        if (psiTarget === true) w.psi.targetRoom = { at: w.npc.npcToRoom.get(npc.key) ?? null, also: alsoAt ?? null };
        const at = npc.lit === true ? w.npc.npcToRoom.get(npc.key) : undefined;
        if (at === undefined) {
          return state.litRooms.delete(npc.key) || psiTarget;
        }
        state.litRooms.set(npc.key, alsoAt === undefined ? [at] : [at, alsoAt]);
        return true;
      },
      syncLitRooms() {
        for (const npc of Object.values(w.n)) state.syncLitRoom(npc);
        for (const grKey of state.handLitRooms) {
          const { gmId, roomId } = helper.getGmRoomId(grKey);
          if (w.gms[gmId]?.rooms[roomId] === undefined) state.handLitRooms.delete(grKey);
        }
      },
      postNpcTick() {
        state.syncDoorways();
        // before the shadows, which read the slot it settles — and every tick, since an npc waiting
        // on a room to arrive takes it the moment it lands rather than at the next door event
        state.syncNpcRoomSlots();
        w.shadows?.onTick();
        w.rings?.onTick();
        w.psi?.onTick();
        w.phasers?.onTick();
        w.player?.aimAtPointer();
      },
      syncDoorways() {
        for (const [npcKey, { normal, offset, rooms }] of state.insideDoorways) {
          const npc = w.n[npcKey];
          if (npc === undefined) continue;
          const gmRoomId = rooms[normal.x * npc.point.x + normal.y * npc.point.y > offset ? 0 : 1];
          if (gmRoomId !== null && gmRoomId.grKey !== w.npc.npcToRoom.get(npcKey)?.grKey) {
            w.events.next({ key: "enter-room", npcKey, gmRoomId, reEntered: false });
          }
        }
      },
      syncNpcRoomSlots() {
        const fx = w.view.fadeRoomsFx;
        // Every npc, not just the player: an npc MOVES between rooms, so where they stand is a
        // uniform of their own rather than an attribute fixed when the map loaded
        for (const npc of Object.values(w.n)) {
          const at = w.npc.npcToRoom.get(npc.key);
          const next = at === undefined ? alwaysShownSlot : slotOf(at.gmId, at.roomId);
          if (next === npc.roomSlot.value) continue;
          // Somebody walking INTO a room that is still arriving keeps the room they came from,
          // which is all there — else they would dim on the threshold, waiting on a room they are
          // already standing in. They take the new one the moment it lands, which is why this runs
          // on the tick as well as on the events that move people between rooms
          if (fx.isArriving(next) === true && fx.hasArrived(npc.roomSlot.value) === true) continue;
          npc.roomSlot.value = next;
        }
      },
      async testTargetUnreachable(npc, dstGrId = npc.last.dstGrId) {
        const grId = w.npc.npcToRoom.get(npc.key) ?? null;

        if (grId === null || dstGrId === null || grId.grKey === dstGrId.grKey) {
          return null; // invalid or same room
        }

        const srcNode = w.gmRoomGraph.getNode(grId.grKey);
        const dstNode = w.gmRoomGraph.getNode(dstGrId.grKey);
        if (srcNode === null || dstNode === null) {
          return null;
        }

        // the graph work itself runs in the worker — see `worker/room-graph.ts`
        const blocked = await state.requestUnreachable(npc, srcNode.index, dstNode.index);
        if (blocked === null) {
          return null;
        }

        const doorNode = w.gmRoomGraph.nodesArray[blocked.doorIndex] as Graph.GmRoomGraphNodeDoor;
        const roomNode = w.gmRoomGraph.nodesArray[blocked.roomIndex] as Graph.GmRoomGraphNodeRoom;
        const door = w.d[doorNode.gdKey];
        const indexOfRoomId = door.connector.roomIds.indexOf(roomNode.roomId);

        if (indexOfRoomId === -1) {
          return { blockingGdKey: door.gdKey, nearbyPoint: doorNode.astar.centroid.clone() };
        }

        return {
          blockingGdKey: door.gdKey,
          nearbyPoint: doorNode.astar.centroid
            .clone()
            .addScaled(door.normal, shutDoorKeepOut * (indexOfRoomId === 0 ? 1 : -1)),
        };
      },
      toggleDoor(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];
        if (!door) {
          warn(`${gdKey}: toggleDoor: no such door`); // e.g. onchange map, or a stale pick
          return false;
        }

        // clear if closed or no npc "inside" collider
        opts.clear ??= door.open === false || !(state.doorToNpcs[gdKey]?.inside.size > 0);

        // patched navcat to use 4 corners to ensure path intersects door
        // 🚧 maybe unnecessary now we use `door.innerSegs`
        const path = opts.npcIntention ?? [];

        const willIntersect = w.door.doesPathIntersectDoor(path, door);
        // console.log({ willIntersect, path });

        opts.access ??=
          opts.npcKey === undefined ||
          // non-auto should not open unless npc has access & will intersect
          (door.locked === false && !(door.auto === false && door.open === false)) ||
          (state.npcCanAccess(opts.npcKey, gdKey) && (path.length === 0 || willIntersect === true));

        return w.door.toggleDoor(door, opts);
      },
      takeItem(npcKey, decorKey) {
        const def = w.decor.runtime.defByKey[decorKey];
        const kind = def?.meta?.item as ItemKind;
        const npc = w.n?.[npcKey];
        if (def === undefined || npc === undefined || inventoryConfig.kinds.includes(kind) === false) return false;
        if (def.type !== "quad" && def.type !== "point") return false;
        if (state.hasRoomFor(npcKey, kind) === false) return false;
        const { bounds, meta } = w.decor.runtime.byKey[decorKey];
        const room = w.npc.npcToRoom.get(npcKey);
        if (room?.gmId !== meta.gmId || room?.roomId !== meta.roomId) return false; // not through a wall
        const at = { ...bounds.center, y3d: Number(def.y3d) || 0 };
        state.handle(npcKey, () =>
          state.reachFor(npc, "pick_up", at, () => {
            // still there, and still room for it
            if (w.decor.runtime.defByKey[decorKey] !== def || state.hasRoomFor(npcKey, kind) === false) return;
            (state.carried[npcKey] ??= { items: [] }).items.push(structuredClone(def));
            w.decor.remove(decorKey);
            state.onCarriedChange(npcKey);
          }),
        );
        return true;
      },
      trackDoorway(npcKey, gdKey) {
        const door = w.door.byKey[gdKey];
        if (door === undefined) return; // onchange map
        const { src, normal, gmId, connector } = door;
        /** Its normal points into the first: a hull door's other side is the next geomorph's */
        const rooms = connector.roomIds.map((roomId, i) =>
          roomId === null
            ? w.gmGraph.getOtherGmRoomId(door, connector.roomIds[1 - i] ?? -1)
            : helper.getGmRoomId(gmId, roomId),
        );
        state.insideDoorways.set(npcKey, { gdKey, normal, offset: normal.x * src.x + normal.y * src.y, rooms });
      },
      unchainKey(npcKey, gdKey) {
        if (state.npcToAccess[npcKey]?.[gdKey] !== true || state.hasRoomFor(npcKey, "keycard") === false) return false;
        state.setAccess(npcKey, gdKey, false);
        return state.giveItem(npcKey, "keycard", { door: gdKey, map: w.mapKey });
      },
      toggleLock(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];

        if (opts.point === undefined || opts.npcKey === undefined) {
          // e.g. game master i.e. no npc
          return w.door.toggleLock(door, opts);
        }

        const { position: npcPoint } = w.npc.npc[opts.npcKey];
        if (npcPoint.distanceTo(helper.groundPointToVector3(helper.parseGroundPoint(opts.point))) > 1.5) {
          return false; // e.g. button not close enough
        }

        opts.access ??= state.npcCanAccess(opts.npcKey, gdKey);

        return w.door.toggleLock(door, opts);
      },
      tryCloseDoor(gdKey) {
        const door = w.door.byKey[gdKey];
        if (!door) return; // onchange map

        w.door.cancelClose(door);
        door.closeTimeoutId = window.setTimeout(() => {
          if (w.disabled === true) {
            // don't close whilst paused (recheck in {ms})
            state.tryCloseDoor(gdKey);
          } else if (door.open === true) {
            state.toggleDoor(gdKey, { clear: state.canAutoCloseDoor(door), close: true });
          } else {
            // closed
            delete door.closeTimeoutId;
          }
        }, defaultDoorCloseMs);
      },
      tryPutNpcIntoRoom(npc) {
        const grId = w.findRoomContaining(npc.position, true);
        if (grId !== null) {
          w.npc.npcToRoom.set(npc.key, grId);
          state.externalNpcs.delete(npc.key);
          (w.npc.roomToNpcs[grId.gmId][grId.roomId] ??= new Set()).add(npc.key);
        } else {
          // Erase stale info and warn
          w.npc.npcToRoom.delete(npc.key);
          state.externalNpcs.add(npc.key);
          warn(`${npc.key}: no longer inside any room`);
        }
      },
    }),
  );

  w.e = state;

  useEffect(() => {
    // 🔔 internal because it can synchronously invoke `w.events.next`
    const sub = w.events.subscribe({ next: state.onEvent }, { internal: true });
    return () => void sub.unsubscribe();
  }, []);
}

/** Half a quad's or point's width and height in metres, as its image has them: nought for anything else */
function halfSizeOf(sheets: WorldState["sheets"], def: Geomorph.DecorDef) {
  const entry = def.type === "quad" || def.type === "point" ? sheets.decor[def.img ?? ""] : undefined;
  const scale = (sguToWorldScale / 2) * (def.type === "point" ? (def.scale ?? 1) : 1);
  return [entry?.originalWidth ?? 0, entry?.originalHeight ?? 0].map((x) => x * scale);
}

/** Where an item is put down: its middle, how high what it stands on is, and how a quad is turned */
type DropSpot = Geom.VectJson & { y3d: number; linear?: [number, number, number, number] };

export type State = {
  /** A carried keycard's `meta.door` joins their keys, and the card is gone — only on the map it is of */
  chainKey(npcKey: string, itemKey: string): boolean;
  /** A door's key comes off their keys as a keycard they carry — `false` if they have no room */
  unchainKey(npcKey: string, gdKey: Geomorph.GmDoorKey): boolean;
  /** By npcKey, what each has — persisted per World, so it goes with them between maps. See `docs/inventory.md` */
  carried: Record<string, persisted.Carried>;
  /** Starts putting an item of theirs (by its key, or the first of a kind) down, a drawn phaser put away first — or revokes `psi`. `false` with no surface in reach that it fits, bar a point which may lie at their feet */
  dropItem(npcKey: string, name: string): boolean;
  /** The doors they hold keys to, if any */
  getHeldDoors(npcKey: string): undefined | Geomorph.GmDoorKey[];
  /** Those putting something down or picking something up right now */
  handling: Set<string>;
  /** Where they could put that item down: on a `meta.surface` obstacle in reach, in their room, all of it fitting and squared up to the edge */
  getDropSpot(npcKey: string, def: Geomorph.DecorDef): null | DropSpot;
  /** A carried def as it would stand at the spot, under a key no decor has */
  getItemDefAt(def: Geomorph.DecorDef, at: DropSpot): Geomorph.DecorDef;
  /** Runs it unless they are `handling` something already */
  handle(npcKey: string, run: () => Promise<void>): void;
  /** They turn to the point and reach out as `clip` has it, with their free hand unless told which — then `act`, as it gets there */
  reachFor(
    npc: Npc,
    clip: "drop" | "pick_up",
    at: Geom.VectJson & { y3d?: number },
    act: () => void,
    side?: "left" | "right",
  ): Promise<void>;
  /** Those who last reached with their right, so with neither hand busy they take turns */
  reachedRight: Set<string>;
  /** Grants `psi`, or makes them an item out of nothing — `false` if they have no room */
  giveItem(npcKey: string, name: "psi" | ItemKind, extraMeta?: Meta): boolean;
  hasItem(npcKey: string, name: "psi" | ItemKind): boolean;
  /** One phaser, and `inventoryConfig.maxCarried` of the rest */
  hasRoomFor(npcKey: string, kind: ItemKind): boolean;
  onCarriedChange(npcKey: string): void;
  persistCarried(): void;
  /** The keys a save says they held, bar doors since gone */
  restoreAccess(saved: Pick<persisted.PersistedNpc, "key" | "access">): void;
  /** Gives or takes a door's key — the one way to write `npcToAccess`, so the bar hears */
  setAccess(npcKey: string, gdKey: Geomorph.GmDoorKey, held: boolean): void;
  /** Starts taking a runtime decor with `meta.item` off the map — `false` if it is no item, in another room, or they have no room */
  takeItem(npcKey: string, decorKey: string): boolean;
  /** Set by `onChangeMap`, consumed by `onBootstrapMap`: this map is not the page's first */
  changingMap: boolean;
  /** Doable to the npc using it or null */
  doorOpen: { [gmDoorKey: Geomorph.GmDoorKey]: boolean | undefined };
  doorToNpcs: { [gmDoorKey: Geomorph.GmDoorKey]: { nearby: Set<string>; inside: Set<string> } };
  externalNpcs: Set<string>;
  npcToAccess: { [npcKey: string]: { [gdKey: string]: boolean } };
  npcToDoors: { [npcKey: string]: { inside: null | Geomorph.GmDoorKey; nearby: Set<Geomorph.GmDoorKey> } };
  /**
   * Rooms lit BY HAND, shown whatever the player can see — see `setRoomLit`. Distinct from
   * `litRooms`, which is what lit NPCS light, and not gated on `litNpcsEnabled`. Emptied on a map
   * change, a `grKey` meaning nothing to the map coming in
   */
  handLitRooms: Set<Geomorph.GmRoomKey>;
  keyedListener: Map<string, (event: JshCli.Event, world: JshCli.WorldState) => void>;
  /**
   * Which rooms each LIT npc lights, by npc key — what `service/fade-rooms` shows on their account.
   * One room, or TWO whilst they stand in a doorway. By npc rather than by room, so one moving or
   * going out is an entry rewritten or dropped
   */
  litRooms: Map<string, Geomorph.GmRoomId[]>;
  /**
   * Lights a room by hand, or puts it out; toggles when `next` is omitted. Takes a `grKey` or a
   * `GmRoomId`, and warns rather than throwing where there is no such room
   */
  setRoomLit(input: Geomorph.GmRoomKey | Geomorph.GmRoomId, next?: boolean): void;
  /** Puts out every room lit by hand, leaving what the player can see and the lit npcs */
  clearHandLitRooms(): void;
  dispatchToKeyedListeners(e: JshCli.Event): void;
  /** Lights `npc` or puts them out. Toggles when `next` is omitted */
  setNpcLit(npc: Npc, next?: boolean): void;
  /**
   * Puts `npc` into `litRooms`, or takes them out of it — see `setNpcLit`.
   *
   * Returns `true` iff the rooms shown may have changed: the player, a psi target, or a lit npc set or deleted.
   * @param alsoAt the far side of the doorway they stand in, if they stand in one
   */
  syncLitRoom(npc: Npc, alsoAt?: Geomorph.GmRoomId): boolean;
  /** Re-derives `litRooms` off every npc, and drops `handLitRooms` the map no longer has */
  syncLitRooms(): void;
  pendingRaycast: { [uid: string]: { resolve(result: WW.RaycastResultResponse): void; reject(err: Error): void } };
  pendingUnreachable: {
    [uid: string]: { resolve(result: WW.UnreachableResult): void; reject(err: Error): void };
  };

  /**
   * Example usage:
   * ```tsx
   * const handled = api.handleStatus({
   *   cleanup: w.e.addFrameCallback(() => { ... }),
   * });
   * ```
   */
  addFrameCallback(cb: () => void): () => void;
  /**
   * Can use `key` to avoid duplication
   */
  addKeyedListener(key: string, listener: (event: JshCli.Event, w: JshCli.WorldState) => void): void;
  canAutoCloseDoor(door: Geomorph.DoorState): boolean;
  /** `findPath`, spread over as many turns of the event loop as it takes — see `AStar.searchAsync` */
  findPathAsync(
    srcGrKey: Geomorph.GmRoomKey,
    dstGrKey: Geomorph.GmRoomKey,
    opts?: {
      setNodeWeights?(nodes: Graph.GmRoomGraphNode[]): void;
    },
  ): Promise<AStarSearchResult<Graph.GmRoomGraphNode>>;
  /**
   * Asks the worker whether this npc can get from one room node to another, and which shut door
   * would stop them if not — see `worker/room-graph.ts`. Resolves `null` for "they can get there".
   * REJECTS when the question is abandoned — `npc.rejectAll`, a map change, or a worker reload —
   * so the caller abandons the move rather than setting off on an answer nobody waited for
   */
  requestUnreachable(npc: Npc, srcIndex: number, dstIndex: number): Promise<WW.UnreachableResult["blocked"]>;
  /** Fails everything waiting on `requestUnreachable`, e.g. because the map is going */
  rejectPendingUnreachable(err: Error): void;
  /** ...and on `raycast`, e.g. because the nav worker is going */
  rejectPendingRaycast(err: Error): void;
  getPoint(npcKey: string): Meta<JshCli.GroundPoint>;
  move(opts: JshCli.MoveOpts): Promise<void>;
  /**
   * @param planning asks whether they COULD pass it, rather than whether they could pass it from
   * where they stand — a locked door standing open counts, since walking up to it is what grants
   * them the crossing. For reachability and the like; leave it off to ask about this moment
   */
  npcCanAccess(npcKey: string, gdKey: Geomorph.GmDoorKey, planning?: boolean): boolean;
  /** Restore this map's npcs, place the player, then maybe run the intro */
  onBootstrapMap(): Promise<void>;
  /** Persist and remove every npc, whilst the outgoing map still exists */
  onChangeMap(): void;
  /**
   * The same map, rebuilt under the npcs standing on it. Run from the world query, so it lands
   * ahead of anything keyed on `w.gmsHash`. The crowd waits on the navmesh — see `"nav-updated"`
   */
  onEditMap(): void;
  /** Drop door-keyed state whose `gdKey` no door answers to */
  syncDoorsState(): void;
  /**
   * Re-adds every agent against the current navmesh, keeping npcs where they stand. A stale
   * corridor's refs still look valid whilst naming other polys, so only re-adding cures it
   */
  reseatAllNpcs(): void;
  /** Stands up anyone whose doable decor an edit removed, onto the nearest navmesh */
  standUpStrandedDoers(): void;
  /** Respawn the player, or drop anyone else, when an edit leaves them nowhere to stand */
  strandNpc(npc: Npc): void;
  /** Persist the runtime decor defs for `w.mapKey`, so `restoreDecor` can bring them back */
  persistDecor(): void;
  /** Persist every npc for `w.mapKey`, so `restoreNpcs` can bring them back */
  persistNpcs(): void;
  /** Recreate the runtime decor persisted for `w.mapKey` */
  restoreDecor(saved?: null | Geomorph.DecorDef[]): void;
  /** Adopt another world's npcs, lit rooms and locked doors for `w.mapKey`, and apply them */
  restoreFromWorld(fromWorldKey: string): Promise<void>;
  /** Forget this map's saved state, leaving only the player, spawned near the camera */
  resetWorldState(): Promise<void>;
  /** Respawn the npcs persisted for `w.mapKey`, excluding the player */
  restoreNpcs(saved?: null | persisted.PersistedNpcs): Promise<void>;
  onChangeTheme(): void;
  onEvent(e: JshCli.Event): void;
  onEnterCollider(e: JshCli.EnterColliderEvent, npc: Npc): void;
  onExitCollider(e: JshCli.ExitColliderEvent, npc: Npc): void;
  onNpcEvent(e: Extract<JshCli.Event, { npcKey: string }>): void;
  recomputeNpcRoomRelationships(): void;
  raycast(src: MaybeMeta<JshCli.PointAnyFormat>, dst: MaybeMeta<JshCli.PointAnyFormat>): Promise<JshCli.RaycastResult>;
  removeNpcs(...npcKeys: string[]): void;
  spawnMany(opts: JshCli.SpawnManyOpts): Promise<void>;
  /**
   * - When an npc is moving its destination should be inside a room.
   * - When the npc is in a room adjacent to the destination room,
   *   and the room is inaccessible (e.g. locked doors) we want to avoid
   *   the crowd system redirecting the npc to the "other side of the wall".
   */
  /**
   * Defaults to the npc's current destination. Rejects if the question is abandoned — see
   * `requestUnreachable`, whose rejection it passes on unchanged
   */
  testTargetUnreachable(npc: Npc, dstGrId?: null | Geomorph.GmRoomId): Promise<null | JshCli.NpcUnreachableResult>;
  toggleDoor(
    gdKey: Geomorph.GmDoorKey,
    opts?: {
      npcKey?: string;
      /**
       * Given `npcIntention` then locked/manual accessible doors will only
       * be opened if npc's intended path intersects the door.
       *
       * Intuitively the NPC flashed their authentication to enter.
       */
      npcIntention?: JshCli.GroundPoint[];
    } & Geomorph.ToggleDoorOpts,
  ): boolean;
  toggleLock(
    gdKey: Geomorph.GmDoorKey,
    opts: { npcKey?: string; point?: JshCli.PointAnyFormat } & Geomorph.ToggleLockOpts,
  ): boolean;
  /**
   * Snaps open every door an npc is standing in, so none is drawn closed through them — a door
   * starts closed, whereas an npc's saved position can be in a doorway they stopped in
   */
  openDoorwaysWithNpcs(): Promise<void>;
  /** Re-reads which rooms the world is shown in — a door swinging, or the player moving room */
  syncFadeRooms(): void;
  /** By npcKey, the door whose "inside" sensor they are in: its line, and the room to each side — first where `normal` points */
  insideDoorways: Map<
    string,
    { gdKey: Geomorph.GmDoorKey; normal: Geom.VectJson; offset: number; rooms: (null | Geomorph.GmRoomId)[] }
  >;
  /** Notes the door an npc has stepped into, for `syncDoorways` */
  trackDoorway(npcKey: string, gdKey: Geomorph.GmDoorKey): void;
  /** Whilst in a doorway, their room is whichever is on their side of the door's line */
  syncDoorways(): void;
  /** What follows `w.npc.onTick`: room slots, then whatever draws on the npcs */
  postNpcTick(): void;
  /** Puts every npc in the room they stand in, unless it has yet to arrive — see within */
  syncNpcRoomSlots(): void;
  tryCloseDoor(gdKey: Geomorph.GmDoorKey): void;
  tryPutNpcIntoRoom(npc: Npc): void;
};

const emptySet = new Set<Geomorph.GmDoorKey>();

/**
 * How far CLEAR of a door an npc it cannot pass is kept: their own radius, and a margin on top.
 * Their body would otherwise stand through the panel, and reach far enough to trip its inside sensor
 */

const emptyMeta = {};
/** Their hand, down the forearm that an aimed reach lines up on its target — model units */
const reachFrom = new THREE.Vector3(0, -0.3, 0);
/** How far of the way an aimed reach swings: short of all of it, else the arm lies flat back */
const reachAimWeight = 0.75;
const shutDoorKeepOut = npcDims.agentRadius + npcDims.shutDoorKeepOut;

/** Is `to` close behind `npc`, where stepping back beats turning round? */
function isBackStep(npc: Npc, to: Geom.VectJson, config: import("./NPCs").State["config"]) {
  const [dx, dz] = [to.x - npc.position.x, to.y - npc.position.z];
  const dist = Math.hypot(dx, dz);
  const ahead = -dx * Math.sin(npc.rotation.y) - dz * Math.cos(npc.rotation.y);
  return dist < config.dist.backStep && ahead < dist * Math.cos(config.angle.backStep);
}
