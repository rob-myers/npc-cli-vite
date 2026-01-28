import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
import type { JshUiMeta } from "./schema";
import { shellFunctionFiles } from "./sources";

export default function Jsh(props: { meta: JshUiMeta }) {
  return (
    <div className="relative overflow-hidden h-full bg-black p-1 flex items-center justify-center">
      <Tty
        key="my-test-tty"
        sessionKey={props.meta.sessionKey}
        setTabsEnabled={() => {}}
        updateTabMeta={() => {}}
        disabled={false}
        env={{}}
        tabKey="my-tab-key"
        onKey={() => {}}
        modules={modules}
        shFiles={shellFunctionFiles}
        // can also `import util`
        profile={`source /etc/util.sh\nsource /etc/util.js.sh`}
      />
    </div>
  );
}
