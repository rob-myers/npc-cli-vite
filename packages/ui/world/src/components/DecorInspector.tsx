import { useContext, useEffect } from "react";
import { DecorCard } from "./DecorCard";
import { WorldContext } from "./world-context";

/**
 * Decorating, i.e. whilst the debug **Decorations** toggle is on: every runtime decor is labelled, and a
 * right-click on one (any pick, on touch) opens its card — see `docs/decorator.md`. The World's own, so it needs no terminal
 */
export function DecorInspector() {
  const w = useContext(WorldContext);

  useEffect(() => {
    const idOf = (decorKey: string) => `${prefix}${decorKey}`;
    const ours = (id: string) => id.startsWith(prefix);

    function anchorOf(decorKey: string) {
      const d = w.decor.runtime.byKey[decorKey];
      if (d === undefined) return null;
      const { x, y } = d.type === "point" ? d : d.center;
      const { gmId, roomId } = d.meta;
      return {
        x,
        y,
        y3d: typeof d.meta.y === "number" ? d.meta.y : 0,
        text: String(d.meta.label ?? d.key),
        // fades with the room, as the decor itself does
        gmRoomId:
          typeof gmId === "number" && typeof roomId === "number" && roomId >= 0
            ? { gmId, roomId, grKey: d.meta.grKey }
            : undefined,
      };
    }

    function showCard(decorKey: string) {
      const at = anchorOf(decorKey);
      if (at === null) return;
      w.labels.remove(idOf(decorKey)); // the card stands in for the label whilst it is up
      w.html.show(
        idOf(decorKey),
        { ...at, y3d: at.y3d + cardLift },
        <DecorCard w={w} decorKey={decorKey} onRenamed={showCard} />,
        { onHide: () => syncLabels(), focus: true },
      );
    }

    /** A label per runtime decor, bar those whose card is up; and no card without its decor */
    function syncLabels() {
      const decorKeys = Object.keys(w.decor.runtime.byKey);
      w.labels.remove(...[...w.labels.byKey.keys()].filter(ours));
      w.html.hide(...[...w.html.byKey.keys()].filter((id) => ours(id) && !decorKeys.includes(id.slice(prefix.length))));
      for (const decorKey of decorKeys) {
        const at = anchorOf(decorKey);
        if (at !== null && w.html.byKey.has(idOf(decorKey)) === false) w.labels.add(idOf(decorKey), at);
      }
    }

    syncLabels();
    const sub = w.events.subscribe({
      next(e) {
        if (e.key === "decor-created" || e.key === "map-settled") {
          syncLabels();
          // an edit re-creates the decor: its card follows
          if (e.key === "decor-created") {
            for (const decorKey of e.decorKeys) w.html.byKey.has(idOf(decorKey)) && showCard(decorKey);
          }
        }
        // not at once: `create` removes the decor it replaces first, and its card must outlive that
        if (e.key === "decor-removed") queueMicrotask(syncLabels);
        // a right-click, so that a plain one stays a pick for e.g. `pick | move`. Touch has no such
        // thing, so there any pick does
        const toggles = e.key === "picked" && (e.rightDown === true || w.touchDevice === true);
        if (toggles && e.key === "picked" && e.meta.type === "decor" && e.meta.decorKey in w.decor.runtime.byKey) {
          const id = idOf(e.meta.decorKey);
          w.html.byKey.has(id) ? w.html.hide(id) : showCard(e.meta.decorKey);
        }
      },
    });

    return () => {
      sub.unsubscribe();
      w.html.hide(...[...w.html.byKey.keys()].filter(ours));
      w.labels.remove(...[...w.labels.byKey.keys()].filter(ours));
    };
  }, []);

  return null;
}

/** Of our labels and cards, which share `w.labels` and `w.html` with others */
const prefix = "decor:";
/** How far over its decor a card sits */
const cardLift = 0.6;
