import { useEffectNonStrict } from "@npc-cli/util";
import { castDraft } from "immer";
import { useMemo } from "react";
import { useStore } from "zustand";
import {
  HtmlPortalWrapper,
  type UiInstanceMeta,
  type UiPackageDef,
  UiParseError,
  uiStore,
} from ".";

export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,

    ui({ meta }: { meta: UiInstanceMeta }) {
      const result = useMemo(() => uiDef.schema.safeParse(meta), [meta]);

      // bootstrap uiStore with parsed meta or invalid meta
      useEffectNonStrict(() => {
        uiStore.setState((draft) => {
          // 🚧 move to useStoreApi
          const item = draft.byId[meta.id];
          // ⚠️ need parsed meta to render UI e.g. Tabs needs items array
          const nextMeta = result.success ? result.data : meta;
          if (item) {
            item.meta = nextMeta;
          } else {
            draft.byId[meta.id] = { meta: nextMeta, portal: castDraft(new HtmlPortalWrapper()) };
          }
        });
        // ⚠️ assume mounted in portal so can remove on unmount
        return () => uiStore.setState((draft) => void delete draft.byId[meta.id]);
      }, []);

      // listen for changes
      const parsedMeta = useStore(uiStore, (s) => s.byId[meta.id]?.meta) ?? result.data;

      return result.success ? (
        <uiDef.ui meta={parsedMeta} />
      ) : (
        <UiParseError uiKey={meta.uiKey} zodError={result.error} />
      );
    },
  };
};
