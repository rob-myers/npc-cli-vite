import { useEffectNonStrict } from "@npc-cli/util";
import { useMemo } from "react";
import { type UiInstanceMeta, type UiPackageDef, UiParseError, uiStore } from ".";
import { useStore } from "zustand";

export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,
    ui({ meta }: { meta: UiInstanceMeta }) {
      const result = useMemo(() => uiDef.schema.safeParse(meta), [meta]);

      // bootstrap uiStore with parsed meta or invalid meta
      useEffectNonStrict(() => {
        uiStore.setState(
          (draft) => void (draft.metaById[meta.id] = result.success ? result.data : meta),
        );
        return () => uiStore.setState((draft) => void delete draft.metaById[meta.id]);
      }, []);

      // listen for changes
      const parsedMeta = useStore(uiStore, (s) => s.metaById[meta.id]) ?? result.data;

      return result.success ? (
        <uiDef.ui meta={parsedMeta} />
      ) : (
        <UiParseError uiKey={meta.uiKey} zodError={result.error} />
      );
    },
  };
};
