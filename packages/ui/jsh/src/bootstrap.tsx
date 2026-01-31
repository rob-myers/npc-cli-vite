import { type UiBootstrapProps, UiContext } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { useContext } from "react";

export function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    invalid: false,
    sessionKey: uiStoreApi.getDefaultTitle("Jsh", "tty"),
    onClickCreate() {
      if (state.invalid) return;

      for (const [_, meta] of Object.entries(uiStore.getState().metaById)) {
        if (meta.uiKey === "Jsh" && meta.sessionKey === state.sessionKey) {
          return alert(`${"Jsh"}: sessionKey ${state.sessionKey} already exists.`);
        }
      }

      props.addInstance({
        sessionKey: state.sessionKey,
        // title matches sessionKey
        title: state.sessionKey,
      });
    },
  }));

  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex border p-0.5 w-32">
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
      <button
        type="button"
        className="p-2 text-sm cursor-pointer disabled:cursor-not-allowed"
        disabled={state.invalid}
        onClick={state.onClickCreate}
      >
        {state.invalid ? "❌" : "Create"}
      </button>
    </div>
  );
}
