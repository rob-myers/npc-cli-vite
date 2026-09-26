import { npcQuery, plan } from "./plan.main";

/**
 * Draw an npc's local navmesh boundary — the segments `park` chooses from, as of now — in red.
 * Sans npc, takes it down.
 * ```sh
 * debug_boundary npc:rob
 * debug_boundary
 * ```
 */
export async function debug_boundary(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  if (opts.npcKey === undefined) {
    w.debug.setLocalBoundary([]);
    w.view.forceUpdate();
    return;
  }
  // exactly as `park` asks, so what is drawn is what it would see
  const segs = await plan({ api, w, op: { key: "boundary", npc: npcQuery(w, w.npc.get(opts.npcKey)) } });
  w.debug.setLocalBoundary(segs.map((s) => [s[0], s[2], s[3], s[5]]));
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
