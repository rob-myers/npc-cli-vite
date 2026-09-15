import { events } from "./core";
import { npcQuery, plan } from "./plan.main";

export function demo_add_decor(ct: JshCli.RunArg) {
  const _decorCircle = ct.w.decor.create({
    type: "circle",
    key: "test-decor-circle",
    center: { x: 2.5, y: 2.5 },
    radius: 1.5,
    meta: { shown: true, collider: true },
  });

  const _decorPoint = ct.w.decor.create({
    type: "point",
    key: "test-decor-point",
    x: 4.5,
    y: 7.5,
    img: "icon--warn",
    orient: 0,
    y3d: 0.01,
    meta: { shown: true, collider: true },
  });

  const _decorRect = ct.w.decor.create({
    type: "rect",
    key: "test-decor-rect",
    x: 3,
    y: 7.5,
    width: 2 * 1.5,
    height: 1 * 1.5,
    meta: { foo: "bar", shown: true, collider: true },
  });

  const _angledDecorRect2 = ct.w.decor.create({
    type: "rect",
    key: "test-decor-rect-angled",
    x: 3,
    y: 5,
    width: 2 * 1.5,
    height: 1 * 1.5,
    angle: (Math.PI / 2) * 1,
    meta: { foo: "bar", shown: true, collider: true },
  });

  ct.w.view.forceUpdate();
}

/** The process no longer exists when we attempt to resolve */
export function demo_bad_resolve({ api }: JshCli.RunArg) {
  setTimeout(() => {
    api.get("/shared");
  }, 1000);
}

/**
 * Draw an npc's corners — the crowd's steering waypoints, `[position, ...agent.corners]` — in
 * blue, following them ten times a second until killed. Sans npc, takes it down.
 * ```sh
 * demo_corners npc:rob
 * demo_corners
 * ```
 */
export async function demo_corners(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const clear = () => {
    w.debug.setCorners([]);
    w.view.forceUpdate();
  };
  if (opts.npcKey === undefined) return clear();
  const npc = w.npc.get(opts.npcKey);
  const handlers = api.handleStatus({ cleanup: clear });

  try {
    while (true) {
      const ps = npc.getCornersPath() ?? [];
      w.debug.setCorners(ps.slice(1).map((p, i) => [ps[i].x, ps[i].y, p.x, p.y]));
      w.view.forceUpdate(); // a walker's frames come anyway, a stuck one's do not
      await api.sleep(1 / 60);
    }
  } finally {
    handlers.dispose();
  }
}

/**
 * Draw an npc's local navmesh boundary — the segments `park` chooses from, as of now — in red.
 * Sans npc, takes it down.
 * ```sh
 * demo_local_boundary npc:rob
 * demo_local_boundary
 * ```
 */
export async function demo_local_boundary(
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
 * A breathing npc leans back (`idle-avoid`) whilst a walker passes within reach, glancing their
 * way, and slumps back once none has for a while. Sampled every half second; runs until killed.
 * ```sh
 * demo_lean_back npc:rob
 * ```
 */
export async function demo_lean_back(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  const { anim } = npc;
  /** When the lean began, and their facing then, which the glance is clamped about */
  let since = 0;
  let baseY = 0;

  const slump = () => {
    anim.face.rate = 0;
    if (anim.pose === "idle-avoid") anim.setPose("breathe");
  };
  const handlers = api.handleStatus({ cleanup: slump });

  try {
    while (true) {
      await api.sleep(leanConfig.sampleSecs);
      if (npc.agent === null || npc.isMoving() || npc.isLooking() || anim.idleClip !== npc.clips.breathe) continue;
      const now = w.timer.getElapsedTime();
      const leaning = anim.pose === "idle-avoid";

      // the nearest walker within reach — `neis` are within `collisionQueryRange`, `dist` squared
      const [nearest] = npc.agent.neis
        .filter(({ agentId, dist }) => dist < leanConfig.dist ** 2 && w.npc.byAgentId[agentId]?.isMoving())
        .sort((a, b) => a.dist - b.dist);
      if (nearest === undefined) {
        if (leaning === true && now - since >= leanConfig.minSecs) slump();
        continue;
      }
      if (leaning === false) {
        [since, baseY] = [now, npc.rotation.y];
        anim.setPose("idle-avoid");
      }

      // glance at them, no further than `turnMax` from where they faced
      const walker = w.npc.byAgentId[nearest.agentId];
      const toWalker = Math.atan2(walker.position.x - npc.position.x, walker.position.z - npc.position.z) + Math.PI;
      const turn = Math.atan2(Math.sin(toWalker - baseY), Math.cos(toWalker - baseY));
      Object.assign(anim.face, {
        target: baseY + Math.max(-leanConfig.turnMax, Math.min(leanConfig.turnMax, turn)),
        rate: leanConfig.turnScale,
      });
    }
  } finally {
    handlers.dispose();
  }
}

const leanConfig = {
  /** Within this of a walker they lean — no further than the crowd's `collisionQueryRange` */
  dist: 0.5,
  /** How often they look for one, and the least time they stay leant */
  sampleSecs: 0.5,
  minSecs: 2,
  /** How far they glance either way, and how fast — against a walker's own turn of `1` */
  turnMax: (30 * Math.PI) / 180,
  turnScale: 0.5,
};

export async function* demo_log_speech(ct: JshCli.RunArg) {
  for await (const e of events(ct, {
    where: (e) => e.key === "speech",
  })) {
    // console.log({ e });
    yield `${ct.api.ansi.Blue}${e.npcKey}${ct.api.ansi.Reset}: ${e.words}`;
  }
}

/**
 * ```sh
 * demo_npc_ui npc:rob
 * demo_npc_ui rob
 * ```
 */
export function demo_npc_ui(
  { w, api, args }: JshCli.RunArg,
  opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey ?? args[0]);
  w.bubble.ensure(npc.key);
}

export function demo_remove_decor(ct: JshCli.RunArg) {
  ct.w.decor.remove("test-decor-circle", "test-decor-point", "test-decor-rect", "test-decor-rect-angled");
}

export function demo_selector(
  { api, args, w }: JshCli.RunArg,
  opts: { path: string; prevPath: string } = api.jsArg(args),
) {
  const npc = w.n[api.get(opts.path, true)];
  npc.setRing(npc.hasRing() ? undefined : "#99f");
  const prevNpc = w.n[api.get(opts.prevPath, true)];
  if (npc !== prevNpc) prevNpc?.setRing();
  api.set(opts.prevPath, npc.key);
}

export async function demo_spawn_many({ w }: JshCli.RunArg) {
  const pointsWithMeta = [] as WithMeta<JshCli.GroundPoint>[];
  for (const [_gmId, gmRooms] of w.decor.byRoom.entries()) {
    for (const [_roomId, roomDecor] of gmRooms.entries()) {
      roomDecor?.forEach((decor) => {
        if (
          decor.type === "point" &&
          (decor.meta.do === "lie" || decor.meta.do === "sit" || decor.meta.do === "stand")
        ) {
          pointsWithMeta.push({ x: decor.x, y: decor.y, meta: { ...decor.meta } });
        }
      });
    }
  }

  // random skins
  const skinKeys = w.npc.skin.entries.map((x) => x.key);
  const skinCount = skinKeys.length;

  await w.e.spawnMany({
    baseKey: "npc",
    ats: pointsWithMeta,
    skins: pointsWithMeta.map(() => skinKeys[Math.floor(skinCount * Math.random())]),
  });
}
