import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
import type { UiProps } from "@npc-cli/ui-sdk";
import { UiContext } from "@npc-cli/ui-sdk";
import { useContext } from "react";

export function Jsh(props: UiProps) {
  const { uiStore } = useContext(UiContext);

  const jshMeta = uiStore.getState().metaById[props.id];
  console.log({ jshMeta }); // 🚧

  return (
    <div className="relative overflow-hidden h-full bg-black p-1 flex items-center justify-center">
      <Tty
        key="my-test-tty"
        // sessionKey="tty-0"
        sessionKey={props.id} // 🚧 use uiStore.metaById[props.id]
        setTabsEnabled={() => {}}
        updateTabMeta={() => {}}
        disabled={false}
        env={{}}
        tabKey="my-tab-key"
        onKey={() => {}}
        modules={modules}
        shFiles={{}}
        profile={`import util\n`}
      />
    </div>
  );
}
