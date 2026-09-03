import type { AnimationClipKey } from "../components/NPCs";
import type { PersistedNpc } from "./storage";

/** Bumped whenever `WorldNetMessage` or the transform codec changes shape */
export const worldNetProtocol = 1;

/** Everything a client needs to mirror an npc, plus its `netId` in the transform stream */
export type NetNpc = PersistedNpc & {
  /** Compact id used by the binary transform stream — assigned by the server */
  netId: number;
  idleClipKey: AnimationClipKey;
  hidden: boolean;
};

/** `JshCli.PickEvent` with the three.js `normal` flattened, and no `clickId` (it belongs to the local shell) */
export type SerializedPickEvent = Omit<JshCli.PickEvent, "normal" | "clickId"> & {
  normal: [number, number, number] | null;
};

/** Reliable "events" channel messages, JSON-encoded */
export type WorldNetMessage =
  // client → server
  | { key: "hello"; protocol: number; worldKey: string }
  | { key: "request-snapshot" }
  | { key: "pick"; event: SerializedPickEvent }
  | { key: "leave" }
  // server → client
  | { key: "hello-ack"; protocol: number; mapKey: string }
  | { key: "refused"; reason: "protocol" | "is-client" | "busy" }
  | {
      key: "snapshot";
      mapKey: string;
      npcs: NetNpc[];
      /** The server's player npc, adopted by the client (mirrored like any other npc) */
      playerKey: null | string;
      doors: { open: Geomorph.GmDoorKey[]; locked: Geomorph.GmDoorKey[] };
      decor: Geomorph.DecorDef[];
      paused: boolean;
    }
  /** Bidirectional: server → client "apply this"; client → server "please apply this" */
  | { key: "set-paused"; paused: boolean }
  /** The server's player (re)spawned after the snapshot went out */
  | { key: "set-player"; npcKey: string }
  /** Spawn AND respawn — skin/idle-clip changes ride on a respawn */
  | { key: "spawn"; npcs: NetNpc[] }
  | { key: "remove-npcs"; npcKeys: string[] }
  | { key: "npc-visibility"; npcKey: string; hidden: boolean }
  | { key: "enter-room"; npcKey: string; gmRoomId: Geomorph.GmRoomId; reEntered: boolean }
  | { key: "door"; kind: "opening" | "closing" | "locked" | "unlocked"; gdKey: Geomorph.GmDoorKey }
  | { key: "speech"; npcKey: string; words: string; epochMs: number }
  | { key: "decor"; op: "create"; defs: Geomorph.DecorDef[] }
  | { key: "decor"; op: "remove"; decorKeys: string[] }
  | { key: "map-changed"; mapKey: string }
  | { key: "server-closed" };

/** One npc's sample in the unreliable "transforms" channel */
export type NetTransform = {
  netId: number;
  x: number;
  z: number;
  /** `npc.rotation.y` */
  rotY: number;
  /** Horizontal speed (m/s) — drives `syncAnimation` */
  speed: number;
  moving: boolean;
  /** Running rather than walking — only meaningful whilst `moving` */
  run: boolean;
};

/** u16 netId, f32 x, f32 z, f32 rotY, f32 speed, u8 flags */
const transformEntryBytes = 19;
const movingFlag = 1;
const runFlag = 2;

export function encodeTransforms(entries: NetTransform[]): ArrayBuffer {
  const buffer = new ArrayBuffer(1 + entries.length * transformEntryBytes);
  const view = new DataView(buffer);
  view.setUint8(0, entries.length);
  let offset = 1;
  for (const e of entries) {
    view.setUint16(offset, e.netId);
    view.setFloat32(offset + 2, e.x);
    view.setFloat32(offset + 6, e.z);
    view.setFloat32(offset + 10, e.rotY);
    view.setFloat32(offset + 14, e.speed);
    view.setUint8(offset + 18, (e.moving ? movingFlag : 0) | (e.run ? runFlag : 0));
    offset += transformEntryBytes;
  }
  return buffer;
}

export function decodeTransforms(buffer: ArrayBuffer): NetTransform[] {
  const view = new DataView(buffer);
  const count = view.getUint8(0);
  const entries = [] as NetTransform[];
  let offset = 1;
  for (let i = 0; i < count && offset + transformEntryBytes <= buffer.byteLength; i++) {
    const flags = view.getUint8(offset + 18);
    entries.push({
      netId: view.getUint16(offset),
      x: view.getFloat32(offset + 2),
      z: view.getFloat32(offset + 6),
      rotY: view.getFloat32(offset + 10),
      speed: view.getFloat32(offset + 14),
      moving: (flags & movingFlag) !== 0,
      run: (flags & runFlag) !== 0,
    });
    offset += transformEntryBytes;
  }
  return entries;
}

/** At most `u8 count` entries per message */
export const maxTransformsPerMessage = 255;
