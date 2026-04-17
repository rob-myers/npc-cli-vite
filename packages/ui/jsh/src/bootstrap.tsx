import type { UiBootstrapProps } from "@npc-cli/ui-sdk";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { PlusCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import type { JshUiMeta } from "./schema";

export function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    invalid: false,
    envInvalid: false,
    sessionKey: uiStoreApi.getDefaultTitle("Jsh", "tty"), // e.g. tty-0
    env: "WORLD_KEY=world-0",
    onClickCreate() {
      if (state.invalid || state.envInvalid) return;

      for (const [_, { meta }] of Object.entries(uiStore.getState().byId)) {
        if (meta.uiKey === "Jsh" && meta.sessionKey === state.sessionKey) {
          return alert(`${"Jsh"}: sessionKey ${state.sessionKey} already exists.`);
        }
      }

      props.addInstance({
        sessionKey: state.sessionKey as `tty-${number}`,
        env: parseEnvString(state.env),
        title: state.sessionKey,
      } satisfies Partial<JshUiMeta>);
    },
  }));

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
      <label className="flex border p-0.5 flex-1">
        <input
          type="text"
          autoCorrect="off"
          className={cn(
            "w-full p-1 border border-black/30 invalid:bg-red-200 outline-black font-mono bg-white text-black text-sm",
          )}
          placeholder="ENV_VAR=value ..."
          onChange={(e) => state.set({ env: e.currentTarget.value })}
          onInput={(e) => state.set({ envInvalid: !e.currentTarget.checkValidity() })}
          pattern="([A-Za-z_][A-Za-z0-9_]*=[^\s]*)(\s+[A-Za-z_][A-Za-z0-9_]*=[^\s]*)*\s*"
          value={state.env}
          onKeyDown={(e) => e.key === "Enter" && state.onClickCreate()}
        />
      </label>
      <button
        type="button"
        className="p-2 text-sm cursor-pointer disabled:cursor-not-allowed"
        disabled={state.invalid || state.envInvalid}
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

function parseEnvString(env: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of env.trim().split(/\s+/)) {
    const eqIndex = part.indexOf("=");
    if (eqIndex > 0) {
      result[part.slice(0, eqIndex)] = part.slice(eqIndex + 1);
    }
  }
  return result;
}
