import { geomService } from "@npc-cli/util/geom";
import { findRandomPointAroundCircle } from "navcat";
import { events } from "./core";

export function add_decor(ct: JshCli.RunArg) {
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

  ct.w.view.forceUpdate();
}

/**
 * Ask for help when stuck behind another npc e.g. sandwiched against nav edge
 * ```sh
 * excuse_me npc:kate
 * excuse_me npc:kate again
 * ```
 */
export async function excuse_me(
  ct: JshCli.RunArg,
  opts = ct.api.jsArg<{ npcKey: string; again?: boolean }>(ct.args, { npc: "npcKey" }),
) {
  const { w } = ct;
  const npc = w.npc.get(opts.npcKey);
  const agent = npc.agent;
  if (!agent) throw Error("no agent");

  if (opts.again) {
    // move to random nearby point
    const result = findRandomPointAroundCircle(
      w.nav.navMesh,
      w.npc.getClosestPoly(npc.position).nodeRef,
      [npc.position.x, 0, npc.position.z],
      0.25,
      npc.queryFilter,
      Math.random,
    );
    await w.npc.move({ npcKey: npc.key, to: result.position });
    return;
  }

  const [seg] = agent.boundary.segments;
  if (seg === undefined || seg.d < 0.0005) {
    return; // not close enough to a nav edge
  }

  // prevent idle npc from being pushed by other
  agent.maxAcceleration = 0.25;
  agent.separationWeight = 0.1;
  // assume 1st segment closest (seg.d minimal)
  const closest = geomService.getClosestOnSeg(
    npc.point,
    { x: seg.s[0 + 0], y: seg.s[0 + 2] },
    { x: seg.s[3 + 0], y: seg.s[3 + 2] },
  );

  npc.pinTo(w.npc.getClosestPoly(closest));
}

export async function* log_speech(ct: JshCli.RunArg) {
  for await (const e of events(ct, {
    where: (e) => e.key === "speech",
  })) {
    console.log({ e });
    yield `${e.npcKey}: ${e.words}`;
  }
}
