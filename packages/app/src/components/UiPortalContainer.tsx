import { uiRegistry } from "@npc-cli/ui-registry";
import { UiErrorBoundary, UiParseError, uiStore } from "@npc-cli/ui-sdk";
import { Spinner } from "@npc-cli/util";
import { Suspense } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";

export const UiPortalContainer = () => {
  const byId = useStore(uiStore, (state) => state.byId);

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
