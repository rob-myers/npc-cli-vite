import type { UiBootstrapProps } from "@npc-cli/ui-sdk";

// 🚧
export default function JshBootstrap(_props: UiBootstrapProps): React.ReactNode {
  return (
    <div>
      <label>
        sessionKey
        <input type="text" placeholder="tty-0" />
      </label>
    </div>
  );
}
