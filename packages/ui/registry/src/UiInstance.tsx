import { UiContext, type UiInstanceMeta } from "@npc-cli/ui-sdk";
import { useEffectNonStrict } from "@npc-cli/util";
import { useContext } from "react";
import { uiRegistry } from "./main";

export const UiInstance = ({ id, meta }: UiInstanceProps) => {
  const { uiStore } = useContext(UiContext);

  useEffectNonStrict(() => {
    uiStore.setState((draft) => void (draft.metaById[id] = meta));
    return () => uiStore.setState((draft) => void delete draft.metaById[id]);
  }, []);

  const Ui = uiRegistry[meta.uiKey].ui;
  return <Ui id={id} meta={meta} />;
};

export type UiInstanceProps = {
  id: string;
  meta: UiInstanceMeta;
};
