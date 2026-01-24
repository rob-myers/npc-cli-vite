import { type UiBootstrapProps, UiContext } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { useContext } from "react";

export default function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore: _ } = useContext(UiContext);

  // ✅ provide inside meta to addInstance
  // 🚧 validate sessionKey `tty-{n}`

  const state = useStateRef(() => ({
    invalid: false,
    sessionKey: "tty-0",
  }));

  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex border p-0.5 w-32">
        <input
          type="text"
          className={cn("w-full p-1 border border-black/30 invalid:bg-red-400/30 outline-black")}
          placeholder="sessionKey"
          onChange={(e) => state.set({ sessionKey: e.currentTarget.value })}
          onInput={(e) => state.set({ invalid: !e.currentTarget.checkValidity() })}
          pattern="tty-[0-9]+"
          value={state.sessionKey}
        />
      </label>
      <button
        type="button"
        className="p-2 text-sm"
        disabled={state.invalid}
        onClick={() => {
          props.addInstance({
            sessionKey: state.sessionKey,
          });
        }}
      >
        {state.invalid ? "❌" : "Create"}
      </button>
    </div>
  );
}
