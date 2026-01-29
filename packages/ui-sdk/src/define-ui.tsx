import { useMemo } from "react";
import { type UiInstanceMeta, type UiPackageDef, UiParseError } from ".";

/**
 * - Constrain uiDef format as extension of `UiPackageDef`.
 * - Override `ui` with Zod validation.
 */
export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,
    ui({ meta }: { meta: UiInstanceMeta }) {
      const result = useMemo(() => uiDef.schema.safeParse(meta), [meta]);
      return result.success ? (
        <uiDef.ui meta={result.data} />
      ) : (
        <UiParseError uiKey={meta.uiKey} zodError={result.error} />
      );
    },
  };
};
