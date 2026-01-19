import { UiContext } from "@npc-cli/ui-sdk";
import { Spinner, useEffectNonStrict } from "@npc-cli/util";
import { Suspense, useContext } from "react";
import { type UiRegistryKey, uiRegistry } from "./main";

export const UiInstance = ({ id, uiKey }: UiInstanceProps) => {
  const { uiStore } = useContext(UiContext);

  useEffectNonStrict(() => {
    uiStore.setState((draft) => void (draft.metaById[id] = { layoutId: id, uiKey }));
    return () => uiStore.setState((draft) => void delete draft.metaById[id]);
  }, []);

  const Ui = uiRegistry[uiKey];

  return (
    <Suspense fallback={<Spinner />}>
      <Ui id={id} />
    </Suspense>
  );
};

export type UiInstanceProps = {
  id: string;
  uiKey: UiRegistryKey;
};
