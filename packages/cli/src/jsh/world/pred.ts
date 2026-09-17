import { defaultNpcLabelColor } from "@npc-cli/ui__world/const.npc";
import { sharedMapSlot } from "./shared.service";

type Predicates = {
  everPicked: Set<string>;
  lastPicked: null | string;
  picked: Set<string>;
  player: null | string;
  /** By npcKey, the boundary segment `[x1, y1, z1, x2, y2, z2]` `park` stood them against */
  parked: Map<string, number[]>;
  // ...
};

/**
 * `/shared/pred`, kept per map: a map's predicates outlive a visit to another map, whose
 * npcs they would mean nothing to
 */
const pred = sharedMapSlot<Predicates>("pred", () => ({
  everPicked: new Set(),
  lastPicked: null,
  picked: new Set(),
  player: null,
  parked: new Map(),
}));

pred.setHandler(function onWorldEvent(e, w) {
  if (w.isMapChanging() === true) return;

  const p = pred.get();
  switch (e.key) {
    case "picked":
      if (w.helper.isNpcPickEvent(e) === true) {
        visualisePredicates(w, onPickNpc(e));
      }
      break;
    case "set-player": {
      const prev = p.player;
      p.player = e.playerKey;
      visualisePredicates(
        w,
        [prev, e.playerKey].filter((x) => typeof x === "string"),
      );
      break;
    }
    case "map-settled": {
      const next = pred.restore(w.mapKey);
      next.player = w.player.key; // we ignored "set-player" during map change
      visualisePredicates(w);
      break;
    }
    // a respawn unparks — bar `park`'s own, which marks them again once it lands. A first spawn
    // does not: `restoreNpcs` runs off "map-settled", so a restore lands here parked
    case "spawned":
      if (e.spawns > 1) p.parked.delete(e.npcKey);
      break;
    case "started-moving":
      p.parked.delete(e.npcKey);
      break;
    case "removed-npcs":
      for (const npcKey of e.npcKeys) p.parked.delete(npcKey);
      break;
  }
});

/**
 * Show the predicates on `npcKeys`, by default every npc:
 * - picked have selector ring
 * - player has white label
 */
function visualisePredicates(w: JshCli.WorldState, npcKeys: Iterable<string> = Object.keys(w.n)) {
  const { picked, player } = pred.get();
  for (const npcKey of npcKeys) {
    const npc = w.n[npcKey];
    if (npc === undefined) continue;
    npc.setRing(picked.has(npc.key) ? "#99f" : undefined);
    const color = npc.key === player ? "#fff" : defaultNpcLabelColor;
    if (color !== npc.labelStyle.color) {
      npc.drawLabel({ color }); // a texture layer, so only when it changes
    }
  }
}

/** `park`'s side of the mapping — an object, so no shell function is made of it */
export const parked = {
  get: () => pred.get().parked,
  mark: (npcKey: string, seg: number[]) => void pred.get().parked.set(npcKey, seg),
};

/** @returns the npcs whose visuals may have changed */
function onPickNpc(e: JshCli.NpcPickEvent) {
  const { npcKey } = e.meta;
  const p = pred.get();
  const changed = [...p.picked, npcKey];

  p.everPicked.add(npcKey);
  p.lastPicked = npcKey;

  // a plain pick selects them alone; with shift held it adds them, or takes them out again
  if (e.shiftKey === false) {
    p.picked = new Set([npcKey]);
  } else if (p.picked.has(npcKey) === true) {
    p.picked.delete(npcKey);
  } else {
    p.picked.add(npcKey);
  }

  return changed;
}

/**
 * `predicates` is idempotent and must be invoked to commence tracking.
 */
export function predicates(ct: JshCli.RunArg) {
  const p = pred.restore(ct.w.mapKey);
  p.player = ct.w.player.key;
  visualisePredicates(ct.w);
  ct.w.e.addKeyedListener("pred", pred.handle);
}
