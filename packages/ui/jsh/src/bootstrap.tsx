import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import * as profiles from "@npc-cli/cli/jsh/profiles";
import type { UiBootstrapProps } from "@npc-cli/ui-sdk";
import { isWorldUiMeta } from "@npc-cli/ui-sdk/discriminator";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  jsStringify,
  restoreFromPersistedJsStringify,
  tryLocalStorageGet,
  tryLocalStorageSet,
  warn,
} from "@npc-cli/util/legacy/generic";
import { PlusCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import type { JshUiMeta } from "./schema";

const profileKeys = Object.keys(profiles) as ProfileKey[];

export function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    invalid: false,
    sessionKey: uiStoreApi.getDefaultTitle("Jsh", "tty"), // e.g. tty-0
    worldKey: "world-0",
    profileKey: "default_profile" as ProfileKey,
    onClickCreate() {
      if (state.invalid) return;

      if (
        Object.entries(uiStore.getState().byId).find(
          ([_, { meta }]) => meta.uiKey === "Jsh" && meta.sessionKey === state.sessionKey,
        )
      ) {
        return alert(`${state.sessionKey} already exists.`);
      }

      state.prepareExtantPersistedSession(state.sessionKey);

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
    prepareExtantPersistedSession(sessionKey: string) {
      try {
        const localStorageKey = `var@session-${sessionKey}`;
        const persistedSessionHome = restoreFromPersistedJsStringify(tryLocalStorageGet(localStorageKey) || "null");
        // Remove PROFILE_KEY from persisted session, so we can overwrite it.
        delete persistedSessionHome.PROFILE_KEY;
        tryLocalStorageSet(localStorageKey, jsStringify(persistedSessionHome, false, true));
      } catch {
        warn(`Failed to mutate persisted session ${sessionKey}`);
      }
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

  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex border p-0.5 w-16">
        <input
          type="text"
          autoCorrect="off"
          className={cn("w-full p-1 border border-black/30 invalid:bg-red-400/30 outline-black")}
          placeholder="sessionKey"
          onChange={(e) => state.set({ sessionKey: e.currentTarget.value })}
          onInput={(e) => state.set({ invalid: !e.currentTarget.checkValidity() })}
          pattern="tty-[0-9]+"
          value={state.sessionKey}
          onKeyDown={(e) => e.key === "Enter" && state.onClickCreate()}
        />
      </label>
      <select
        className="border p-0.5 bg-black text-green-600 font-mono text-sm"
        value={state.worldKey}
        onChange={(e) => state.set({ worldKey: e.currentTarget.value })}
      >
        {worldKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <select
        className="border p-0.5 bg-black text-green-600 font-mono text-sm flex-1"
        value={state.profileKey}
        onChange={(e) => state.set({ profileKey: e.currentTarget.value as ProfileKey })}
      >
        {profileKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="p-2 text-sm cursor-pointer disabled:cursor-not-allowed"
        disabled={state.invalid}
        onClick={state.onClickCreate}
      >
        {state.invalid ? (
          <WarningIcon className="size-6 fill-red-400" weight="duotone" />
        ) : (
          <PlusCircleIcon className="size-6" weight="duotone" />
        )}
      </button>
    </div>
  );
}
