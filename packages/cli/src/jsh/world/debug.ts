import { getFirstUnknownNaked } from "./core";
import { npcQuery, plan } from "./plan.main";

/**
 * Draw an npc's local navmesh boundary — the segments `park` chooses from, as of now — in red.
 * Sans npc, takes it down.
 * ```sh
 * debug_boundary npc:rob
 * debug_boundary rob
 * debug_boundary
 * ```
 */
export async function debug_boundary(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts);
  w.debug.setLocalBoundary(
    opts.npcKey === undefined
      ? []
      : (await plan({ api, w, op: { key: "boundary", npc: npcQuery(w, w.npc.get(opts.npcKey)) } })).map(
          ([x, , z, x1, , z1]) => [x, z, x1, z1],
        ),
  );
  w.view.forceUpdate();
}

/**
 * Draw an npc's corners — the crowd's steering waypoints, `agent.corners` — in blue, redrawn
 * whenever they change, until killed. Sans npc, takes it down.
 * ```sh
 * debug_corners npc:rob
 * debug_corners
 * ```
 */
export async function debug_corners(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const clear = () => {
    w.debug.removePolyline("corners");
    w.view.forceUpdate();
  };
  if (opts.npcKey === undefined) return clear();
  const npc = w.npc.get(opts.npcKey);

  /** The corners as drawn, flattened `[x, z, ...]`, so any change is one comparison */
  let drawn = [] as number[];

  const unsubscribe = w.e.addFrameCallback(() => {
    if (api.isRunning() === false) return;
    const cs = npc.agent?.corners ?? [];
    const next = cs.flatMap(({ position }) => [position[0], position[2]]);
    if (next.length === drawn.length && next.every((x, i) => x === drawn[i])) return;
    drawn = next;
    // drawn as a disc per corner, joined 1st to 2nd, 2nd to 3rd etc: the leg from the npc is
    // omitted, it would move every frame
    w.debug.setPolyline("corners", {
      points: cs.map(({ position }) => [position[0], position[2]]),
      color: "dodgerblue",
    });
  });

  const handlers = api.handleStatus({
    cleanup() {
      unsubscribe();
      clear();
    },
  });

  try {
    w.view.forceUpdate(); // a walker's frames come anyway, a stuck one's do not
    await api.sleep(Number.POSITIVE_INFINITY); // until killed
  } finally {
    handlers.dispose();
  }
}

/**
 * Spawn an npc per skin in a circle about an npc, facing them, each named after its skin sans hyphens.
 * `prefix` (or `pre`) keeps those whose key begins with it. `r` is at least 1. Yields any skin that found no place.
 * ```sh
 * debug_skins rob
 * debug_skins rob r:1.5 prefix:scp-
 * debug_skins npc:rob r:2 pre:mtf
 * ```
 */
export async function* debug_skins(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string; r?: number; prefix?: string; pre?: string } = api.jsArg(args, {
    npc: "npcKey",
  }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const { x: cx, z: cz } = w.npc.get(opts.npcKey).position;
  const r = opts.r ?? 1.6;
  if (!(r >= 1)) throw Error("r must be at least 1");
  const prefix = opts.prefix ?? opts.pre ?? "";
  const keys = w.npc.skin.entries.map((e) => e.key).filter((key) => key.startsWith(prefix));
  const failed = await w.e.spawnMany({
    ats: keys.map((_, i) => {
      const angle = (2 * Math.PI * i) / keys.length;
      return { x: cx + r * Math.cos(angle), y: cz + r * Math.sin(angle) };
    }),
    keys,
    skins: keys,
    looks: keys.map(() => ({ x: cx, y: cz })),
    verify: true,
  });
  for (const { npcKey, error } of failed) yield `${npcKey}: ${error}`;
}

/**
 * Casts rays from an npc along their aim, else their facing: a `band` of parallel rays, or a `fan` from one point.
 * The rays overlay draws them a moment, even when off. Prints what stopped each.
 * ```sh
 * rays band rob count:3 width:0.3
 * rays fan rob count:5 spread:20 len:8
 * ```
 */
export async function* rays(
  ct: JshCli.RunArg,
  opts: { count?: number; width?: number; spread?: number; len?: number } = ct.api.jsArg(ct.args),
) {
  const { args, w } = ct;
  const [kind, npcKey] = args.filter((arg) => !arg.includes(":") && !arg.startsWith("-"));
  if (kind !== "band" && kind !== "fan") throw Error("expected band or fan");
  const npc = w.npc.get(npcKey);
  const aim = w.phasers?.aimOf(npc.key) ?? {
    from: { x: npc.position.x, y: npc.position.z },
    bearing: npc.rotation.y,
    y: 1.1,
  };
  const { count = kind === "band" ? 3 : 5, width = 0.3, spread = 20, len = 8 } = opts;
  const along = (bearing: number) => ({ x: -Math.sin(bearing), y: -Math.cos(bearing) });
  const dir = along(aim.bearing);

  const segs = Array.from({ length: count }, (_, i) => {
    /** `-0.5` to `0.5` across them */
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    if (kind === "fan") {
      const way = along(aim.bearing + (t * spread * Math.PI) / 180);
      return { src: aim.from, dst: { x: aim.from.x + way.x * len, y: aim.from.y + way.y * len }, y: aim.y };
    }
    const src = { x: aim.from.x - dir.y * t * width, y: aim.from.y + dir.x * t * width };
    return { src, dst: { x: src.x + dir.x * len, y: src.y + dir.y * len }, y: aim.y };
  });
  const shown = w.debug.raysShown;
  w.debug.raysShown = true; // drawn even with the overlay off
  const results = await w.e.raycasts(segs, { offMap: true, key: `jsh/${npc.key}` }).finally(() => {
    w.debug.raysShown = shown;
  });
  for (const [i, result] of results.entries()) {
    if (result === null) yield `${i}: not cast`;
    else if (result.hit === null) yield `${i}: clear, ${result.debug?.crossings.length ?? 0} crossed`;
    else {
      const m = Math.hypot(result.hit.x - segs[i].src.x, result.hit.y - segs[i].src.y).toFixed(2);
      yield `${i}: ${result.hitDoor ?? "wall"} at ${m}m, ${result.debug?.crossings.length ?? 0} crossed`;
    }
  }
}

/**
 * A line per crowd tick of an npc's agent, until killed — terse, for a thin tty:
 * `tick avo|sep f{fold} g{gap} t{target}/{least} c{x},{z}[*new] {corner dist}/{nearest} dv{deg}@{speed} v{deg}@{speed} m{max}`
 * ```sh
 * debug_agent npc:rob
 * ```
 */
export async function* debug_agent(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  const deg = (x: number, z: number) => ((Math.atan2(z, x) * 180) / Math.PI).toFixed(0);
  const num = (x: number, digits = 1) => x.toFixed(digits).replace(/^(-?)0\./, "$1."); // `.5` not `0.5`
  const { GreyDark: dim, Reset: reset, Yellow, GreenDark, Purple, Red, Cyan } = api.ansi;
  const paint = (color: string, text: string | number) => `${color}${text}${reset}`;
  const label = (key: string, value: string) => `${paint(dim, key)}${value}`; // dim labels, plain values
  let prevCorner = "";
  // a kill must end the wait too: no tick comes whilst the world is paused
  let kill = () => {};
  const killed = new Promise<"killed">((resolve) => (kill = () => resolve("killed")));
  const handlers = api.handleStatus({ cleanup: kill });

  for (let tick = 0; ; tick++) {
    if ((await Promise.race([w.npc.nextTick(), killed])) === "killed") break;
    const agent = npc.agent;
    if (agent === null) continue;
    const gap = Math.min(
      ...agent.neis.map((n) => Math.sqrt(n.dist) - agent.radius - w.npc.crowd.agents[n.agentId].radius),
    );
    const c = agent.corners[0]?.position;
    const corner = c === undefined ? "none" : `${c[0].toFixed(2)},${c[2].toFixed(2)}`;
    const changed = corner === prevCorner ? "" : paint(Cyan, "*");
    prevCorner = corner;
    const [dx, , dz] = agent.desiredVelocity;
    const [vx, , vz] = agent.velocity;
    const [tx, , tz] = agent.targetPosition;
    // the nearest they can get to the target with someone beside it: over `arrive`, it is unreachable
    const least = Math.max(
      0,
      ...agent.neis.map(({ agentId }) => {
        const nei = w.npc.crowd.agents[agentId];
        return agent.radius + nei.radius - Math.hypot(tx - nei.position[0], tz - nei.position[2]);
      }),
    );
    const fold = (agent.obstacleAvoidanceQuery as { foldSide?: number }).foldSide ?? 0;
    const [ax, , az] = agent.position;
    yield [
      paint(dim, tick),
      (agent.updateFlags & 4) !== 0 ? paint(Yellow, "sep") : paint(GreenDark, "avo"), // SEPARATION: the arriving flags
      label("f", fold === 0 ? "0" : paint(Purple, fold)),
      label("g", !Number.isFinite(gap) ? "-" : gap < 0.05 ? paint(Red, num(gap, 2)) : num(gap, 2)), // touching
      label("t", `${num(Math.hypot(tx - ax, tz - az))}/${num(least)}`),
      label("c", c === undefined ? "-" : `${num(c[0])},${num(c[2])}${changed}`),
      paint(
        dim,
        `${c === undefined ? "-" : num(Math.hypot(c[0] - ax, c[2] - az))}/${num(Math.sqrt(agent.cornerNearestSqr))}`,
      ),
      label("dv", `${deg(dx, dz)}@${num(Math.hypot(dx, dz))}`),
      label("v", `${deg(vx, vz)}@${num(Math.hypot(vx, vz))}`),
      label("m", num(agent.maxSpeed)),
    ].join(" ");
  }
  handlers.dispose();
  throw api.getKillError();
}
