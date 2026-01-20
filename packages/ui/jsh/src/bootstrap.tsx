import type { UiBootstrapProps } from "@npc-cli/ui-sdk";

// 🚧
export default function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  return (
    <div className="border flex w-full">
      <label className="flex">
        <input type="text" className="w-full p-1" placeholder="sessionKey" />
      </label>
      <button type="button" className="p-2 bg-white text-black text-sm" onClick={props.addInstance}>
        Create
      </button>
    </div>
  );
}
