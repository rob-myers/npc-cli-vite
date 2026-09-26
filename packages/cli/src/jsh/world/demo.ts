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
 * Idle npcs back off from a walker held up beside them, to one side of its path and facing it —
 * see `w.npc.move`'s `backwards`. Runs until killed.
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

        const src = npc.point;
        const [ux, uz] = awayFrom(npc, walker);
        const by = backOffConfig.by;
        const op = { key: "nudge", npc: npcQuery(w, npc), to: { x: src.x + ux * by, y: src.y + uz * by } } as const;
        const to = await plan({ api, w, op });
        if (to === null || Math.hypot(to.x - src.x, to.y - src.y) < backOffConfig.minMove) continue;

        // back onto it, unless it passed by whilst they turned
        await npc
          .look({ at: { x: 2 * src.x - to.x, y: 2 * src.y - to.y }, rate: backOffConfig.turnRate })
          .catch(() => {});
        if (walker.distanceTo(npc.point) > backOffConfig.dist) continue;
        void w.npc.move({ npcKey: npc.key, to, backwards: true }).catch(() => {}); // a new push may interrupt
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
  /** Times faster than usual they turn about */
  turnRate: 2.5,
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
  w.bubble.ensure(npc.key);
}

/**
 * The player influences one npc at a time, each fading in as the last fades out — see `Psi`. Runs until
 * killed, bar a bare `demo_psi`. Picking the player, killing it, or a bare `demo_psi`, fades it all away
 * ```sh
 * pick | demo_psi
 * demo_psi abe
 * demo_psi
 * ```
 */
export async function demo_psi({ api, args: [arg], w }: JshCli.RunArg) {
  api.setPtags({ world: false }); // switches on a pick whilst paused
  /** Whom the player influences, or `null` */
  let influenced: null | string = null;
  /** Hands to temples whilst influencing — elbows forward (`psi_avoid`) whilst they'd hit a crowd neighbour or a doorway */
  const syncHands = () => {
    const player = w.n[w.player?.key];
    const near =
      player?.agent?.neis.some(({ dist }) => dist < psiNearDist ** 2) === true || // `dist` squared
      (player !== undefined && w.e.npcToDoors[player.key]?.inside != null); // in a doorway
    const pose = influenced === null ? null : near ? "psi_avoid" : "psi";
    player?.anim.setUpper(pose, { swapSecs: near ? psiAvoidSecs : undefined });
  };
  /** The player, the default, turns it off */
  const choose = (npcKey = w.player?.key ?? null) => {
    w.psi.choose(npcKey);
    influenced = npcKey === w.player?.key ? null : npcKey;
    syncHands();
  };

  const piped = api.isTtyAt(0) === false;
  if (arg !== undefined || piped === false) choose(arg);
  if (arg === undefined && piped === false) return; // just turns it off

  /** Whom we influence, again on resume */
  let chosen = arg;
  // a kill turns it off, and ends a read that may never come; a pause turns it off till resumed
  let killed = false as boolean; // set by `cleanup`, which narrowing cannot see
  let onKill = () => {};
  const killedRead = new Promise<void>((resolve) => (onKill = resolve));
  const handlers = api.handleStatus({
    cleanup() {
      killed = true;
      choose();
      onKill();
    },
    onSuspend: () => (choose(), true),
    onResume: () => (chosen !== undefined && choose(chosen), true),
  });
  const nearId = setInterval(() => api.isRunning() && syncHands(), 100);

  try {
    let datum: unknown;
    const next = () => (piped ? Promise.race([api.read(), killedRead]) : killedRead); // named, no picks: till killed
    while ((datum = await next()) !== api.eof && killed === false) {
      const pick = datum as JshCli.PickEvent;
      const npcKey = typeof datum === "string" ? datum : pick?.meta?.type === "npc" ? pick.meta.npcKey : undefined;
      if (npcKey !== undefined && npcKey in w.n) choose((chosen = npcKey));
    }
  } finally {
    clearInterval(nearId);
    handlers.dispose();
  }
  if (killed === true) throw api.getKillError();
}

/** Metres within which a crowd neighbour brings the player's elbows forward — inside `collisionQueryRange` */
const psiNearDist = 0.65;
/** Seconds the player's elbows take to come forward */
const psiAvoidSecs = 0.3;

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

/**
 * `npcKey` points (upper body) whilst `q` over the world toggles it on, drawing in to `defensive` for at
 * least `holdSecs` whenever the arm would touch a crowd neighbour, a wall or a closed door. Their `Sword`
 * locks on to the npc picked last whilst nothing is between them; picking `npcKey` unlocks it
 * ```sh
 * pick | demo_sword rob
 * ```
 */
export async function demo_sword({ api, args: [npcKey], w }: JshCli.RunArg) {
  const npc = w.npc.get(npcKey);
  /** The npc picked last, bar themself */
  let target: null | string = null;
  let [on, holdUntil] = [false, 0]; // world seconds they stay defensive until
  const defensive = () => holdUntil > w.timer.getElapsedTime();
  const show = () => {
    const pose = on ? (defensive() ? "defensive" : "point") : null;
    npc.anim.setUpper(pose, { swapSecs: defensive() ? demoSwordConfig.drawInSecs : undefined }); // in before the hand goes through
    if (pose !== "point") w.sword.sheathe(npc.key);
  };
  const onKey = (e: KeyboardEvent) => void (e.key === "q" && api.isRunning() && ((on = !on), show()));
  w.rootEl.addEventListener("keydown", onKey);
  // a pause leaves it drawn, as the world is
  const handlers = api.handleStatus({
    cleanup: () => (
      w.rootEl.removeEventListener("keydown", onKey), (on = false), show(), (npc.anim.face.fixate = null)
    ),
  });

  const readPicks = async () => {
    for (let datum = await api.read(); datum !== api.eof; datum = await api.read()) {
      const pick = datum as JshCli.PickEvent;
      const key = typeof datum === "string" ? datum : pick?.meta?.type === "npc" ? pick.meta.npcKey : undefined;
      if (key !== undefined && key in w.n) target = key === npc.key ? null : key;
    }
  };
  if (api.isTtyAt(0) === false) readPicks().catch(() => {}); // a kill ends it

  try {
    while (true) {
      npc.anim.face.fixate = (target !== null && w.n[target]?.point) || null; // they face whom they'd strike, moving or not
      if (on && (await armBlocked(w, npc))) holdUntil = w.timer.getElapsedTime() + demoSwordConfig.holdSecs;
      show();
      const locked = on && (await inSight(w, npc, target));
      if (on && !defensive()) w.sword.aim(npc.key, locked ? target : null); // `on` again: killed meanwhile?
      await api.sleep(demoSwordConfig.sampleSecs); // a kill rejects it
    }
  } finally {
    handlers.dispose();
  }
}

/** Is a crowd neighbour in front of `npc`, or a wall or closed door within `reach`? */
async function armBlocked(w: JshCli.WorldState, npc: JshCli.Npc) {
  const [fx, fz] = [-Math.sin(npc.rotation.y), -Math.cos(npc.rotation.y)]; // facing
  const { x, z } = npc.position;
  const npcAhead = (npc.agent?.neis ?? []).some(({ agentId }) => {
    const { x: ox, z: oz } = w.npc.byAgentId[agentId]?.position ?? { x, z };
    return (ox - x) * fx + (oz - z) * fz > Math.abs((ox - x) * fz - (oz - z) * fx); // within 45° of facing
  });
  if (npcAhead) return true;
  const hand = { x: x + fx * demoSwordConfig.reach, y: z + fz * demoSwordConfig.reach };
  const { hit } = await w.e.raycast(npc.point, hand).catch(() => ({ hit: true })); // off the map throws
  return hit !== null;
}

/** Is neither a wall nor a closed door between `npc` and `targetKey`? */
async function inSight(w: JshCli.WorldState, npc: JshCli.Npc, targetKey: null | string) {
  const other = targetKey === null ? undefined : w.n[targetKey];
  if (other === undefined) return false;
  const { hit } = await w.e.raycast(npc.point, other.point).catch(() => ({ hit: true })); // off the map throws
  return hit === null;
}

const demoSwordConfig = {
  /** Metres ahead a wall or closed door blocks — beyond the arm, so it is drawn in in time */
  reach: 1,
  /** Seconds they stay defensive at least — longer whilst something stays in reach */
  holdSecs: 0.5,
  drawInSecs: 0.15,
  sampleSecs: 0.1,
};
