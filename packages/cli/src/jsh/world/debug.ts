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
 * A line per crowd tick for one npc, to see a rock: `avoid` or `sep` (the arriving flags), the
 * fold's side, the gap to the nearest npc, how far the target is — and the `least` it could be, given
 * who stands beside it — the first corner (NEW when it
 * changed), desired vs actual velocity
 * ```sh
 * debug_fold npc:rob
 * ```
 */
export async function* debug_fold(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  const deg = (x: number, z: number) => ((Math.atan2(z, x) * 180) / Math.PI).toFixed(0).padStart(4);
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
    const changed = corner === prevCorner ? "" : " NEW";
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
    yield [
      String(tick).padStart(4),
      (agent.updateFlags & 4) !== 0 ? "sep  " : "avoid", // SEPARATION: the arriving flags
      `fold ${String(fold).padStart(2)}`,
      `gap ${Number.isFinite(gap) ? gap.toFixed(2) : " -  "}`,
      `target ${Math.hypot(tx - agent.position[0], tz - agent.position[2]).toFixed(2)} (least ${least.toFixed(2)})`,
      `corner ${corner}${changed} at ${c === undefined ? " -  " : Math.hypot(c[0] - agent.position[0], c[2] - agent.position[2]).toFixed(2)} nearest ${Math.sqrt(agent.cornerNearestSqr).toFixed(2)}`,
      `dvel ${deg(dx, dz)} ${Math.hypot(dx, dz).toFixed(2)}`,
      `vel ${deg(vx, vz)} ${Math.hypot(vx, vz).toFixed(2)}`,
    ].join("  ");
  }
  handlers.dispose();
  throw api.getKillError();
}
