import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
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
  return (
    <Tty
      key="my-test-tty"
      sessionKey={props.meta.sessionKey}
      disabled={props.meta.disabled}
      env={props.meta.env}
      // actual JS
      modules={modules}
      // shell code + js wrapped as shell functions
      shFiles={shellFunctionFiles}
      // 🚧
      onKey={() => {}}
      setTabsEnabled={() => {}}
      updateTabMeta={() => {}}
    />
  );
}
