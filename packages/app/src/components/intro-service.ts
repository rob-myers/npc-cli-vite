import { uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { revealLeafOf } from "./pane-service";

/** The SkipNet article a first visit is pointed to */
export const introArticleKey = "demo";

/** Set once the intro toast is watched or dismissed */
const introSeenKey = "intro-seen";

export function isIntroSeen() {
  try {
    return localStorage.getItem(introSeenKey) === "true";
  } catch {
    return true;
  }
}

export function setIntroSeen() {
  try {
    localStorage.setItem(introSeenKey, "true");
  } catch {}
}

/** The SkipNet to show the intro in: one whose tab can be shown, else any */
export function findIntroSkipNet() {
  const skipNets = uiStoreApi.getAllUis().filter((ui) => ui.meta.uiKey === "SkipNet");
  return skipNets.find((ui) => uiStoreApi.canFocusTab(ui.meta.id)) ?? skipNets[0] ?? null;
}

/** Shows SkipNet's tab with the intro article open. False if there is no SkipNet */
export function openIntro() {
  const skipNet = findIntroSkipNet();
  if (skipNet === null) return false;
  const { id, parentId } = skipNet.meta;
  uiStoreApi.setUiMeta(id, (draft) => {
    (draft as SkipNetOpening).opening = { kind: "article", articleKey: introArticleKey };
  });
  if (parentId !== undefined) revealLeafOf(parentId);
  uiStoreApi.focusTab(id);
  return true;
}

/** SkipNet's `meta.opening`, typed here as the app does not depend on SkipNet */
type SkipNetOpening = { opening?: { kind: "article"; articleKey: string } };
