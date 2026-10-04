import { events } from "./core";

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
 * Idle npcs back off from a walker held up beside them, to one side of its path — strafing, so they
 * keep their facing rather than turning. Runs until killed.
 * ```sh
 * demo_back_off rob kate
 * ```
 */
export async function demo_back_off({ api, args, w }: JshCli.RunArg) {
  const npcs = args.map((npcKey) => w.npc.get(npcKey));
  /** Whom each has had beside them, since when in world seconds, and where it was then */
  const beside = new Map<string, { walker: JshCli.Npc; since: number; at: JshCli.GroundPoint }>();
  const handlers = api.handleStatus({ cleanup() {} });

  /** Has `walker` been beside `npc` for `lingerSecs`, making little headway? */
  function heldUp(npc: JshCli.Npc, walker: JshCli.Npc | undefined): walker is JshCli.Npc {
    const now = w.timer.getElapsedTime();
    const prev = beside.get(npc.key);
    if (walker === undefined) {
      beside.delete(npc.key);
    } else if (prev?.walker !== walker || walker.distanceTo(prev.at) > backOffConfig.progress) {
      beside.set(npc.key, { walker, since: now, at: walker.point }); // time it afresh
    } else if (now - prev.since >= backOffConfig.lingerSecs) {
      beside.delete(npc.key);
      return true;
    }
    return false;
  }

  try {
    while (true) {
      await api.sleep(backOffConfig.sampleSecs);
      for (const npc of npcs) {
        if (w.n[npc.key] !== npc || npc.isMoving() || npc.isLooking()) continue;
        const walker = presser(w, npc);
        if (heldUp(npc, walker) === false) continue;

        const [ux, uz] = awayFrom(npc, walker);
        const { by, minMove } = backOffConfig;
        const slide = npc.getSlideResult({ x: ux * by, y: uz * by });
        if (slide?.success !== true || npc.distanceTo(slide.groundPoint) < minMove) continue;
        void w.e.move({ npcKey: npc.key, to: slide.groundPoint, strafe: true }).catch(() => {}); // a new push may interrupt
      }
    }
  } finally {
    handlers.dispose();
  }
}

/** The nearest walker beside `npc` — `neis` have `dist` squared */
function presser(w: JshCli.WorldState, npc: JshCli.Npc) {
  const [nearest] = (npc.agent?.neis ?? [])
    .filter(({ agentId, dist }) => dist < backOffConfig.dist ** 2 && w.npc.byAgentId[agentId]?.isMoving())
    .sort((a, b) => a.dist - b.dist);
  return nearest === undefined ? undefined : w.npc.byAgentId[nearest.agentId];
}

/** Unit `(x, z)` across `walker`'s path on `npc`'s side of it, else straight away from it */
function awayFrom(npc: JshCli.Npc, walker: JshCli.Npc) {
  const [vx, , vz] = walker.agent?.velocity ?? [0, 0, 0];
  const dx = npc.position.x - walker.position.x;
  const dz = npc.position.z - walker.position.z;
  const [ux, uz] = Math.hypot(vx, vz) < 0.05 ? [dx, dz] : -vz * dx + vx * dz < 0 ? [vz, -vx] : [-vz, vx];
  const length = Math.hypot(ux, uz) || 1;
  return [ux / length, uz / length] as const;
}

const backOffConfig = {
  /** Within this of a walker they back off — no further than the crowd's `collisionQueryRange` */
  dist: 0.6,
  /** A walker beside them this long, making less headway (metres), is held up — sooner than `stuckDuration` */
  lingerSecs: 0.2,
  progress: 0.15,
  /** Metres they back off by, and the least worth moving once slid along the navmesh */
  by: 0.8,
  minMove: 0.2,
  sampleSecs: 0.1,
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
 * A card over an npc, following them — see `NpcBubbles`; its close button takes it down
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
  w.bubble.openDebug(npc.key);
}

export function demo_remove_decor(ct: JshCli.RunArg) {
  ct.w.decor.remove("test-decor-circle", "test-decor-point", "test-decor-rect", "test-decor-rect-angled");
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
