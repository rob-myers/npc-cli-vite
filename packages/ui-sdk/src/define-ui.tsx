import { type UiInstanceMeta, type UiPackageDef, UiParseError } from ".";

/**
 * - Constrain uiDef format as extension of `UiPackageDef`.
 * - Override `ui` with Zod validation.
 */
export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,
    ui({ meta }: { meta: UiInstanceMeta }) {
      const result = uiDef.schema.safeParse(meta);
      if (!result.success) {
        return <UiParseError uiKey={meta.uiKey} zodError={result.error} />;
      }
      return <uiDef.ui meta={result.data} />;
    },
  };
};
