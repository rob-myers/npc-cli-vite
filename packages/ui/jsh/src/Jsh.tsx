/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */

/**
 * Ways to import JS as shell functions:
 * ```sh
 * source /etc/util.js.sh
 * import util
 * import call from util
 * import call expr from util
 * ```
 */
import { Tty } from "@npc-cli/cli";
import * as modules from "@npc-cli/cli/jsh/modules";
import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { useContext } from "react";
import type { JshUiMeta } from "./schema";
import { shellFunctionFiles } from "./sources";

export default function Jsh({ meta }: { meta: JshUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  return (
    <Tty
      disabled={meta.disabled}
      env={meta.env}
      modules={modules} // actual JS
      onBooted={() => uiStoreApi.setUiMeta(meta.id, (draft) => ((draft as JshUiMeta).sessionBootedAt = Date.now()))}
      originalProfileKey={
        typeof meta.env.PROFILE_KEY === "string" ? meta.env.PROFILE_KEY : ("default_profile" satisfies ProfileKey)
      }
      sessionKey={meta.sessionKey}
      shFiles={shellFunctionFiles} // JS wrapped as shell functions
    />
  );
}
