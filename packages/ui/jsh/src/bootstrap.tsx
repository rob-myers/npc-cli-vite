import { type UiBootstrapProps, UiContext } from "@npc-cli/ui-sdk";
import { useStateRef, useUpdate } from "@npc-cli/util";
import { useContext } from "react";

export default function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  const { uiStore: _ } = useContext(UiContext);

  // ✅ provide inside meta to addInstance
  // 🚧 validate sessionKey `tty-{n}`

  const state = useStateRef(() => ({
    sessionKey: "tty-0",
  }));
  const update = useUpdate();

  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex border p-0.5 w-32">
        <input
          type="text"
          className="w-full p-1 border border-black/30 outline-black"
          placeholder="sessionKey"
          onChange={(e) => {
            state.sessionKey = e.target.value;
            update();
          }}
          value={state.sessionKey}
        />
      </label>
      <button
        type="button"
        className="p-2  text-sm"
        onClick={() => {
          props.addInstance({
            sessionKey: state.sessionKey,
          });
        }}
      >
        Create
      </button>
    </div>
  );
}
