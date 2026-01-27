import type { UiProps } from "@npc-cli/ui-sdk";
import { useStateRef } from "@npc-cli/util";
import { WorldContext } from "./world-context";

export default function World(_props: UiProps) {
  const state = useStateRef<State>(() => ({
    // 🚧 derived from props
    key: "world-0",
    disabled: false,
  }));

  return (
    <WorldContext.Provider value={state}>
      <div className="overflow-auto size-full flex justify-center items-center">
        <div className="bg-white/80 text-black/70 rounded px-4 py-2 text-center leading-4 transition-transform hover:scale-125 cursor-pointer">
          World Component
        </div>
      </div>
    </WorldContext.Provider>
  );
}

export type State = {
  key: `world-${number}`;
  disabled: boolean;
};
