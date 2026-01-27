import { UiContext, UiError, type UiInstanceMeta } from "@npc-cli/ui-sdk";
import { useEffectNonStrict } from "@npc-cli/util";
import { useContext } from "react";
import { uiRegistry } from "./index";

export const UiInstance = ({ meta }: { meta: UiInstanceMeta }) => {
  const { uiStore } = useContext(UiContext);
  const id = meta.layoutId;

  useEffectNonStrict(() => {
    uiStore.setState((draft) => void (draft.metaById[id] = meta));
    return () => uiStore.setState((draft) => void delete draft.metaById[id]);
  }, []);

  const def = uiRegistry[meta.uiKey];

  const result = def.schema.safeParse(meta);
  if (!result.success) {
    return <UiError uiKey={meta.uiKey} zodError={result.error} />;
  }

  return <def.ui meta={result.data} />;
};
