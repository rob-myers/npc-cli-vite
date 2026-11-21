import { Npc } from "../components/npc";
import { NpcAnimation } from "../components/npc-animation";

/**
 * DEV: the npcs' classes, kept up to date by Vite itself (`hot.accept` below), as React may not re-render
 * `NPCs` for a hot update. `npcs` lists the npcs to swap onto them, set by `NPCs`
 */
export const npcHot = { Npc, NpcAnimation, npcs: (): Npc[] => [] };

/** Swaps each npc and their `anim` onto the latest classes, filling in fields added since, e.g. to `upper` */
export function swapNpcClasses(npcs: Iterable<Npc>) {
  for (const npc of npcs) {
    Object.setPrototypeOf(npc, npcHot.Npc.prototype);
    Object.setPrototypeOf(npc.anim, npcHot.NpcAnimation.prototype);
    for (const [key, value] of Object.entries(new npcHot.NpcAnimation(npc))) {
      const had = (npc.anim as unknown as Record<string, unknown>)[key];
      if (had === undefined) Object.assign(npc.anim, { [key]: value });
      else if (value?.constructor === Object && had?.constructor === Object)
        Object.assign(npc.anim, { [key]: { ...value, ...had } });
    }
  }
}

import.meta.hot?.accept(["../components/npc", "../components/npc-animation"], ([npcModule, animModule]) => {
  if (npcModule !== undefined) npcHot.Npc = npcModule.Npc;
  if (animModule !== undefined) npcHot.NpcAnimation = animModule.NpcAnimation;
  swapNpcClasses(npcHot.npcs());
});
