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
    <div className="h-full overflow-auto flex flex-col gap-1 text-black">
      <h3 className="p-1 bg-white/70 border rounded-md">
        <strong>{uiKey}</strong> has invalid Meta
      </h3>
      <div className="text-sm bg-white/70 border rounded-xl">
        {Object.entries(z.flattenError(zodError).fieldErrors).map(([fieldName, errorTexts]) => (
          <div key={fieldName} className="p-2 italic">
            <strong>{fieldName}:</strong>{" "}
            {errorTexts?.map((errorText) => (
              <div key={errorText} className="border p-1 overflow-auto">
                {errorText}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
