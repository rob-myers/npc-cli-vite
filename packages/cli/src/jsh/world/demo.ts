import { events, nudge } from "./core";

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

/**
 * Iterate over on-mesh idle npcs with a nearby non-idle neighbour,
 * nudging them if other was not recently nudged, with cool-down.
 */
export async function demo_auto_nudge(ct: JshCli.RunArg) {
  const { api, w } = ct;
  const npcToNudge = {} as { [npcKey: string]: { next: number; last: number } };

  const handled = api.handleStatus({
    cleanup: w.e.addFrameCallback(() => {
      if (w.disabled === true) {
        return;
      }

      const epochMs = Date.now();
      const { byAgentId } = w.npc;
      let other: JshCli.Npc | undefined;

      for (const npc of Object.values(w.n)) {
        // only consider on-mesh idle
        if (npc.agent === null || npc.isMoving() === true) {
          continue;
        }

        // nearest must be moving
        const [closestNei] = npc.agent.neis;
        if (
          closestNei === undefined ||
          closestNei.dist > 0.5 ||
          (other = byAgentId[closestNei.agentId]).isMoving() === false
        ) {
          continue;
        }

        let entry = npcToNudge[npc.key];
        if (entry === undefined || epochMs - entry.last > 1000) {
          // if last nudge at least ... ago schedule in ...
          entry = npcToNudge[npc.key] ??= { last: 0, next: 0 };
          entry.next = entry.last = Date.now() + 500;
        } else if (epochMs > entry.next) {
          // perform nudge if other wasn't recently nudged
          if (npcToNudge[other.key] === undefined || epochMs - npcToNudge[other.key].last > 1000) {
            void nudge(ct, { npcKey: npc.key, from: other.key });
            entry.last = Date.now();
            entry.next = Infinity;
          }
        }
      }
    }),
  });

  // run until killed
  try {
    await api.sleep(Number.MAX_SAFE_INTEGER);
  } finally {
    handled.dispose();
  }
}

export async function* demo_log_speech(ct: JshCli.RunArg) {
  for await (const e of events(ct, {
    where: (e) => e.key === "speech",
  })) {
    // console.log({ e });
    yield `${ct.api.ansi.Blue}${e.npcKey}${ct.api.ansi.Reset}: ${e.words}`;
  }
}

export function demo_remove_decor(ct: JshCli.RunArg) {
  ct.w.decor.remove("test-decor-circle", "test-decor-point", "test-decor-rect", "test-decor-rect-angled");
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

export async function demo_toggle_doors(ct: JshCli.RunArg) {
  for await (const e of events(ct, { where: (e) => e.key === "picked" })) {
    if (e.meta.type === "door") {
      ct.w.e.toggleDoor(e.meta.gdKey);
    }
  }
}
