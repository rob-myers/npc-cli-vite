import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
import { BaseUiMetaSchema, UiError, type UiProps } from "@npc-cli/ui-sdk";
import z from "zod";

export default function Jsh(props: UiProps) {
  const meta = UiMetaSchema.safeParse(props.meta);

  if (!meta.success) {
    return <UiError uiKey="Jsh" zodError={meta.error} />;
  }

  return (
    <div className="relative overflow-hidden h-full bg-black p-1 flex items-center justify-center">
      <Tty
        key="my-test-tty"
        sessionKey={meta.data.sessionKey}
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

const UiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  sessionKey: z.templateLiteral(["tty-", z.number()]),
});
