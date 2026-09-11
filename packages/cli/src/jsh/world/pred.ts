import { sharedMapSlot } from "./shared-slot";

/** Predicates */
type Pred = {
  everPicked: Set<string>;
  lastPicked: null | string;
  picked: Set<string>;
  player: null | string;
};

/**
 * `/shared/pred`, kept per map: a map's predicates outlive a visit to another map, whose
 * npcs they would mean nothing to
 */
const pred = sharedMapSlot<Pred>("pred", () => ({
  everPicked: new Set(),
  lastPicked: null,
  picked: new Set(),
  player: null,
}));

pred.setHandler(function onWorldEvent(e, w) {
  switch (e.key) {
    case "picked": {
      if (w.helper.isNpcPickEvent(e) === true) {
        onPickNpc(e);
      }
      break;
    }
    case "set-player":
      pred.get().player = e.playerKey;
      break;
    case "map-settled":
      pred.restore(w.mapKey); // the new map's own, restored from an earlier visit if there was one
      break;
  }
  // 🚧 graphical representation e.g. selector rings
});

function onPickNpc(e: JshCli.NpcPickEvent) {
  const { npcKey } = e.meta;
  const p = pred.get();

  p.everPicked.add(npcKey);

  // lastPicked unless re-pick
  p.lastPicked = p.lastPicked === npcKey ? null : npcKey;

  // npcKey includes <=> pick count odd
  if (p.picked.has(npcKey) === true) {
    p.picked.delete(npcKey);
  } else {
    p.picked.add(npcKey);
  }
}

export function predicates(ct: JshCli.RunArg) {
  pred.restore(ct.w.mapKey);
  ct.w.e.addKeyedListener("pred", pred.handle);
}
