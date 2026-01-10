import { themeApi } from "@npc-cli/theme";
import { UiContext } from "@npc-cli/ui-sdk";
import { useContext } from "react";

export function Global() {
  const { theme } = useContext(UiContext);

  return (
    <div className="h-full border p-4 flex items-center justify-center">
      <button
        type="button"
        className="cursor-pointer border rounded px-4 py-1 bg-button"
        onPointerDown={themeApi.setOther}
      >
        {theme}
      </button>
    </div>
  );
}
