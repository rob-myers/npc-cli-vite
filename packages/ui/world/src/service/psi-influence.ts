import { type Fade, stepFade } from "./fade";

export type NpcFade = Fade & { npcKey: string };

/**
 * Whom the player targets: nobody (`null`, off), themself (psi on, on nobody else), or another npc. One
 * other fades in or shows whilst at most one fades out, so a new target waits for `leaving` to go —
 * bar `leaving` itself, which turns straight back.
 */
export type Influence = {
  /** The player's own presence, there for any target */
  self: Fade;
  /** Another npc fading in, or shown */
  current: NpcFade | null;
  /** Another npc fading out */
  leaving: NpcFade | null;
  /** The target taken up once `leaving` has gone: the latest wins */
  queued?: null | string;
  /** The last target, kept through a turn-off */
  lastChosen: null | string;
};

export function createInfluence(): Influence {
  return { self: { presence: 0, target: 0 }, current: null, leaving: null, lastChosen: null };
}

export function chooseInfluence(x: Influence, target: null | string, playerKey: undefined | string) {
  if (target !== null) x.lastChosen = target;
  /** Another npc, else nobody but the player */
  const other = target === playerKey ? null : target;
  const reviving = other !== null && other === x.leaving?.npcKey;
  if (x.leaving !== null && reviving === false) {
    x.queued = target;
    return;
  }
  x.queued = undefined;
  x.self.target = target === null ? 0 : 1;

  if (other !== (x.current?.npcKey ?? null)) {
    const prev = x.current;
    x.current = reviving ? x.leaving : other === null ? null : { npcKey: other, presence: 0, target: 1 };
    x.leaving = prev;
    if (x.current !== null) x.current.target = 1;
    if (x.leaving !== null) x.leaving.target = 0;
  }
}

/** Every fade a step `in` or `out`, as it is headed, forgetting npcs `exists` denies, then a queued target once `leaving` has gone */
export function advanceInfluence(
  x: Influence,
  steps: { in: number; out: number },
  playerKey: undefined | string,
  exists: (npcKey: string) => boolean,
) {
  for (const fade of [x.self, x.current, x.leaving]) {
    if (fade !== null) stepFade(fade, fade.target === 1 ? steps.in : steps.out);
  }
  if (x.current !== null && exists(x.current.npcKey) === false) x.current = null; // the player's own stays
  if (x.leaving !== null && (x.leaving.presence === 0 || exists(x.leaving.npcKey) === false)) x.leaving = null;
  if (x.queued !== undefined && x.leaving === null) chooseInfluence(x, x.queued, playerKey);
}

/** The target, or the one taken up once `leaving` has gone */
export function influenceTarget(x: Influence, playerKey: undefined | string): null | string {
  if (x.queued !== undefined) return x.queued;
  if (x.self.target === 0) return null;
  return x.current?.npcKey ?? playerKey ?? null;
}
