import type { UiRegistry } from "@npc-cli/ui-registry";
import { Spinner, useEffectNonStrict } from "@npc-cli/util";
import { Suspense, useMemo } from "react";
import * as portals from "react-reverse-portal";
import { type UiInstanceMeta, uiStoreApi } from ".";
import { UiErrorBoundary } from "./UiErrorBoundary";

export function UiInstance({ meta, uiRegistry }: { meta: UiInstanceMeta; uiRegistry: UiRegistry }) {
  const def = uiRegistry[meta.uiKey];
  const portalNode = useMemo(
    () => portals.createHtmlPortalNode({ attributes: { style: portalNodeContainerStyle } }),
    [],
  );
  useEffectNonStrict(() => {
    uiStoreApi.addUiPortal(meta.id, portalNode);
    // only remove on explicitly delete tab
  }, []);

  return (
    <UiErrorBoundary meta={meta}>
      <Suspense fallback={<Spinner />}>
        <def.ui meta={meta} portalNode={portalNode} />
      </Suspense>
      <portals.OutPortal node={portalNode} />
    </UiErrorBoundary>
  );
}

const portalNodeContainerStyle = "width: 100%; height: 100%;";
