import { parkQueryRange } from "@npc-cli/ui__world/const";
import { localBoundary } from "navcat/blocks";
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
 * Draw an npc's local navmesh boundary — the segments `park` chooses from, as of now — in red.
 * Sans npc, takes it down.
 * ```sh
 * demo_local_boundary npc:rob
 * demo_local_boundary
 * ```
 */
export function demo_local_boundary(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  if (opts.npcKey === undefined) {
    w.debug.setLocalBoundary([]);
    return;
  }
  const npc = w.npc.get(opts.npcKey);
  if (!npc.agent) throw Error("no agent");

  // exactly as `park` asks, so what is drawn is what it would see
  localBoundary.updateLocalBoundary(
    npc.agent.boundary,
    w.npc.getClosestPoly(npc.position).nodeRef,
    w.helper.groundPointToTuple(npc.point),
    parkQueryRange,
    w.nav.navMesh,
    npc.queryFilter,
  );
  w.debug.setLocalBoundary(npc.agent.boundary.segments.map(({ s }) => [s[0], s[2], s[3], s[5]]));
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
