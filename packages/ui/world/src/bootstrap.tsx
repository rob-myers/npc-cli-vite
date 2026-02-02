import { type UiBootstrapProps, UiContext } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { PlusCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useContext } from "react";

export default function WorldBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    invalid: false,
    worldKey: uiStoreApi.getDefaultTitle("World", "world"), // e.g. world-0
    onClickCreate() {
      if (state.invalid) return;

      for (const [_, meta] of Object.entries(uiStore.getState().metaById)) {
        if (meta.uiKey === "World" && meta.worldKey === state.worldKey) {
          return alert(`${"World"}: worldKey ${state.worldKey} already exists.`);
        }
      }

      props.addInstance({
        worldKey: state.worldKey,
        // title matches worldKey
        title: state.worldKey,
      });
    },
  }));

  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex border p-0.5 w-22">
        <input
          type="text"
          autoCorrect="off"
          className={cn("w-full p-1 border border-black/30 invalid:bg-red-400/30 outline-black")}
          placeholder="worldKey"
          onChange={(e) => state.set({ worldKey: e.currentTarget.value })}
          onInput={(e) => state.set({ invalid: !e.currentTarget.checkValidity() })}
          pattern="world-[0-9]+"
          value={state.worldKey}
          onKeyDown={(e) => e.key === "Enter" && state.onClickCreate()}
        />
      </label>
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
