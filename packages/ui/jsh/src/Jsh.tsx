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
import type { JshUiMeta } from "./schema";
import { shellFunctionFiles } from "./sources";

export default function Jsh(props: { meta: JshUiMeta }) {
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
