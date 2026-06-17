import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import { uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import {
  jsStringify,
  pause,
  restoreFromPersistedJsStringify,
  tryLocalStorageGet,
  tryLocalStorageSet,
  warn,
} from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import type { JshUiMeta } from "./schema";
/**
 * Ways to import JS as shell functions:
 * ```sh
 * source /etc/util.js.sh
 * import util
 * import call from util
 * import call expr from util
 * ```
 */
import { shellFunctionFiles } from "./sources";

export default function Jsh(props: { meta: JshUiMeta }) {
  useEffect(() => {
    /**
     * Remove PROFILE_KEY from persisted session, so that next
     * time it is bootstrapped it won't override chosen profile.
     */
    uiStoreApi.setUiMeta(props.meta.id, (draft) => {
      draft.onRemoveUi = async () => {
        const { sessionKey } = props.meta;
        const localStorageKey = `var@session-${sessionKey}`;
        await pause(300); // wait for session persist on unmount
        try {
          const persistedSessionHome = restoreFromPersistedJsStringify(tryLocalStorageGet(localStorageKey) || "null");
          delete persistedSessionHome.PROFILE_KEY;
          tryLocalStorageSet(localStorageKey, jsStringify(persistedSessionHome, false, true));
        } catch {
          warn(`Failed to mutate persisted session ${sessionKey}`);
        }
      };
    });
  }, []);

  return (
    <Tty
      sessionKey={props.meta.sessionKey}
      originalProfileKey={
        typeof props.meta.env.PROFILE_KEY === "string"
          ? props.meta.env.PROFILE_KEY
          : ("default_profile" satisfies ProfileKey)
      }
      disabled={props.meta.disabled}
      env={props.meta.env}
      // actual JS
      modules={modules}
      // JS wrapped as shell functions
      shFiles={shellFunctionFiles}
      // 🚧
      onKey={() => {}}
      setTabsEnabled={() => {}}
      updateTabMeta={() => {}}
    />
  );
}
