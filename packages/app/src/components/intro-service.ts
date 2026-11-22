import { uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { revealLeafOf } from "./pane-service";

/** The SkipNet article a first visit is pointed to */
export const introArticleKey = "demo";

/** Set once the intro toast is dismissed by its close button */
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

/** The SkipNet to open an article in: one whose tab can be shown, else any */
export function findSkipNet() {
  const skipNets = uiStoreApi.getAllUis().filter((ui) => ui.meta.uiKey === "SkipNet");
  return skipNets.find((ui) => uiStoreApi.canFocusTab(ui.meta.id)) ?? skipNets[0] ?? null;
}

/** Shows SkipNet's tab with an article or video open, centred and by default distraction-free. False if no SkipNet */
export function openArticle(articleKey: string, { distractionFree = true } = {}) {
  const skipNet = findSkipNet();
  if (skipNet === null) return false;
  const { id, parentId } = skipNet.meta;
  uiStoreApi.setUiMeta(id, (draft) => {
    (draft as SkipNetOpening).opening = { kind: "article", articleKey, distractionFree };
  });
  if (parentId !== undefined) revealLeafOf(parentId);
  uiStoreApi.focusTab(id);
  return true;
}

export function openIntro() {
  return openArticle(introArticleKey);
}

/** SkipNet's `meta.opening`, typed here as the app does not depend on SkipNet */
type SkipNetOpening = { opening?: { kind: "article"; articleKey: string; distractionFree?: boolean } };
