import { type UiInstanceMeta } from "@npc-cli/ui-sdk";
import { uiRegistry } from "./index";
import { UiErrorBoundary } from "./UiErrorBoundary";

// 🚧 remove this component
export const UiInstance = ({ meta }: { meta: UiInstanceMeta }) => {
  const def = uiRegistry[meta.uiKey];
  return (
    <UiErrorBoundary meta={meta}>
      <def.ui meta={meta} />
    </UiErrorBoundary>
  );
};
