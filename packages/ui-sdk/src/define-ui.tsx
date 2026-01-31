import { useEffectNonStrict } from "@npc-cli/util";
import { useMemo } from "react";
import { type UiInstanceMeta, type UiPackageDef, UiParseError, uiStore } from ".";
import { useStore } from "zustand";

/**
 * - Constrain uiDef format as extension of `UiPackageDef`.
 * - Override `ui` with Zod validation.
 */
export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,
    ui({ meta }: { meta: UiInstanceMeta }) {
      const result = useMemo(() => uiDef.schema.safeParse(meta), [meta]);

      // bootstrap uiStore with parsed meta if valid, else original meta
      useEffectNonStrict(() => {
        uiStore.setState(
          (draft) => void (draft.metaById[meta.layoutId] = result.success ? result.data : meta),
        );
        return () => uiStore.setState((draft) => void delete draft.metaById[meta.layoutId]);
      }, []);

      // listen for changes
      const parsedMeta = useStore(uiStore, (s) => s.metaById[meta.layoutId]) ?? result.data;

      return result.success ? (
        <uiDef.ui meta={parsedMeta} />
      ) : (
        <UiParseError uiKey={meta.uiKey} zodError={result.error} />
      );
    },
  };
};
