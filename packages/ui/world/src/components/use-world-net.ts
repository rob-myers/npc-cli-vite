import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { defaultSkinKey, floorFadeDelayMs, introPanDelayMs, mapVeilMs, unfoldDelayMs } from "../const";
import {
  decodeTransforms,
  encodeTransforms,
  maxTransformsPerMessage,
  type NetNpc,
  type NetTransform,
  type WorldNetMessage,
  worldNetProtocol,
} from "../service/net-protocol";
import {
  DevWsSignaling,
  InMemorySignaling,
  isSamePage,
  type RemoteWorld,
  type SignalMsg,
  uidOf,
} from "../service/net-signaling";
import { queryClientApi } from "../service/query-client";
import { getWorldMapStore, getWorldStore } from "../service/storage";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

/**
 * `w.net` — one World mirrored into another over WebRTC DataChannels.
 *
 * A world becomes a **server** lazily, when its first client says hello; it becomes a **client**
 * via `join`. A client adopts the server's map, mirrors its npcs (agent-less — see the
 * `w.client` gates in `NPCs`/`use-world-events`), doors and runtime decor, and forwards its
 * picks. Two channels per peer: "events" (reliable, JSON `WorldNetMessage`) and "transforms"
 * (unreliable, binary — see `net-protocol`).
 */
export default function useWorldNet(w: UseStateRef<WorldState>) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      mode: "idle",
      phase: "idle",
      signalingMem: null,
      signalingWs: null,

      clients: new Map(),
      netIds: { fromKey: new Map(), toKey: new Map(), next: 1 },
      lastSent: new Map(),
      sampleTimer: 0,
      eventsUnsub: null,

      server: null,
      adoptedMapKey: null,
      mirrors: new Map(),
      fading: new Map(),
      reconnect: null,
      reconnectAttempted: false,
      teardownTimer: 0,

      isClient() {
        return state.mode === "client";
      },
      setPhase(mode, phase) {
        state.mode = mode;
        state.phase = phase;
        w.client = mode === "client"; // the boolean the gates read — see `World.State`
        state.signalingWs?.announce({ worldKey: w.key, mapKey: w.mapKey, mode });
        w.events.next({ key: "net-changed", mode, phase });
      },
      sendSignal(toUid, msg) {
        const signaling = isSamePage(toUid) ? state.signalingMem : state.signalingWs;
        signaling?.send(toUid, msg);
      },
      pageUid() {
        return uidOf(w.key);
      },
      onSignal(fromUid, msg) {
        switch (msg.kind) {
          case "join-request":
            state.acceptJoin(fromUid);
            break;
          case "offer":
            void state.onOffer(fromUid, msg.sdp);
            break;
          case "answer":
            void state.onAnswer(fromUid, msg.sdp);
            break;
          case "ice":
            void state.onIce(fromUid, msg.candidate);
            break;
          case "bye":
            state.onBye(fromUid);
            break;
        }
      },

      // ─── server side ───────────────────────────────────────────────────────

      acceptJoin(fromUid) {
        if (state.isClient() === true) {
          return state.sendSignal(fromUid, { kind: "bye" });
        }
        if (state.clients.has(fromUid) === true) {
          state.dropClient(fromUid); // a stale retry supersedes its predecessor
        }

        const pc = new RTCPeerConnection();
        const events = pc.createDataChannel("events", { ordered: true });
        const transforms = pc.createDataChannel("transforms", { ordered: false, maxRetransmits: 0 });
        const peer: ServerPeer = { uid: fromUid, worldKey: null, pc, events, transforms, ready: false, pendingIce: [] };
        state.clients.set(fromUid, peer);

        events.onmessage = ({ data }) => state.onServerEventsMsg(peer, JSON.parse(data) as WorldNetMessage);
        events.onclose = () => state.dropClient(fromUid);
        pc.onicecandidate = (e) => {
          if (e.candidate !== null) state.sendSignal(fromUid, { kind: "ice", candidate: e.candidate.toJSON() });
        };
        pc.onconnectionstatechange = () => {
          if (badPcStates.includes(pc.connectionState)) state.dropClient(fromUid);
        };

        void (async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            state.sendSignal(fromUid, { kind: "offer", sdp: offer.sdp ?? "" });
          } catch (e) {
            warn("net: offer failed", e);
            state.dropClient(fromUid);
          }
        })();
      },
      async onAnswer(fromUid, sdp) {
        const peer = state.clients.get(fromUid);
        if (peer === undefined) return;
        try {
          await peer.pc.setRemoteDescription({ type: "answer", sdp });
          for (const candidate of peer.pendingIce) await peer.pc.addIceCandidate(candidate);
          peer.pendingIce.length = 0;
        } catch (e) {
          warn("net: answer failed", e);
          state.dropClient(fromUid);
        }
      },
      onServerEventsMsg(peer, msg) {
        switch (msg.key) {
          case "hello": {
            if (msg.protocol !== worldNetProtocol) {
              state.sendTo(peer, { key: "refused", reason: "protocol" });
              return state.dropClient(peer.uid);
            }
            if (state.isClient() === true) {
              state.sendTo(peer, { key: "refused", reason: "is-client" });
              return state.dropClient(peer.uid);
            }
            peer.worldKey = msg.worldKey;
            state.ensureServerMode();
            state.sendTo(peer, { key: "hello-ack", protocol: worldNetProtocol, mapKey: w.mapKey });
            break;
          }
          case "request-snapshot":
            state.sendTo(peer, state.buildSnapshot());
            peer.ready = true;
            break;
          case "pick": {
            const { normal, ...rest } = msg.event;
            w.events.next({
              ...rest,
              normal: normal === null ? undefined : new THREE.Vector3(...normal),
              srcWorld: (peer.worldKey ?? undefined) as JshCli.PickEvent["srcWorld"],
            });
            break;
          }
          case "set-paused":
            // a client's play/pause request — applying it fires our own disabled/enabled,
            // which `onWorldEvent` broadcasts back to every client
            if ((w.disabled === true) !== msg.paused) w.setDisabled(msg.paused);
            break;
          case "leave":
            state.dropClient(peer.uid);
            break;
          default:
            break; // server → client messages
        }
      },
      ensureServerMode() {
        if (state.mode === "server") return;
        // wrappers, not the methods themselves — an HMR swaps the fields under us
        state.eventsUnsub = w.events.subscribe({ next: (e) => state.onWorldEvent(e) }).unsubscribe;
        state.sampleTimer = window.setInterval(() => state.sampleTransforms(), sampleIntervalMs);
        state.setPhase("server", "connected");
      },
      buildSnapshot() {
        return {
          key: "snapshot",
          mapKey: w.mapKey,
          npcs: Object.values(w.n).map(state.toNetNpc),
          doors: {
            open: Object.values(w.door.byKey).flatMap((d) => (d.open === true && d.sealed !== true ? d.gdKey : [])),
            locked: Object.values(w.door.byKey).flatMap((d) => (d.locked === true ? d.gdKey : [])),
          },
          decor: Object.values(w.decor.runtime.defByKey),
          playerKey: w.n[w.player.key] === undefined ? null : w.player.key,
          paused: w.disabled === true,
        };
      },
      toNetNpc(npc) {
        let netId = state.netIds.fromKey.get(npc.key);
        if (netId === undefined) {
          netId = state.netIds.next++;
          state.netIds.fromKey.set(npc.key, netId);
          state.netIds.toKey.set(netId, npc.key);
        }
        return {
          key: npc.key,
          at: { x: npc.point.x, y: npc.point.y },
          angle: npc.rotation.y,
          skinKey: w.npc.getSkinKeyBySkinIndex(npc.skinIndex) ?? defaultSkinKey,
          decorKey: w.e.npcToDoable[npc.key] ?? undefined,
          lit: npc.lit === true ? true : undefined,
          netId,
          idleClipKey: npc.anim.idleClip.name as AnimationClipKey,
          hidden: npc.hidden === true,
        };
      },
      onWorldEvent(e) {
        if (state.clients.size === 0) return;
        switch (e.key) {
          case "spawned": {
            const npc = w.n[e.npcKey];
            if (npc !== undefined) state.sendToAll({ key: "spawn", npcs: [state.toNetNpc(npc)] });
            // e.g. the player spawned during our bootstrap, after a snapshot went out
            if (e.npcKey === w.player.key) state.sendToAll({ key: "set-player", npcKey: e.npcKey });
            break;
          }
          case "spawned-many": {
            const npcs = e.npcKeys.flatMap((key) => w.n[key] ?? []);
            if (npcs.length > 0) state.sendToAll({ key: "spawn", npcs: npcs.map(state.toNetNpc) });
            break;
          }
          case "removed-npcs":
            state.sendToAll({ key: "remove-npcs", npcKeys: e.npcKeys });
            break;
          case "npc-hidden":
          case "npc-shown":
            state.sendToAll({ key: "npc-visibility", npcKey: e.npcKey, hidden: e.hidden });
            break;
          case "enter-room":
            state.sendToAll({ key: "enter-room", npcKey: e.npcKey, gmRoomId: e.gmRoomId, reEntered: e.reEntered });
            break;
          case "door-opening":
            state.sendToAll({ key: "door", kind: "opening", gdKey: e.gdKey });
            break;
          case "door-closing":
            state.sendToAll({ key: "door", kind: "closing", gdKey: e.gdKey });
            break;
          case "door-locked":
            state.sendToAll({ key: "door", kind: "locked", gdKey: e.gdKey });
            break;
          case "door-unlocked":
            state.sendToAll({ key: "door", kind: "unlocked", gdKey: e.gdKey });
            break;
          case "speech":
            state.sendToAll({ key: "speech", npcKey: e.npcKey, words: e.words, epochMs: e.epochMs });
            break;
          case "decor-created": {
            const defs = e.decorKeys.flatMap((key) => w.decor.runtime.defByKey[key] ?? []);
            if (defs.length > 0) state.sendToAll({ key: "decor", op: "create", defs });
            break;
          }
          case "decor-removed":
            state.sendToAll({ key: "decor", op: "remove", decorKeys: e.decorKeys });
            break;
          case "map-settled":
            // the server switched maps mid-session — clients re-adopt and re-snapshot
            state.sendToAll({ key: "map-changed", mapKey: w.mapKey });
            break;
          case "disabled":
          case "enabled":
            state.sendToAll({ key: "set-paused", paused: e.key === "disabled" });
            break;
          default:
            break;
        }
      },
      sampleTransforms() {
        if (state.clients.size === 0) return;
        const entries = [] as NetTransform[];
        for (const npc of Object.values(w.n)) {
          const netId = state.netIds.fromKey.get(npc.key);
          if (netId === undefined) continue; // not announced to clients yet
          const agent = npc.agent;
          const moving = npc.anim.moving === true;
          const entry: NetTransform = {
            netId,
            x: npc.position.x,
            z: npc.position.z,
            rotY: npc.rotation.y,
            speed: agent === null ? 0 : Math.hypot(agent.velocity[0], agent.velocity[2]),
            moving,
            run: npc.anim.moveClip.name === "run",
          };
          const last = state.lastSent.get(npc.key);
          if (
            last !== undefined &&
            last.moving === moving &&
            Math.abs(last.x - entry.x) < sendEps &&
            Math.abs(last.z - entry.z) < sendEps &&
            Math.abs(last.rotY - entry.rotY) < sendEpsAngle
          ) {
            continue; // unchanged — a paused server goes quiet
          }
          state.lastSent.set(npc.key, { x: entry.x, z: entry.z, rotY: entry.rotY, moving });
          entries.push(entry);
          if (entries.length === maxTransformsPerMessage) break;
        }
        if (entries.length === 0) return;
        const buffer = encodeTransforms(entries);
        for (const peer of state.clients.values()) {
          if (
            peer.ready === true &&
            peer.transforms.readyState === "open" &&
            peer.transforms.bufferedAmount < maxBufferedBytes
          ) {
            peer.transforms.send(buffer);
          }
        }
      },
      sendTo(peer, msg) {
        if (peer.events.readyState === "open") peer.events.send(JSON.stringify(msg));
      },
      sendToAll(msg) {
        const encoded = JSON.stringify(msg);
        for (const peer of state.clients.values()) {
          if (peer.ready === true && peer.events.readyState === "open") peer.events.send(encoded);
        }
      },
      dropClient(uid) {
        const peer = state.clients.get(uid);
        if (peer === undefined) return;
        state.clients.delete(uid);
        try {
          peer.events.close();
          peer.transforms.close();
          peer.pc.close();
        } catch {}
        if (state.clients.size === 0 && state.mode === "server") {
          state.eventsUnsub?.();
          state.eventsUnsub = null;
          window.clearInterval(state.sampleTimer);
          state.lastSent.clear();
          state.setPhase("idle", "idle");
        } else if (state.mode === "server") {
          w.events.next({ key: "net-changed", mode: state.mode, phase: state.phase }); // client count changed
        }
      },

      // ─── client side ───────────────────────────────────────────────────────

      async join(target) {
        const uid = typeof target === "string" ? uidOf(target) : target.uid;
        const worldKey = typeof target === "string" ? target : target.worldKey;
        if (uid === state.pageUid()) throw Error("cannot join self");
        if (state.mode === "server") {
          // an explicit join outranks serving — the clients are told and restore themselves.
          // Also unwedges a PHANTOM client (a refreshed/closed tab lingers here until the
          // peer connection times out), which otherwise blocks joining in one direction
          state.sendToAll({ key: "server-closed" });
          for (const clientUid of [...state.clients.keys()]) state.dropClient(clientUid);
        }
        if (state.mode === "client") await state.leave();
        state.reconnect = null;

        // our own state, saved whilst the mirror gates are still off
        w.e.persistNpcs();
        w.e.persistDecor();

        state.server = { uid, worldKey, pc: null, events: null, transforms: null, mapKey: null, pendingIce: [] };
        state.setPhase("idle", "connecting");
        state.sendSignal(uid, { kind: "join-request", worldKey: w.key });
      },
      maybeAutoReconnect() {
        if (state.mode !== "idle" || state.reconnectAttempted === true) return false;
        const raw = getWorldStore(w.key).read().netParent;
        // an older save held the bare worldKey
        const parent = typeof raw === "string" ? { worldKey: raw, remote: false } : raw;
        if (parent === null || parent.worldKey === w.key) return false;
        state.reconnectAttempted = true;
        void state.reconnectTo(parent.worldKey, { remote: parent.remote });
        return true; // we own this map-settled — `onBootstrapMap` runs only if reconnect fails
      },
      async reconnectTo(worldKey, { bootstrapOnFail = true, remote } = {}) {
        state.reconnect = { worldKey, status: "searching" };
        w.events.next({ key: "net-changed", mode: state.mode, phase: state.phase });

        // worldKeys are only unique within a page — scope the search, so e.g. a lost remote
        // parent never silently resolves to OUR OWN world of the same key
        let target: string | RemoteWorld | null = null;
        if (remote !== true && queryClientApi.get([worldKey]) !== undefined) target = worldKey;
        if (target === null && remote !== false) target = await state.waitForRosterWorld(worldKey, rosterWaitMs);

        if (target !== null) {
          try {
            await state.join(target);
            await state.waitForPhase("connected", connectWaitMs);
            return; // `applySnapshot` cleared `reconnect`
          } catch (e) {
            warn(`net: reconnect to ${worldKey} failed`, e);
            await state.leave({ keepParent: true }); // a later refresh can retry
          }
        }

        state.reconnect = { worldKey, status: "not-found" };
        w.events.next({ key: "net-changed", mode: state.mode, phase: state.phase });
        // when this reconnect took over the boot: boot as normal — into the parent's state,
        // which `applySnapshot` made our save. A mid-session retry has a world standing already
        if (bootstrapOnFail === true) void w.e.onBootstrapMap();
      },
      waitForRosterWorld(worldKey, ms) {
        const ws = state.signalingWs;
        if (ws === null) return Promise.resolve(null);
        return new Promise((resolve) => {
          const timer = window.setTimeout(() => (off(), resolve(null)), ms);
          const off = ws.onRoster((worlds) => {
            const found = worlds.find(
              (x) => x.worldKey === worldKey && isSamePage(x.uid) === false && x.mode !== "client",
            );
            if (found !== undefined) {
              window.clearTimeout(timer);
              off();
              resolve(found);
            }
          });
          // prompt a fresh roster broadcast, in case the last one predates our subscription
          ws.announce({ worldKey: w.key, mapKey: w.mapKey, mode: state.mode });
        });
      },
      waitForPhase(phase, ms) {
        return new Promise((resolve, reject) => {
          if (state.phase === phase) return resolve();
          const started = Date.now();
          const timer = window.setInterval(() => {
            if (state.phase === phase) {
              window.clearInterval(timer);
              resolve();
            } else if (Date.now() - started > ms || (state.mode === "idle" && state.phase === "idle")) {
              window.clearInterval(timer);
              reject(Error(`net: still "${state.phase}" after ${Date.now() - started}ms`));
            }
          }, 250);
        });
      },
      async onOffer(fromUid, sdp) {
        const session = state.server;
        if (session === null || session.uid !== fromUid || session.pc !== null) return;

        const pc = new RTCPeerConnection();
        session.pc = pc;
        pc.onicecandidate = (e) => {
          if (e.candidate !== null) state.sendSignal(fromUid, { kind: "ice", candidate: e.candidate.toJSON() });
        };
        pc.onconnectionstatechange = () => {
          if (badPcStates.includes(pc.connectionState)) void state.leave({ remote: true });
        };
        pc.ondatachannel = ({ channel }) => {
          if (channel.label === "events") {
            session.events = channel;
            channel.onmessage = ({ data }) => void state.onClientEventsMsg(JSON.parse(data) as WorldNetMessage);
            channel.onopen = () => state.sendClient({ key: "hello", protocol: worldNetProtocol, worldKey: w.key });
            channel.onclose = () => void state.leave({ remote: true });
          } else if (channel.label === "transforms") {
            session.transforms = channel;
            channel.binaryType = "arraybuffer";
            channel.onmessage = ({ data }) => state.applyTransforms(data as ArrayBuffer);
          }
        };

        try {
          await pc.setRemoteDescription({ type: "offer", sdp });
          for (const candidate of session.pendingIce) await pc.addIceCandidate(candidate);
          session.pendingIce.length = 0;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          state.sendSignal(fromUid, { kind: "answer", sdp: answer.sdp ?? "" });
        } catch (e) {
          warn("net: answer failed", e);
          void state.leave({ remote: true });
        }
      },
      async onIce(fromUid, candidate) {
        const peer = state.clients.get(fromUid);
        const pc = peer?.pc ?? (state.server?.uid === fromUid ? state.server.pc : null);
        const pending = peer?.pendingIce ?? (state.server?.uid === fromUid ? state.server.pendingIce : null);
        if (pc === null || pc === undefined) {
          pending?.push(candidate);
          return;
        }
        if (pc.remoteDescription === null) {
          pending?.push(candidate);
          return;
        }
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          warn("net: addIceCandidate failed", e);
        }
      },
      onBye(fromUid) {
        if (state.clients.has(fromUid) === true) {
          return state.dropClient(fromUid);
        }
        if (state.server?.uid !== fromUid) return;
        if (state.mode === "client") {
          void state.leave({ remote: true });
        } else {
          // refused whilst connecting
          warn(`net: ${state.server.worldKey} refused the join`);
          state.server = null;
          state.setPhase("idle", "idle");
        }
      },
      sendClient(msg) {
        const events = state.server?.events;
        if (events?.readyState === "open") events.send(JSON.stringify(msg));
      },
      async onClientEventsMsg(msg) {
        const session = state.server;
        if (session === null) return;
        switch (msg.key) {
          case "hello-ack": {
            if (msg.protocol !== worldNetProtocol) {
              warn("net: protocol mismatch");
              return void state.leave();
            }
            session.mapKey = msg.mapKey;
            state.setPhase("client", "adopting-map"); // the mirror gates come on now
            await state.adoptMap(msg.mapKey);
            break;
          }
          case "refused":
            warn(`net: join refused (${msg.reason})`);
            await state.leave({ remote: true });
            break;
          case "snapshot":
            await state.applySnapshot(msg);
            break;
          case "spawn":
            await state.applySpawns(msg.npcs);
            break;
          case "remove-npcs":
            w.e.removeNpcs(...msg.npcKeys);
            for (const npcKey of msg.npcKeys) state.mirrors.delete(npcKey);
            break;
          case "npc-visibility":
            if (w.n[msg.npcKey] !== undefined) {
              w.events.next({ key: msg.hidden ? "npc-hidden" : "npc-shown", npcKey: msg.npcKey, hidden: msg.hidden });
            }
            break;
          case "enter-room":
            if (w.n[msg.npcKey] !== undefined) {
              w.events.next({
                key: "enter-room",
                npcKey: msg.npcKey,
                gmRoomId: msg.gmRoomId,
                reEntered: msg.reEntered,
              });
            }
            break;
          case "door": {
            const door = w.d[msg.gdKey];
            if (door === undefined) break;
            if (msg.kind === "opening" || msg.kind === "closing") {
              w.door.forceDoor(door.gmId, door.doorId, msg.kind === "opening");
            } else {
              door.locked = msg.kind === "locked";
              w.door.syncLockTint(door);
            }
            break;
          }
          case "speech":
            w.speech?.say(msg.npcKey, msg.words);
            break;
          case "decor":
            if (msg.op === "create") {
              for (const def of msg.defs) {
                try {
                  w.decor.create(def);
                } catch (e) {
                  warn(`net: could not mirror decor ${def.key}`, e);
                }
              }
            } else {
              w.decor.remove(...msg.decorKeys);
            }
            break;
          case "map-changed":
            session.mapKey = msg.mapKey;
            state.setPhase("client", "adopting-map");
            await state.adoptMap(msg.mapKey);
            break;
          case "set-paused":
            if ((w.disabled === true) !== msg.paused) w.setDisabled(msg.paused);
            break;
          case "set-player":
            w.player.key = msg.npcKey;
            break;
          case "server-closed":
            await state.leave({ remote: true });
            break;
          default:
            break; // client → server messages
        }
      },
      async adoptMap(mapKey) {
        state.adoptedMapKey = mapKey;
        state.mirrors.clear();
        state.fading.clear();
        if (w.settledMapKey === mapKey && w.mapKey === mapKey) {
          // already on it — just clear our own npcs/decor and sync
          w.e.removeNpcs(...Object.keys(w.n));
          w.decor.remove(...Object.keys(w.decor.runtime.byKey));
          state.requestSnapshot();
        } else {
          await w.floor?.fadeOut(mapKey);
          w.e.onChangeMap(); // its persist calls no-op — we saved before the gates came on
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = mapKey));
          // continues in `onMapSettledAsClient`, via the gated "map-settled"
        }
      },
      onMapSettledAsClient() {
        if (state.server !== null && state.adoptedMapKey === w.mapKey) {
          state.requestSnapshot();
        }
      },
      requestSnapshot() {
        state.setPhase("client", "syncing");
        state.sendClient({ key: "request-snapshot" });
      },
      async applySnapshot(msg) {
        // wholesale replace: mirrors, decor, doors
        w.e.removeNpcs(...Object.keys(w.n));
        w.decor.remove(...Object.keys(w.decor.runtime.byKey));
        state.mirrors.clear();
        state.fading.clear();
        state.netIds.toKey.clear();

        for (const def of msg.decor) {
          try {
            w.decor.create(def);
          } catch (e) {
            warn(`net: could not mirror decor ${def.key}`, e);
          }
        }

        w.door.applyLocks(msg.doors.locked);
        const openSet = new Set<string>(msg.doors.open);
        for (const door of Object.values(w.door.byKey)) {
          if (door.sealed === true) continue;
          const desired = openSet.has(door.gdKey);
          if (door.open !== desired) w.door.forceDoor(door.gmId, door.doorId, desired);
        }

        await state.applySpawns(msg.npcs);

        // adopt the server's player — the mirrored npc, e.g. for camera follow and speech UI
        if (msg.playerKey !== null) w.player.key = msg.playerKey;

        // the server's state becomes our save for this map (the persist gates stop us drifting
        // from it whilst connected), so a refresh — or a failed reconnect — boots into it
        getWorldMapStore(w.key, w.mapKey).patch({
          npcs: {
            playerKey: msg.playerKey,
            npcs: msg.npcs.map(
              ({ netId: _netId, idleClipKey: _clip, hidden: _hidden, ...persistedNpc }) => persistedNpc,
            ),
          },
          doorLocks: msg.doors.locked,
          decor: msg.decor,
        });
        getWorldStore(w.key).patch({
          netParent:
            state.server === null
              ? null
              : { worldKey: state.server.worldKey, remote: isSamePage(state.server.uid) === false },
        });

        state.reconnect = null;
        state.setPhase("client", "connected");
        if ((w.disabled === true) !== msg.paused) w.setDisabled(msg.paused);
        await state.reveal();
      },
      async reveal() {
        // the visual half of `onBootstrapMap`, which the client path skips: the veil lifts, and a
        // still-flat world (a fresh page) must also rise with its floor faded in
        w.view.forceUpdate(0.01);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (w.fold.amount < 1) {
          void w.view.veilCanvas(false, mapVeilMs);
          await pause(unfoldDelayMs);
          w.view.setFadeRoomsActive(w.view.fadeRoomsMode);
          const rising = w.foldTo(1);
          await pause(floorFadeDelayMs);
          void w.floor?.fadeTo(1);
          await rising;
          w.view.showCentreHint();
        } else {
          void w.floor?.fadeTo(1);
          await w.view.veilCanvas(false, mapVeilMs);
          await pause(introPanDelayMs);
          await w.player.panTo();
        }
      },
      async applySpawns(npcs) {
        for (const netNpc of npcs) {
          state.netIds.toKey.set(netNpc.netId, netNpc.key);
          try {
            // the decor meta re-establishes what they were doing e.g. sitting — as `restoreNpcs`
            const at = { ...netNpc.at, meta: netNpc.decorKey ? w.decor.byKey[netNpc.decorKey]?.meta : undefined };
            const existing = w.n[netNpc.key];
            const dist =
              existing === undefined ? 0 : Math.hypot(existing.point.x - netNpc.at.x, existing.point.y - netNpc.at.y);

            if (existing !== undefined && dist > fadeSpawnMinDist) {
              // the server teleported them (`fadeSpawn`) — mirror its darken → move → undarken,
              // holding the transform stream off them so they don't slide there beforehand.
              // A second teleport supersedes a fade in flight (its fadeOut rejects ours), so only
              // the CURRENT owner may clear the hold — a token, not a plain flag
              const token = (state.fading.get(netNpc.key) ?? 0) + 1;
              state.fading.set(netNpc.key, token);
              state.mirrors.get(netNpc.key)?.samples.splice(0);
              try {
                // the server's angle spawns them facing the right way — no switch after the fade
                await existing.fadeSpawn({ at, angle: netNpc.angle });
              } finally {
                if (state.fading.get(netNpc.key) === token) {
                  state.fading.delete(netNpc.key);
                  const mirror = state.mirrors.get(netNpc.key);
                  if (mirror !== undefined) {
                    mirror.samples.splice(0); // drop pre-teleport samples
                    mirror.prevMoving = false; // they respawned idle — a moving sample retriggers
                    mirror.resume = true; // ease onto the stream — the server walked whilst we faded
                  }
                  // the respawn's `playIdleClip` stomps any walk clip without lowering this flag —
                  // make it truthful, so `startMovingMirror` doesn't think the walk is still up
                  existing.anim.moving = false;
                }
              }
            } else {
              await w.npc.spawn({ npcKey: netNpc.key, at, angle: netNpc.angle, as: netNpc.skinKey });
            }

            const npc = w.n[netNpc.key];
            if (npc === undefined) continue;
            if (netNpc.lit === true) w.e.setNpcLit(npc, true);
            const idleClip = w.npc.clips[netNpc.idleClipKey];
            if (idleClip !== undefined && npc.anim.idleClip !== idleClip) {
              npc.anim.idleClip = idleClip;
              npc.anim.playIdleClip(0);
            }
            if (netNpc.hidden !== (npc.hidden === true)) {
              w.events.next({
                key: netNpc.hidden ? "npc-hidden" : "npc-shown",
                npcKey: netNpc.key,
                hidden: netNpc.hidden,
              });
            }
          } catch (e) {
            warn(`net: could not mirror npc ${netNpc.key}`, e);
          }
        }
      },
      applyTransforms(buffer) {
        const now = performance.now() / 1000;
        for (const t of decodeTransforms(buffer)) {
          const npcKey = state.netIds.toKey.get(t.netId);
          if (npcKey === undefined) continue;
          let mirror = state.mirrors.get(npcKey);
          if (mirror === undefined) {
            state.mirrors.set(
              npcKey,
              (mirror = { samples: [], prevMoving: false, resume: false, ox: 0, oz: 0, orot: 0 }),
            );
          }
          mirror.samples.push({ t: now, ...t });
          if (mirror.samples.length > maxMirrorSamples) mirror.samples.shift();
        }
      },
      onTick(delta) {
        if (state.mode !== "client") return;
        const renderT = performance.now() / 1000 - interpDelaySecs;
        for (const [npcKey, mirror] of state.mirrors) {
          const npc = w.n[npcKey];
          const { samples } = mirror;
          if (npc === undefined || samples.length === 0 || state.fading.has(npcKey)) continue;

          // render slightly in the past, between the two bracketing samples; past the final
          // sample this clamps onto it, so an ended walk settles exactly where the server did
          let a = samples[0];
          let b = samples[samples.length - 1];
          for (let i = samples.length - 1; i >= 0; i--) {
            if (samples[i].t <= renderT) {
              a = samples[i];
              b = samples[i + 1] ?? samples[i];
              break;
            }
          }
          const span = b.t - a.t;
          const alpha = span > 0 ? Math.min(1, Math.max(0, (renderT - a.t) / span)) : 1;
          const ix = a.x + (b.x - a.x) * alpha;
          const iz = a.z + (b.z - a.z) * alpha;
          const irot = a.rotY + deltaAngle(a.rotY, b.rotY) * alpha;

          if (mirror.resume === true) {
            // rejoining the stream after a hold (`fadeSpawn`) — the server kept going whilst we
            // faded, so carry the discrepancy as an offset and decay it, rather than jumping
            mirror.resume = false;
            mirror.ox = npc.position.x - ix;
            mirror.oz = npc.position.z - iz;
            mirror.orot = deltaAngle(irot, npc.rotation.y);
          }
          const decay = Math.min(1, delta * mirrorCatchUpRate);
          mirror.ox -= mirror.ox * decay;
          mirror.oz -= mirror.oz * decay;
          mirror.orot -= mirror.orot * decay;

          npc.position.x = ix + mirror.ox;
          npc.position.z = iz + mirror.oz;
          npc.rotation.y += deltaAngle(npc.rotation.y, irot + mirror.orot);

          // anim state follows the sample being RENDERED, not the newest — so the idle
          // crossfade lands when the visual walk ends, not an interp-delay early with a snap
          if (a.moving !== mirror.prevMoving) {
            mirror.prevMoving = a.moving;
            if (a.moving === true) npc.anim.startMovingMirror(a.run);
            else npc.anim.startIdle();
          }
          if (a.moving === true) {
            // interpolated, so the walk cycle slows with the streamed deceleration
            npc.anim.syncAnimation(Math.max(a.speed + (b.speed - a.speed) * alpha, 0.5));
          }
        }
      },
      syncPause(paused) {
        // a client's own play/pause (enter/escape, menu, `w.setDisabled`) goes via the server,
        // whose disabled/enabled events broadcast it to every client. Idempotent: applying a
        // remote pause re-enters here, but the far side is already in that state
        if (state.mode === "client" && state.phase === "connected") {
          state.sendClient({ key: "set-paused", paused });
        }
      },
      forwardPick(e) {
        if (state.mode !== "client") return;
        const { normal, clickId: _clickId, ...rest } = e;
        state.sendClient({
          key: "pick",
          event: { ...rest, normal: normal ? [normal.x, normal.y, normal.z] : null },
        });
      },
      async leave(opts = {}) {
        const session = state.server;
        const wasClient = state.mode === "client";
        state.server = null;
        state.adoptedMapKey = null;
        state.mirrors.clear();
        state.fading.clear();
        state.netIds.toKey.clear();
        state.reconnect = null;
        if (opts.keepParent !== true && opts.remote !== true) {
          // only an EXPLICIT leave forgets the parent — a remote loss may be the server HMR-ing
          const store = getWorldStore(w.key);
          store.patch({ netParent: null });
          store.flush(); // at once — a refresh straight after "leave" must not reconnect
        }

        if (session !== null) {
          if (opts.remote !== true) {
            try {
              if (session.events?.readyState === "open") session.events.send(JSON.stringify({ key: "leave" }));
            } catch {}
            state.sendSignal(session.uid, { kind: "bye" });
          }
          try {
            session.events?.close();
            session.transforms?.close();
            session.pc?.close();
          } catch {}
        }

        state.setPhase("idle", "idle"); // gates off BEFORE restoring our own state
        if (wasClient === true) await state.restoreStandalone();

        if (opts.remote === true && session !== null) {
          // the server may just be bouncing (HMR / reload) — try re-joining once, shortly,
          // scoped to where it lived: a lost REMOTE parent must never resolve to our own
          // world of the same key (worldKeys are only unique within a page)
          const { uid, worldKey } = session;
          const wasRemote = isSamePage(uid) === false;
          window.setTimeout(() => {
            if (state.mode === "idle" && getWorldStore(w.key).read().netParent !== null) {
              void state.reconnectTo(worldKey, { bootstrapOnFail: false, remote: wasRemote });
            }
          }, retryReconnectMs);
        }
      },
      async restoreStandalone() {
        // shed the mirrored world (we keep its map), then bring back our own save for it
        w.e.removeNpcs(...Object.keys(w.n));
        w.decor.remove(...Object.keys(w.decor.runtime.byKey));

        for (const door of Object.values(w.door.byKey)) {
          if (door.sealed !== true && door.open === true) w.door.forceDoor(door.gmId, door.doorId, false);
        }
        const saved = getWorldMapStore(w.key, w.mapKey).read();
        saved.doorLocks !== null ? w.door.applyLocks(saved.doorLocks) : w.door.resetLocks();

        w.e.restoreDecor();
        w.player.key = saved.npcs?.playerKey ?? w.player.key;
        await w.player.ensure();
        await w.e.restoreNpcs();
        await w.e.openDoorwaysWithNpcs();
        // e.g. leaving whilst the join never got past a veiled/flat state
        await state.reveal();
      },
      teardown() {
        if (state.mode === "server") {
          state.sendToAll({ key: "server-closed" });
          for (const uid of [...state.clients.keys()]) state.dropClient(uid);
        }
        if (state.server !== null) {
          // unmounting — close without the standalone restore
          const session = state.server;
          state.server = null;
          try {
            session.events?.close();
            session.transforms?.close();
            session.pc?.close();
          } catch {}
        }
        window.clearInterval(state.sampleTimer);
        state.eventsUnsub?.();
        state.eventsUnsub = null;
        state.mode = "idle";
        state.phase = "idle";
        w.client = false;
        state.reconnectAttempted = false; // a remounted instance may auto-reconnect again
      },
    }),
  );

  w.net = state;
  if (import.meta.env.DEV) {
    // console access, e.g. `__worldNet["world-1"].mode`
    const win = window as unknown as { __worldNet?: Record<string, State> };
    (win.__worldNet ??= {})[w.key] = state;
  }

  useEffect(() => {
    // fast refresh bounces this effect on every save — cancelling the deferred teardown below is
    // what lets live sessions ride out an HMR. Signaling (like the sessions) lives on `state`,
    // which survives the bounce, so it is only built once
    window.clearTimeout(state.teardownTimer);
    if (state.signalingMem === null) {
      const mem = new InMemorySignaling(w.key);
      mem.onMessage((fromUid, msg) => state.onSignal(fromUid, msg));
      state.signalingMem = mem;

      if (DevWsSignaling.available() === true) {
        const ws = new DevWsSignaling(w.key);
        ws.onMessage((fromUid, msg) => state.onSignal(fromUid, msg));
        state.signalingWs = ws;
        ws.announce({ worldKey: w.key, mapKey: w.mapKey, mode: state.mode });
      }
    }

    // remounting into a world that already settled — "map-settled" will not refire for us
    if (state.mode === "idle" && w.settledMapKey !== null && w.settledMapKey === w.mapKey) {
      state.maybeAutoReconnect();
    }

    return () => {
      // deferred, so only a REAL unmount fires it — an HMR remount cancels it just above
      state.teardownTimer = window.setTimeout(() => {
        state.teardown();
        state.signalingMem?.close();
        state.signalingWs?.close();
        state.signalingMem = null;
        state.signalingWs = null;
      }, unmountGraceMs);
    };
  }, []);

  return state;
}

type ServerPeer = {
  uid: string;
  /** From their `hello` */
  worldKey: null | string;
  pc: RTCPeerConnection;
  events: RTCDataChannel;
  transforms: RTCDataChannel;
  /** Snapshot sent — transforms/events flow from then on */
  ready: boolean;
  /** ICE candidates that arrived before the answer */
  pendingIce: RTCIceCandidateInit[];
};

type ClientSession = {
  uid: string;
  worldKey: string;
  pc: null | RTCPeerConnection;
  events: null | RTCDataChannel;
  transforms: null | RTCDataChannel;
  /** From `hello-ack` */
  mapKey: null | string;
  pendingIce: RTCIceCandidateInit[];
};

type MirrorSample = NetTransform & { t: number };

type MirrorBuffer = {
  samples: MirrorSample[];
  prevMoving: boolean;
  /** Set on rejoining the stream after a hold — the next tick converts it into the offsets below */
  resume: boolean;
  /** Decaying catch-up offsets, so a hold ends by easing onto the stream rather than jumping */
  ox: number;
  oz: number;
  orot: number;
};

export type NetMode = "idle" | "server" | "client";
export type NetPhase = "idle" | "connecting" | "adopting-map" | "syncing" | "connected";

export type State = {
  mode: NetMode;
  phase: NetPhase;
  signalingMem: null | InMemorySignaling;
  /** `null` in PROD, where the Vite HMR websocket doesn't exist */
  signalingWs: null | DevWsSignaling;

  // server
  clients: Map<string, ServerPeer>;
  /** Compact per-npc ids for the transform stream — the server assigns, both sides map */
  netIds: { fromKey: Map<string, number>; toKey: Map<number, string>; next: number };
  lastSent: Map<string, { x: number; z: number; rotY: number; moving: boolean }>;
  sampleTimer: number;
  eventsUnsub: null | (() => void);

  // client
  server: null | ClientSession;
  /** The server mapKey we're switching to — matched against "map-settled" */
  adoptedMapKey: null | string;
  mirrors: Map<string, MirrorBuffer>;
  /** npcs mid-`fadeSpawn` on this client (value = owner token) — the transform stream must not move them */
  fading: Map<string, number>;
  /** An auto-reconnect (from persisted `netParent`) in progress or given up */
  reconnect: null | { worldKey: string; status: "searching" | "not-found" };
  /** At most one auto-reconnect per instance lifecycle */
  reconnectAttempted: boolean;
  /** Deferred unmount teardown — an HMR remount cancels it, so sessions survive a save */
  teardownTimer: number;

  isClient(): boolean;
  setPhase(mode: NetMode, phase: NetPhase): void;
  pageUid(): string;
  sendSignal(toUid: string, msg: SignalMsg): void;
  onSignal(fromUid: string, msg: SignalMsg): void;

  acceptJoin(fromUid: string): void;
  onAnswer(fromUid: string, sdp: string): Promise<void>;
  onServerEventsMsg(peer: ServerPeer, msg: WorldNetMessage): void;
  ensureServerMode(): void;
  buildSnapshot(): Extract<WorldNetMessage, { key: "snapshot" }>;
  toNetNpc(npc: Npc): NetNpc;
  onWorldEvent(e: JshCli.Event): void;
  sampleTransforms(): void;
  sendTo(peer: ServerPeer, msg: WorldNetMessage): void;
  sendToAll(msg: WorldNetMessage): void;
  dropClient(uid: string): void;

  join(target: string | { uid: string; worldKey: string }): Promise<void>;
  /** On "map-settled" whilst idle: `true` when a persisted `netParent` reconnect takes over the boot */
  maybeAutoReconnect(): boolean;
  reconnectTo(
    worldKey: string,
    opts?: {
      bootstrapOnFail?: boolean;
      /** Scope the search: `true` roster-only, `false` same-page-only, absent both */
      remote?: boolean;
    },
  ): Promise<void>;
  /** Resolves a non-client `worldKey` from the ws roster, or `null` after `ms` (or in PROD) */
  waitForRosterWorld(worldKey: string, ms: number): Promise<null | RemoteWorld>;
  waitForPhase(phase: NetPhase, ms: number): Promise<void>;
  onOffer(fromUid: string, sdp: string): Promise<void>;
  onIce(fromUid: string, candidate: RTCIceCandidateInit): Promise<void>;
  onBye(fromUid: string): void;
  sendClient(msg: WorldNetMessage): void;
  onClientEventsMsg(msg: WorldNetMessage): Promise<void>;
  adoptMap(mapKey: string): Promise<void>;
  /** Client's "map-settled" lands here instead of `onBootstrapMap` */
  onMapSettledAsClient(): void;
  requestSnapshot(): void;
  applySnapshot(msg: Extract<WorldNetMessage, { key: "snapshot" }>): Promise<void>;
  /** The visual half of `onBootstrapMap` — lift the veil, and raise a still-flat world */
  reveal(): Promise<void>;
  applySpawns(npcs: NetNpc[]): Promise<void>;
  applyTransforms(buffer: ArrayBuffer): void;
  /** Interpolates the mirrors — called from `World`'s `onTick` before `w.npc.onTick` */
  onTick(delta: number): void;
  /** A client's local play/pause, forwarded to the server — see the disabled/enabled cases in `onEvent` */
  syncPause(paused: boolean): void;
  forwardPick(e: JshCli.PickEvent): void;
  leave(opts?: { remote?: boolean; keepParent?: boolean }): Promise<void>;
  restoreStandalone(): Promise<void>;
  teardown(): void;
};

const sampleIntervalMs = 60;
const interpDelaySecs = 0.12;
const rosterWaitMs = 5000;
const connectWaitMs = 10_000;
/** A respawn further than this is a teleport — mirror it as a `fadeSpawn` */
const fadeSpawnMinDist = 0.1;
/** Per-second decay rate of a mirror's post-hold catch-up offset (~gone in 0.4s) */
const mirrorCatchUpRate = 6;
/** Long enough for a fast-refresh effect bounce; short enough that a real unmount cleans up */
const unmountGraceMs = 1000;
const retryReconnectMs = 2000;
const maxMirrorSamples = 8;
const sendEps = 0.001;
const sendEpsAngle = 0.001;
const maxBufferedBytes = 1 << 16;
const badPcStates: RTCPeerConnectionState[] = ["failed", "disconnected", "closed"];
