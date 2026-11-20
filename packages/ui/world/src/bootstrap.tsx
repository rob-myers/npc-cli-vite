import type { UiBootstrapProps } from "@npc-cli/ui-sdk";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { CreateForm, CreateFormKey, useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import type { WorldUiMeta } from "./schema";

export default function WorldBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    worldKey: uiStoreApi.getDefaultTitle("World", "world") as string,
    /** Why `worldKey` can't be made, else `null` */
    getError(): string | null {
      if (!worldKeyRegex.test(state.worldKey)) return "a World is world-N, e.g. world-2";
      const taken = Object.values(uiStore.getState().byId).some(
        ({ meta }) => meta.uiKey === "World" && (meta as WorldUiMeta).worldKey === state.worldKey,
      );
      return taken ? `${state.worldKey} already exists` : null;
    },
    onClickCreate() {
      props.addInstance({
        worldKey: state.worldKey as WorldKey,
        title: state.worldKey, // title matches worldKey
      } satisfies Partial<WorldUiMeta>);
    },
  }));

  const error = state.getError();

  return (
    <CreateForm error={error} onCreate={state.onClickCreate}>
      <CreateFormKey
        label="world"
        value={state.worldKey}
        invalid={error !== null}
        onChange={(worldKey) => state.set({ worldKey })}
      />
    </CreateForm>
  );
}

type WorldKey = `world-${number}`;

const worldKeyRegex = /^world-\d+$/;
