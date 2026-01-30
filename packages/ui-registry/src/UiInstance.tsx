import { type UiInstanceMeta, uiStore } from "@npc-cli/ui-sdk";
import { useStore } from "zustand/react";
import { uiRegistry } from "./index";
import { UiErrorBoundary } from "./UiErrorBoundary";

export const UiInstance = ({ meta }: { meta: UiInstanceMeta }) => {
  const id = meta.layoutId;
  const def = uiRegistry[meta.uiKey];
  // 🚧 clean e.g. move into defineUi and remove this component
  const m = useStore(uiStore, (s) => s.metaById[id] ?? meta);

  return (
    <UiErrorBoundary meta={m}>
      <def.ui meta={m} />
    </UiErrorBoundary>
  );
};
