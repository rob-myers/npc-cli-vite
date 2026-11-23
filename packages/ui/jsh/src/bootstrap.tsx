import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import * as profiles from "@npc-cli/cli/jsh/profiles";
import { forgetBootstrapVars } from "@npc-cli/cli/shell/storage";
import type { UiBootstrapProps } from "@npc-cli/ui-sdk";
import { isWorldUiMeta } from "@npc-cli/ui-sdk/discriminator";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { CreateForm, CreateFormKey, CreateFormRow, useStateRef } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import type { JshUiMeta } from "./schema";

const profileKeys = Object.keys(profiles) as ProfileKey[];

export function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    sessionKey: uiStoreApi.getDefaultTitle("Jsh", "tty"), // e.g. tty-0
    worldKey: "world-0",
    profileKey: "default_profile" as ProfileKey,
    /** Why `sessionKey` can't be made, else `null` */
    getError(): string | null {
      if (!sessionKeyRegex.test(state.sessionKey)) return "a session is tty-N, e.g. tty-2";
      const { byId } = uiStore.getState();
      const taken = Object.values(byId).some(
        ({ meta }) => meta.uiKey === "Jsh" && (meta as JshUiMeta).sessionKey === state.sessionKey,
      );
      return taken ? `${state.sessionKey} already exists` : null;
    },
    onClickCreate() {
      forgetBootstrapVars(state.sessionKey);

      props.addInstance({
        sessionKey: state.sessionKey as `tty-${number}`,
        env: {
          CACHE_SHORTCUTS: {
            w: "WORLD_KEY",
          },
          WORLD_KEY: state.worldKey,
          PROFILE_KEY: state.profileKey,
        },
        title: state.sessionKey,
      } satisfies Partial<JshUiMeta>);
    },
  }));

  const worldKeys = uiStore(
    useShallow(({ byId }) => [
      "world-0",
      ...Object.values(byId).flatMap((ui) =>
        isWorldUiMeta(ui.meta) && ui.meta.worldKey !== "world-0" ? ui.meta.worldKey : [],
      ),
    ]),
  );

  const error = state.getError();

  return (
    <CreateForm error={error} onCreate={state.onClickCreate}>
      <CreateFormKey
        label="session"
        value={state.sessionKey}
        invalid={error !== null}
        onChange={(sessionKey) => state.set({ sessionKey })}
      />
      <CreateFormRow label="world">
        <Picker
          value={state.worldKey}
          options={worldKeys}
          onChange={(worldKey) => state.set({ worldKey })}
          title="the World its commands act on"
          className="text-xs"
          popupClassName="font-mono"
        />
      </CreateFormRow>
      <CreateFormRow label="profile">
        <Picker
          value={state.profileKey}
          options={profileKeys}
          onChange={(profileKey) => state.set({ profileKey })}
          title="what it runs on starting"
          className="text-xs"
          popupClassName="font-mono"
        />
      </CreateFormRow>
    </CreateForm>
  );
}

const sessionKeyRegex = /^tty-\d+$/;
