import type { UiRegistryKey } from "@npc-cli/ui__registry";
import z from "zod";

export function UiError({
  uiKey,
  zodError,
}: {
  uiKey: UiRegistryKey;
  zodError: z.ZodError<Record<string, unknown>>;
}) {
  return (
    <div className="h-full overflow-auto flex flex-col gap-2 justify-center items-center bg-red-300 text-black font-mono">
      <h3 className="p-1">@{uiKey}: Invalid Meta</h3>
      <div className="text-sm bg-white/50">
        {Object.entries(z.flattenError(zodError).fieldErrors).map(([fieldName, errorTexts]) => (
          <div key={fieldName} className="border p-2 italic">
            <strong>{fieldName}:</strong>{" "}
            {errorTexts?.map((errorText) => (
              <div key={errorText} className="border p-1">
                {errorText}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
