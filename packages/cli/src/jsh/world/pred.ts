import { defaultNpcLabelColor } from "@npc-cli/ui__world/const";
import { sharedMapSlot } from "./shared.service";

type Predicates = {
  everPicked: Set<string>;
  lastPicked: null | string;
  picked: Set<string>;
  player: null | string;
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
}));

pred.setHandler(function onWorldEvent(e, w) {
  switch (e.key) {
    case "picked":
      if (w.helper.isNpcPickEvent(e) === true) {
        visualisePredicates(w, onPickNpc(e));
      }
      break;
    case "set-player": {
      const p = pred.get();
      const prev = p.player;
      p.player = e.playerKey;
      visualisePredicates(
        w,
        [prev, e.playerKey].filter((x) => typeof x === "string"),
      );
      break;
    }
    case "map-settled":
      pred.restore(w.mapKey);
      visualisePredicates(w);
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
  pred.restore(ct.w.mapKey);
  pred.get().player = ct.w.player.key;
  visualisePredicates(ct.w);
  ct.w.e.addKeyedListener("pred", pred.handle);
}
