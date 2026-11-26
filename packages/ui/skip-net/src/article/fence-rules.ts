import { npcSpawnConfig } from "@npc-cli/ui__world/const.npc";

/** What a fence's literal may be replaced by, by its kind, e.g. ```` ```sh rob=npc g0d1=door ```` */
export const fenceKinds = {
  npc: npcSpawnConfig.keyPattern,
  door: /^g\d+d\d+$/,
} as const;

export type FenceKind = keyof typeof fenceKinds;

/** A literal in a fence's comments and commands, replaceable by any value of its kind */
export type FenceRule = { literal: string; kind: FenceKind };

/** Its rules from a fence's meta, e.g. `rob=npc kate=npc`, those of an unknown kind ignored */
export function rulesOf(meta: string): FenceRule[] {
  const pairs = meta.replace(/\btitle="[^"]*"/, "").matchAll(/(?:^|\s)([\w-]+)=([a-z]+)(?=\s|$)/g);
  return [...pairs].flatMap(([, literal, kind]) => (kind in fenceKinds ? [{ literal, kind: kind as FenceKind }] : []));
}
