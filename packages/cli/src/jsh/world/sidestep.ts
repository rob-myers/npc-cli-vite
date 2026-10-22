import { standConfig } from "@npc-cli/ui__world/const.npc";
import { warn } from "@npc-cli/util/legacy/generic";
import { spotQueryDetached } from "./perception.main";
import { npcQuery, parkedNow, requestDetached, roomOthers } from "./plan.main";
import { parked } from "./pred";

/**
 * Npcs step out of the way (idempotent).
 * - idle ones holding up a walker strafe to a spot clear of their path, else across their way, turning to face them.
 * - none steps to a spot another is stepping to, nor beside another.
 * - stood pacified ones do too, without turning.
 * - the player does too, unless aiming or crouched.
 * - none does within `stillSecs` of stopping, e.g. having just stepped aside.
 * - collapsed npcs sans padding are parked so they don't block navmesh.
 *
 * ```sh
 * sidestep
 * sidestep off
 * ```
 */
export function sidestep({ args, w }: JshCli.RunArg) {
  if (args[0] === "off") {
    w.e.keyedListener.delete("sidestep");
    w.e.keyedTick.delete("sidestep");
    return;
  }
  /** Whom each has had beside them, since when in world seconds, and where it was then */
  const beside = new Map<string, Beside>();
  /** Each npc's nearest walker this tick, and its distance squared */
  const nearest = new Map<string, { walker: JshCli.Npc; dist: number }>();
  /** Npcs making way, and where to once known */
  const stepping = new Map<string, null | Geom.VectJson>();
  w.e.addKeyedListener("sidestep", onSidestepEvent);
  w.e.addKeyedTick("sidestep", (w) => {
    if (w.client === true) return;
    nearest.clear();
    const near = sidestepConfig.dist ** 2;
    // walkers are few: found from their own neighbours, not every npc's
    for (const key in w.n) {
      const walker = w.n[key];
      if (walker.isMoving() === false) continue;
      for (const { agentId, dist } of walker.agent?.neis ?? []) {
        const npc = w.npc.byAgentId[agentId];
        if (npc === undefined || dist >= near) continue;
        if ((nearest.get(npc.key)?.dist ?? Infinity) > dist) nearest.set(npc.key, { walker, dist });
      }
    }
    for (const npcKey of beside.keys()) if (nearest.has(npcKey) === false) beside.delete(npcKey);
    for (const [npcKey, { walker }] of nearest) {
      const npc = w.n[npcKey];
      if (stepping.has(npcKey) || canSidestep(w, npc) === false) beside.delete(npcKey);
      else if (heldUp(w, beside, npc, walker) === true) makeWay(w, npc, walker, stepping);
    }
  });
}

type Beside = { walker: JshCli.Npc; since: number; left: number };

function onSidestepEvent(e: JshCli.Event, w: JshCli.WorldState) {
  if (w.client === true) return;
  if (e.key === "npc-hurt" && e.clip === "collapsed") {
    void parkIfInTheWay(w, e.npcKey).catch((err) => warn(`sidestep: ${err}`));
  }
}

/** Stood idle on their feet for `stillSecs`, and if the player, neither aiming nor crouched */
function canSidestep(w: JshCli.WorldState, npc: JshCli.Npc) {
  if (w.gameTime.now() - npc.last.idleTime < sidestepConfig.stillSecs) return false;
  if (npc.agent === null || (npc.anim.hurt !== null && npc.anim.hurt.key !== "pacified")) return false;
  if (w.player.is(npc.key) === true && (npc.anim.face.aim !== null || npc.anim.crouched === true)) return false;
  return !(npc.isMoving() || npc.isLooking() || npc.isNotStanding() || npc.isFading());
}

/** Has `walker` been beside `npc` for `lingerSecs`, getting little nearer their target? Sliding round them is no headway */
function heldUp(w: JshCli.WorldState, beside: Map<string, Beside>, npc: JshCli.Npc, walker: JshCli.Npc) {
  const now = w.gameTime.now();
  const prev = beside.get(npc.key);
  const left = walker.distanceTo(walker.last.dst);
  if (prev?.walker !== walker || prev.left - left > sidestepConfig.progress) {
    beside.set(npc.key, { walker, since: now, left }); // time it afresh
  } else if (now - prev.since >= sidestepConfig.lingerSecs) {
    beside.delete(npc.key);
    return true;
  }
  return false;
}

/**
 * Strafes `npc` to the nearest spot clear of `walker`'s path, else across their way, turning to face them unless pacified.
 * Neither is where another stands or is stepping to
 */
function makeWay(
  w: JshCli.WorldState,
  npc: JshCli.Npc,
  walker: JshCli.Npc,
  stepping: Map<string, null | Geom.VectJson>,
) {
  stepping.set(npc.key, null);
  const path = [walker.point, ...(walker.agent?.corners ?? []).map(({ position: [x, , z] }) => ({ x, y: z }))];
  const others = [
    ...(npc.agent?.neis ?? []).flatMap(({ agentId }) => {
      const other = w.npc.byAgentId[agentId];
      return other === undefined || other === walker ? [] : [other.point];
    }),
    ...[...stepping.values()].flatMap((to) => to ?? []),
  ];
  void spotQueryDetached(w, [{ q: "makeWay", npc: npc.key, path, others }])
    .then(async ([spot]) => {
      if (canSidestep(w, npc) === false) return;
      const to = spot != null && "x" in spot && !Array.isArray(spot) ? spot : acrossWay(npc, walker);
      if (to === null) return;
      stepping.set(npc.key, to);
      /** Eased round to face them whilst stepping, dropped at rest */
      const aim = { at: walker.point, rate: 1, untilRest: true };
      if (npc.anim.hurt === null) npc.anim.face.aim = aim;
      await w.e.move({ npcKey: npc.key, to: { x: to.x, y: to.y }, strafe: true, shove: true }).catch(() => {
        if (npc.anim.face.aim === aim) npc.anim.face.aim = null; // a new push may interrupt
      });
    })
    .catch((e) => warn(`sidestep: ${e}`))
    .finally(() => stepping.delete(npc.key));
}

/** A step across `walker`'s way, `npc`'s own side first, slid along the navmesh: `null` if neither side has room */
function acrossWay(npc: JshCli.Npc, walker: JshCli.Npc) {
  const dx = npc.position.x - walker.position.x;
  const dz = npc.position.z - walker.position.z;
  const [hx, hz] = headingOf(walker) ?? [dx, dz];
  const by = ((-hz * dx + hx * dz < 0 ? 1 : -1) * sidestepConfig.by) / (Math.hypot(hx, hz) || 1);
  for (const sign of [1, -1]) {
    const slide = npc.getSlideResult({ x: sign * hz * by, y: -sign * hx * by });
    if (slide?.success === true && npc.distanceTo(slide.groundPoint) >= sidestepConfig.minMove)
      return slide.groundPoint;
  }
  return null;
}

/** Which way `walker` means to go, their desired velocity, else as they move. Held up, they barely move */
function headingOf({ agent }: JshCli.Npc) {
  for (const [x, , z] of agent === null ? [] : [agent.desiredVelocity, agent.velocity]) {
    if (Math.hypot(x, z) > sidestepConfig.headingMin) return [x, z];
  }
  return null;
}

/** Parks `npcKey` against a wall nearby, unless they have room to walk round them, or that wall is too far */
async function parkIfInTheWay(w: JshCli.WorldState, npcKey: string) {
  const npc = w.n[npcKey];
  await w.e.wait(sidestepConfig.parkAfterSecs);
  if (w.n[npcKey] !== npc || npc === undefined || npc.agent === null || npc.anim.hurt?.key !== "collapsed") return;
  const query = npcQuery(w, npc);
  const by = standConfig.padClearance;
  const [room] = await requestDetached(w, { key: "pad", npcs: [query], others: roomOthers(w, [npc]), by });
  // `pad` tries where they are first: that spot back means there is room round them
  if (room != null && npc.distanceTo(room.at) <= standConfig.parkMinMove) return;
  const [plan] = await requestDetached(w, { key: "park", npcs: [query], parked: parkedNow(w) });
  if (plan == null || w.n[npcKey] !== npc || npc.anim.hurt?.key !== "collapsed") return;
  if (npc.distanceTo(plan.at) > sidestepConfig.parkMaxMove) return;
  await npc.fadeSpawn({ at: plan.at, facing: plan.facing }); // still collapsed: a respawn keeps the hurt clip
  parked.mark(npc.key, plan.seg);
}

const sidestepConfig = {
  /** Within this of a walker they step aside: the crowd's `collisionQueryRange`, within which its avoidance holds one up */
  dist: 0.7,
  /** A walker beside them this long, getting less nearer their target (metres), is held up. Sooner than `stuckDuration` */
  lingerSecs: 0.2,
  progress: 0.15,
  /** Metres they step aside by, and the least worth moving once slid along the navmesh */
  by: 0.8,
  minMove: 0.2,
  /** Below this speed, desired or actual, a walker's heading is unknown */
  headingMin: 0.05,
  /** Seconds after stopping before they step aside, so a step aside or an arrival settles first */
  stillSecs: 2,
  /** Seconds a collapsed npc lies where they fell before being parked */
  parkAfterSecs: 1,
  /** Metres at most a collapsed npc is parked from where they fell: further reads as a teleport */
  parkMaxMove: 2,
};
