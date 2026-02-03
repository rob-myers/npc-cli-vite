import { uiRegistry } from "@npc-cli/ui-registry";
import { UiErrorBoundary, UiParseError, uiStore } from "@npc-cli/ui-sdk";
import { Spinner } from "@npc-cli/util";
import type React from "react";
import { Suspense } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";

export const UiPortalContainer = () => {
  const byId = useStore(uiStore, (state) => state.byId);

  return (
    <div className="hidden">
      {Object.values(byId).map(({ meta, portal, zodError }) => {
        const C = uiRegistry[meta.uiKey].ui as React.ComponentType<{ meta: typeof meta }>;
        // 🚧 safeParse here too
        return (
          <portals.InPortal key={meta.id} node={portal.portalNode}>
            <UiErrorBoundary meta={meta}>
              <Suspense fallback={<Spinner />}>
                {zodError === undefined ? (
                  <C meta={meta} />
                ) : (
                  <UiParseError uiKey={meta.uiKey} zodError={zodError} />
                )}
              </Suspense>
            </UiErrorBoundary>
          </portals.InPortal>
        );
      })}
    </div>
  );
};
