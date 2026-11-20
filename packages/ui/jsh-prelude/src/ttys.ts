import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";

/** Where an entry without a tty runs: its World's lowest-numbered tty, e.g. `tty-0` */
export function worldTtyOf(worldKey: string): undefined | JshUiMeta["sessionKey"] {
  const numberOf = (x: JshUiMeta) => Number(x.sessionKey.slice("tty-".length));
  return findTtys(worldKey).sort((a, b) => numberOf(a) - numberOf(b))[0]?.sessionKey;
}

/** The ttys whose World is this one */
export function findTtys(worldKey: string): JshUiMeta[] {
  return jshMetas().filter((meta) => meta.env.WORLD_KEY === worldKey);
}

/** The tty with this session, if any */
export function findTty(sessionKey: string): undefined | JshUiMeta {
  return jshMetas().find((meta) => meta.sessionKey === sessionKey);
}

/** Every tty */
function jshMetas(): JshUiMeta[] {
  return Object.values(uiStore.getState().byId).flatMap(({ meta }) =>
    meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [],
  );
}
