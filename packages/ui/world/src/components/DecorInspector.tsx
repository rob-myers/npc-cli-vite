import { useContext, useEffect } from "react";
import { WorldContext } from "./world-context";

/** Decorating, i.e. whilst the debug **Decorations** toggle is on: every runtime decor is labelled. See `docs/decorator.md` */
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

    /** A label per runtime decor */
    function syncLabels() {
      w.labels.remove(...[...w.labels.byKey.keys()].filter(ours));
      for (const decorKey of Object.keys(w.decor.runtime.byKey)) {
        const at = anchorOf(decorKey);
        if (at !== null) w.labels.add(idOf(decorKey), at);
      }
    }

    syncLabels();
    const sub = w.events.subscribe({
      next(e) {
        if (e.key === "decor-created" || e.key === "map-settled") syncLabels();
        // not at once: `create` removes the decor it replaces first
        if (e.key === "decor-removed") queueMicrotask(syncLabels);
      },
    });

    return () => {
      sub.unsubscribe();
      w.labels.remove(...[...w.labels.byKey.keys()].filter(ours));
    };
  }, []);

  return null;
}

/** Of our labels, which share `w.labels` with others */
const prefix = "decor:";
