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

export async function demo_auto_nudge(ct: JshCli.RunArg) {
  const { api, w } = ct;
  const nudgedEpoch = {} as { [npcKey: string]: number };

  const handled = api.handleStatus({
    cleanups: w.e.addFrameCallback(() => {
      if (w.disabled === true) {
        return;
      }
      const epoch = Date.now();
      for (const npc of Object.values(w.n)) {
        if (npc.agent === null || npc.isMoving() === true) {
          continue;
        }
        const [closestNei] = npc.agent.neis;

        if (closestNei?.dist < 0.5 && (nudgedEpoch[npc.key] === undefined || epoch - nudgedEpoch[npc.key] > 3000)) {
          // idle npc on navmesh has nearby moving neighbour
          nudgedEpoch[npc.key] = Date.now();
          void nudge(ct, { npcKey: npc.key, src: w.npc.byAgentId[closestNei.agentId].key });
        }
      }
    }),
  });

  try {
    // run until killed
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
 * demo_npc_ui rob
 * ```
 */
export function demo_npc_ui({ w, args }: JshCli.RunArg) {
  const [npcKey] = args;
  const npc = w.npc.get(npcKey);
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
