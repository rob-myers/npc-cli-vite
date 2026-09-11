import { sharedFolder } from "../../shell/session";

/**
 * A per-map object kept at `/shared/map/{mapKey}/{key}` and aliased as `/shared/{key}` for
 * whichever map is current — one object, two paths — with a world-event handler for it at
 * `/shared/event/{key}`, replaced on HMR. See `pred.ts`
 */
export function sharedMapSlot<T extends object>(key: string, init: () => T) {
  type Handler = (e: JshCli.Event, w: JshCli.WorldState) => void;
  return {
    /** `/shared/{key}`, whichever map's it currently is */
    get: () => sharedFolder[key] as T,
    /**
     * Ensure `/shared/map/{mapKey}/{key}` and point `/shared/{key}` at it. Field by field, so an
     * object persisted before a field existed gains it rather than being thrown away
     */
    restore(mapKey: string): T {
      const map = (sharedFolder.map ??= {}) as Record<string, Record<string, Record<string, unknown>>>;
      const entry = (map[mapKey] ??= {});
      const slot = (entry[key] ??= {});
      for (const [field, value] of Object.entries(init())) {
        slot[field] ??= value;
      }
      return (sharedFolder[key] = slot as T);
    },
    setHandler(handler: Handler) {
      ((sharedFolder.event ??= {}) as Record<string, Handler>)[key] = handler;
    },
    /** Runs the current `/shared/event/{key}` — stable, so a listener added once follows HMR */
    handle: (e: JshCli.Event, w: JshCli.WorldState) =>
      (sharedFolder.event as undefined | Record<string, Handler>)?.[key]?.(e, w),
  };
}
