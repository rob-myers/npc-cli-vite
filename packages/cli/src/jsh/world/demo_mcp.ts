/**
 * Each npc as plain data, or just those named
 * ```sh
 * npcs
 * npcs rob kate
 * ```
 */
export function npcs({ args, w }: JshCli.RunArg) {
  return (args.length > 0 ? args : Object.keys(w.n)).flatMap((key) => {
    const npc = w.n[key];
    if (npc === undefined) return [];
    return {
      key,
      point: { x: npc.point.x, y: npc.point.y },
      grKey: w.npc.npcToRoom.get(key)?.grKey ?? null,
      player: w.player?.key === key,
    };
  });
}

/**
 * The runtime decor points keyed `prefix…`, in key order: a route editable in the Decorator
 * ```sh
 * route patrol-bot2- | map key
 * ```
 */
export async function* route({ args: [prefix], w }: JshCli.RunArg) {
  if (!prefix) throw Error("usage: route {keyPrefix}");
  yield* routePoints(w, prefix);
}

/**
 * The `route` points in turn, forever, each until `npcKey` stops moving — again whenever the one
 * they head for is edited, e.g. dragged in the Decorator
 * ```sh
 * patrol_route bot2 patrol-bot2- | move bot2 &
 * ```
 */
export async function* patrol_route({ api, args: [npcKey, prefix], w }: JshCli.RunArg) {
  if (!npcKey || !prefix) throw Error("usage: patrol_route {npcKey} {keyPrefix}");
  const events = api.observableToAsyncIterable(w.events);
  const handlers = api.handleStatus({ cleanup: () => void events.return?.() });

  try {
    for (let i = 0; ; ) {
      const points = routePoints(w, prefix);
      if (points.length === 0) throw Error(`no runtime decor points keyed ${prefix}…`);
      const decorKey = points[i % points.length].key;
      yield points[i % points.length];

      while (true) {
        const { done, value: e } = await events.next();
        if (done) throw api.getKillError();
        if (e.key === "stopped-moving" && e.npcKey === npcKey) {
          i++;
          break;
        }
        if ((e.key === "decor-created" || e.key === "decor-removed") && e.decorKeys.includes(decorKey)) break;
      }
    }
  } finally {
    handlers.dispose();
  }
}

function routePoints(w: JshCli.WorldState, prefix: string) {
  return Object.values(w.decor.runtime.byKey)
    .filter((d) => d.type === "point" && d.key.startsWith(prefix))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}
