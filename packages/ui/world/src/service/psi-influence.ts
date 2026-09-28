/** How far into view some rings are, and whither they are headed */
export type Fade = { presence: number; target: 0 | 1 };

export type NpcFade = Fade & { npcKey: string };

/**
 * Whom the player targets: nobody (`null`, off), themself (their rings alone), or another npc. One
 * other fades in or shows whilst at most one fades out, so a new target waits for `leaving` to go —
 * bar `leaving` itself, which turns straight back.
 */
export type Influence = {
  /** The player's own rings, shown for any target */
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

/** `instant` lands it at once, as whilst paused, when nothing fades */
export function chooseInfluence(x: Influence, target: null | string, playerKey: undefined | string, instant: boolean) {
  if (target !== null) x.lastChosen = target;
  if (instant) x.leaving = null;
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

  if (instant) {
    x.self.presence = x.self.target;
    if (x.current !== null) x.current.presence = 1;
    x.leaving = null;
  }
}

/** Every fade a `step` further, forgetting npcs `exists` denies, then a queued target once `leaving` has gone */
export function advanceInfluence(
  x: Influence,
  step: number,
  playerKey: undefined | string,
  exists: (npcKey: string) => boolean,
) {
  for (const fade of [x.self, x.current, x.leaving]) {
    if (fade !== null) fade.presence += Math.max(-step, Math.min(step, fade.target - fade.presence));
  }
  if (x.current !== null && exists(x.current.npcKey) === false) x.current = null; // the player's rings stay
  if (x.leaving !== null && (x.leaving.presence === 0 || exists(x.leaving.npcKey) === false)) x.leaving = null;
  if (x.queued !== undefined && x.leaving === null) chooseInfluence(x, x.queued, playerKey, false);
}

/** The target, or the one taken up once `leaving` has gone */
export function influenceTarget(x: Influence, playerKey: undefined | string): null | string {
  if (x.queued !== undefined) return x.queued;
  if (x.self.target === 0) return null;
  return x.current?.npcKey ?? playerKey ?? null;
}
