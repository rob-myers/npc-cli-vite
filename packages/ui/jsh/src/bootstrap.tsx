import type { UiBootstrapProps } from "@npc-cli/ui-sdk";

// 🚧
export default function JshBootstrap(props: UiBootstrapProps): React.ReactNode {
  return (
    <div className="border flex w-full bg-black text-white">
      <label className="flex">
        <input type="text" className="w-full p-1 border border-black/30" placeholder="sessionKey" />
      </label>
      <button type="button" className="p-2  text-sm" onClick={props.addInstance}>
        Create
      </button>
    </div>
  );
}
