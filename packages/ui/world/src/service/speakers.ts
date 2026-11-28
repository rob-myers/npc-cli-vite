import type * as THREE from "three/webgpu";
import type { State as WorldState } from "../components/World";
import { quadBox } from "./decor-box";
import { slotOf } from "./room-slots";
import { speechConfig } from "./speech";

/** A decor quad with `meta.speaker`: `true` or a channel, e.g. `pa` */
export function isSpeaker(d: Geomorph.Decor | undefined): d is Geomorph.DecorQuad {
  return d?.type === "quad" && d.meta.speaker !== undefined && d.meta.speaker !== false;
}

/**
 * The speakers `via` names: a speaker's decor key, `room` for those in `toKey`'s room, else a channel.
 * Throws if there are none
 */
export function speakersOf(w: WorldState, via: string, toKey: string): string[] {
  const { byKey, byRoom } = w.decor;
  let found: Geomorph.Decor[];
  if (via in byKey) found = [byKey[via]];
  else if (via === "room") {
    const at = w.npc.npcToRoom.get(toKey);
    found = at === undefined ? [] : [...(byRoom[at.gmId]?.[at.roomId] ?? [])];
  } else found = Object.values(byKey).filter((d) => d.meta.speaker === via);
  const keys = found.flatMap((d) => (isSpeaker(d) ? d.key : []));
  if (keys.length === 0) throw Error(`no speaker: ${via}`);
  return keys;
}

/** Adds to `out` whoever is in earshot of each speaker: its room and through open doors, within `hearMetres` */
export function addSpeakerHearers(w: WorldState, speakers: string[] | undefined, out: Set<string>) {
  for (const key of speakers ?? []) {
    const d = w.decor.byKey[key];
    const at = isSpeaker(d) ? centreOf(w, d) : null;
    if (at === null || d === undefined || typeof d.meta.grKey !== "string") continue;
    const { gmId, roomId, grKey } = d.meta;
    for (const npc of w.npc.near.inReachOf({ gmId, roomId, grKey: grKey as Geomorph.GmRoomKey })) {
      if (Math.hypot(npc.point.x - at.x, npc.point.y - at.z) <= speechConfig.hearMetres) out.add(npc.key);
    }
  }
  return out;
}

/** A speaker's bubble key, beside npcKeys in `w.bubble` */
export const relayKey = (decorKey: string) => `@${decorKey}`;

/** The speaker of a bubble key, if it is one */
export function relayDecor(w: WorldState, key: string) {
  const d = key.startsWith("@") ? w.decor.byKey[key.slice(1)] : undefined;
  return isSpeaker(d) ? d : undefined;
}

/** Where a speaker's bubble sits: just over its top edge */
export function speakerPoint(w: WorldState, d: Geomorph.DecorQuad, out: THREE.Vector3) {
  const at = centreOf(w, d);
  return at === null ? null : out.set(at.x, at.y + bubbleLift, at.z);
}

/** How shown a speaker's room is, as its npcs' bubbles fade with theirs */
export function speakerShown(w: WorldState, d: Geomorph.DecorQuad) {
  const { gmId, roomId } = d.meta;
  return roomId >= 0 ? w.view.fadeRoomsFx.visibilityOf(slotOf(gmId, roomId)) : 1;
}

/** Its drawn box's centre in plan, and its top. Kept per decor, as a moved one is a new object */
function centreOf(w: WorldState, d: Geomorph.DecorQuad) {
  const cached = centres.get(d);
  if (cached !== undefined) return cached;
  const entry = w.sheets?.decor[w.decor.getDecorImgKey(d)];
  if (entry === undefined) return null;
  const { outline, top } = quadBox(d, entry);
  const n = outline.length || 1;
  const x = outline.reduce((sum, p) => sum + p.x, 0) / n;
  const z = outline.reduce((sum, p) => sum + p.y, 0) / n;
  const centre = { x, y: top, z };
  centres.set(d, centre);
  return centre;
}

/** Metres a speaker's bubble sits above it */
const bubbleLift = 0.05;

const centres = new WeakMap<Geomorph.Decor, { x: number; y: number; z: number }>();
