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
 * The player influences one npc at a time, each fading in as the last fades out — see `Psi`.
 * Picking the player, killing this, or no npc with nothing piped in, fades it all away
 * ```sh
 * pick | demo_psi
 * demo_psi rob
 * demo_psi
 * ```
 */
export async function demo_psi({ api, args: [arg], w }: JshCli.RunArg) {
  /** The player, the default, turns it off */
  const choose = (npcKey = w.player?.key ?? null) => {
    w.psi.choose(npcKey);
    const player = w.n[w.player?.key];
    player?.anim.setUpper(npcKey === player.key ? null : "psi"); // hands to temples whilst it shows
  };

  if (arg !== undefined || api.isTtyAt(0)) choose(arg);
  if (api.isTtyAt(0)) return;

  // a kill turns it off, and ends a read that may never come
  let killed = false as boolean; // set by `cleanup`, which narrowing cannot see
  let onKill = () => {};
  const killedRead = new Promise<void>((resolve) => (onKill = resolve));
  const handlers = api.handleStatus({
    cleanup() {
      killed = true;
      choose();
      onKill();
    },
  });

  try {
    let datum: unknown;
    while ((datum = await Promise.race([api.read(), killedRead])) !== api.eof && killed === false) {
      const pick = datum as JshCli.PickEvent;
      const npcKey = typeof datum === "string" ? datum : pick?.meta?.type === "npc" ? pick.meta.npcKey : undefined;
      if (npcKey !== undefined && npcKey in w.n) choose(npcKey);
    }
  } finally {
    handlers.dispose();
  }
  if (killed === true) throw api.getKillError();
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
