import { useEffectNonStrict } from "@npc-cli/util";
import { useMemo } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import { type UiInstanceMeta, type UiPackageDef, UiParseError, uiStore } from ".";

// This named type export fixes:
// > The inferred type of 'default' cannot be named without a reference to '../../../ui-sdk/node_modules/react-reverse-portal/dist'. This is likely not portable. A type annotation is necessary.ts(2742)
export type HtmlPortalNode = portals.HtmlPortalNode;

export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return {
    ...uiDef,

    ui({ meta, portalNode }: { meta: UiInstanceMeta; portalNode?: HtmlPortalNode }) {
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

      if (!result.success) {
        return <UiParseError uiKey={meta.uiKey} zodError={result.error} />;
      }

      return portalNode ? (
        <portals.InPortal node={portalNode}>
          <uiDef.ui meta={parsedMeta} />
        </portals.InPortal>
      ) : (
        <uiDef.ui meta={parsedMeta} />
      );
    },
  };
};
