import { sharedFolder } from "../../shell/session";

/**
 * Ensure `/shared/pred` object and return it.
 */
const getPred = () =>
  (sharedFolder.pred ??= {}) as {
    everPicked: Set<string>;
    lastPicked: null | string;
    picked: Set<string>;
    player: null | string;
    onEvent(e: JshCli.Event, w: JshCli.WorldState): void;
  };

/**
 * Ensure `/shared/event` object and return it.
 */
const getEvent = () =>
  (sharedFolder.event ??= {}) as {
    pred(e: JshCli.Event, w: JshCli.WorldState): void;
  };

/**
 * ensure `/shared/pred`
 */
{
  const pred = getPred();
  pred.everPicked ??= new Set();
  pred.lastPicked ??= null;
  pred.picked ??= new Set();
  pred.player ??= null;
}

/**
 * ensure `/shared/event/pred` and update on HMR
 */
getEvent().pred = function onWorldEvent(e: JshCli.Event, w: JshCli.WorldState) {
  switch (e.key) {
    case "picked": {
      if (w.helper.isNpcPickEvent(e) === true) {
        onPickNpc(e);
      }
      break;
    }
    case "set-player":
      getPred().player = e.playerKey;
      break;
  }
  // 🚧 graphical representation e.g. selector rings
};

function onPickNpc(e: JshCli.NpcPickEvent) {
  const { npcKey } = e.meta;
  const pred = getPred();

  pred.everPicked.add(npcKey);

  // lastPicked unless re-pick
  pred.lastPicked = pred.lastPicked === npcKey ? null : npcKey;

  // npcKey includes <=> pick count odd
  if (pred.picked.has(npcKey) === true) {
    pred.picked.delete(npcKey);
  } else {
    pred.picked.add(npcKey);
  }
}

export function predicates(ct: JshCli.RunArg) {
  ct.w.e.addKeyedListener("pred", (e: JshCli.Event, w: JshCli.WorldState) => getEvent().pred?.(e, w));
}
