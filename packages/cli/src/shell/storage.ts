import type { LocalStore } from "@npc-cli/util/local-store";
import { createLocalStore, removeLocalStorageKeys } from "@npc-cli/util/local-store";

/**
 * Everything a tty persists lives under one key per session, plus one for `/shared`:
 *
 * - `tty:<sessionKey>` e.g. `tty:tty-0`
 * - `tty:shared`
 */
const ttyPrefix = "tty:";

export type TtyState = {
  /** Accepted source lines, capped at `TtyShell.maxLines` */
  history: string[];
  /**
   * `/home` vars as a `jsStringify` expression rather than JSON, so functions survive.
   * Revived by `restoreFromPersistedJsStringify`. `null` means never saved.
   */
  vars: null | string;
  menuY: number;
  menuOpen: boolean;
};

const defaultTtyState: TtyState = {
  history: [],
  vars: null,
  menuY: 0,
  menuOpen: false,
};

/** `/shared`, one per origin rather than per session */
export type SharedState = {
  /** As `TtyState["vars"]` */
  vars: null | string;
};

const ttyStores = {} as Record<string, LocalStore<TtyState>>;

export function getTtyStore(sessionKey: string) {
  return (ttyStores[sessionKey] ??= createLocalStore(`${ttyPrefix}${sessionKey}`, defaultTtyState));
}

let sharedStore: undefined | LocalStore<SharedState>;

export function getSharedStore() {
  return (sharedStore ??= createLocalStore<SharedState>(`${ttyPrefix}shared`, { vars: null }));
}

/**
 * The `history@session-*`, `var@session-*`, `var@shared` and `touch-tty-*`/`tty-menu-y`
 * keys this module replaced. Swept once per page load, rather than migrated.
 */
export function removeLegacyTtyKeys() {
  removeLocalStorageKeys(
    (key) =>
      key.startsWith("history@session-") ||
      key.startsWith("var@") ||
      key === "touch-tty-can-type" ||
      key === "touch-tty-open" ||
      key === "tty-menu-y",
  );
}

removeLegacyTtyKeys();
