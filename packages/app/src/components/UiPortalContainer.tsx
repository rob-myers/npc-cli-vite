import { uiRegistry } from "@npc-cli/ui-registry";
import { HtmlPortalWrapper, UiErrorBoundary, UiParseError, uiStore } from "@npc-cli/ui-sdk";
import { Spinner } from "@npc-cli/util";
import { castDraft } from "immer";
import { Suspense, useEffect } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";

export const UiPortalContainer = () => {
  const toInitMeta = useStore(uiStore, (state) => state.toInitMeta);
  const byId = useStore(uiStore, (state) => state.byId);

  // make byId reflect toInitMeta
  useEffect(() => {
    uiStore.setState((draft) => {
      for (const [id, initMeta] of Object.entries(toInitMeta)) {
        if (!draft.byId[id]) {
          const def = uiRegistry[initMeta.uiKey];
          const result = def.schema.safeParse(initMeta);

          draft.byId[id] = {
            meta: result.success ? result.data : initMeta,
            portal: castDraft(new HtmlPortalWrapper()),
            zodError: result.success ? undefined : castDraft(result.error),
          };
        }
      }
      for (const [id] of Object.entries(draft.byId)) {
        if (!toInitMeta[id]) {
          delete draft.byId[id];
        }
      }
    });
  }, [toInitMeta]);

  return (
    <div className="hidden">
      {Object.values(byId).map(({ meta, portal, zodError }) => {
        const def = uiRegistry[meta.uiKey];
        return (
          <portals.InPortal key={meta.id} node={portal.portalNode}>
            <UiErrorBoundary meta={meta}>
              <Suspense fallback={<Spinner />}>
                {/* 🚧 improve type */}
                {zodError === undefined && <def.ui meta={meta as any} />}
                {zodError !== undefined && <UiParseError uiKey={meta.uiKey} zodError={zodError} />}
              </Suspense>
            </UiErrorBoundary>
          </portals.InPortal>
        );
      })}
    </div>
  );
};
