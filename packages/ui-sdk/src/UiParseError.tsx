import type { UiRegistryKey } from "@npc-cli/ui__registry";
import z from "zod";

export function UiParseError({
  uiKey,
  zodError,
}: {
  uiKey: UiRegistryKey;
  zodError: z.ZodError<Record<string, unknown>>;
}) {
  return (
    <div className="h-full flex flex-col text-black text-sm">
      <h3 className="p-1 bg-white/70 border">
        <strong>{uiKey}</strong> meta invalid
      </h3>
      <div className="overflow-auto bg-white/70 border">
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
