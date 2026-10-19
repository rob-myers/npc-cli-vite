import { standConfig } from "@npc-cli/ui__world/const.npc";
import { warn } from "@npc-cli/util/legacy/generic";
import { npcQuery, parkedNow, requestDetached, roomOthers } from "./plan.main";
import { parked } from "./pred";

/**
 * Npcs step out of the way (idempotent).
 * - idle ones holding up a walker strafe off-path, partly backing away, turning to face them.
 * - the player never does.
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
  w.e.addKeyedListener("sidestep", onSidestepEvent);
  w.e.addKeyedTick("sidestep", (w) => {
    if (w.client === true) return;
    nearest.clear();
    // walkers are few: found from their own neighbours, not every npc's
    for (const key in w.n) {
      const walker = w.n[key];
      if (walker.isMoving() === false) continue;
      for (const { agentId, dist } of walker.agent?.neis ?? []) {
        const npc = w.npc.byAgentId[agentId];
        if (npc === undefined || dist >= sidestepConfig.dist ** 2) continue;
        if ((nearest.get(npc.key)?.dist ?? Infinity) > dist) nearest.set(npc.key, { walker, dist });
      }
    }
    for (const npcKey of beside.keys()) if (nearest.has(npcKey) === false) beside.delete(npcKey);
    for (const [npcKey, { walker }] of nearest) {
      const npc = w.n[npcKey];
      if (canSidestep(w, npc) === false) beside.delete(npcKey);
      else if (heldUp(w, beside, npc, walker) === true) stepAside(w, npc, walker);
    }
  });
}

type Beside = { walker: JshCli.Npc; since: number; at: JshCli.GroundPoint };

function onSidestepEvent(e: JshCli.Event, w: JshCli.WorldState) {
  if (w.client === true) return;
  if (e.key == "npc-hurt" && e.clip == "collapsed") {
    void parkIfInTheWay(w, e.npcKey).catch((err) => warn(`sidestep: ${err}`));
  }
}

/** Stood idle on their feet, and not the player */
function canSidestep(w: JshCli.WorldState, npc: JshCli.Npc) {
  if (w.player.is(npc.key) === true || npc.agent === null || npc.anim.hurt !== null) return false;
  return !(npc.isMoving() || npc.isLooking() || npc.isNotStanding() || npc.isFading());
}

/** Has `walker` been beside `npc` for `lingerSecs`, making little headway? */
function heldUp(w: JshCli.WorldState, beside: Map<string, Beside>, npc: JshCli.Npc, walker: JshCli.Npc) {
  const now = w.gameTime.now();
  const prev = beside.get(npc.key);
  if (prev?.walker !== walker || walker.distanceTo(prev.at) > sidestepConfig.progress) {
    beside.set(npc.key, { walker, since: now, at: walker.point }); // time it afresh
  } else if (now - prev.since >= sidestepConfig.lingerSecs) {
    beside.delete(npc.key);
    return true;
  }
  return false;
}

/** Strafes `npc` off `walker`'s path on their side of it, partly back from them, turning to face them */
function stepAside(w: JshCli.WorldState, npc: JshCli.Npc, walker: JshCli.Npc) {
  const [vx, , vz] = walker.agent?.velocity ?? [0, 0, 0];
  const dx = npc.position.x - walker.position.x;
  const dz = npc.position.z - walker.position.z;
  const [ux, uz] = Math.hypot(vx, vz) < 0.05 ? [dx, dz] : -vz * dx + vx * dz < 0 ? [vz, -vx] : [-vz, vx];
  const [u, a] = [Math.hypot(ux, uz) || 1, Math.hypot(dx, dz) || 1];
  const back = Math.random() * sidestepConfig.backMax;
  const [sx, sz] = [(ux / u) * (1 - back) + (dx / a) * back, (uz / u) * (1 - back) + (dz / a) * back];
  const by = sidestepConfig.by / (Math.hypot(sx, sz) || 1);
  const slide = npc.getSlideResult({ x: sx * by, y: sz * by });
  if (slide?.success !== true || npc.distanceTo(slide.groundPoint) < sidestepConfig.minMove) return;
  /** Eased round to face them whilst stepping, dropped at rest */
  const aim = { at: walker.point, rate: 1, untilRest: true };
  npc.anim.face.aim = aim;
  void w.e.move({ npcKey: npc.key, to: slide.groundPoint, strafe: true }).catch(() => {
    if (npc.anim.face.aim === aim) npc.anim.face.aim = null; // a new push may interrupt
  });
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
  if (room != null && Math.hypot(room.at.x - npc.point.x, room.at.y - npc.point.y) <= standConfig.parkMinMove) return;
  const [plan] = await requestDetached(w, { key: "park", npcs: [query], parked: parkedNow(w) });
  if (plan == null || w.n[npcKey] !== npc || npc.anim.hurt?.key !== "collapsed") return;
  if (Math.hypot(plan.at.x - npc.point.x, plan.at.y - npc.point.y) > sidestepConfig.parkMaxMove) return;
  await npc.fadeSpawn({ at: plan.at, facing: plan.facing }); // still collapsed: a respawn keeps the hurt clip
  parked.mark(npc.key, plan.seg);
}

const sidestepConfig = {
  /** Within this of a walker they step aside: the crowd's `collisionQueryRange`, within which its avoidance holds one up */
  dist: 0.7,
  /** A walker beside them this long, making less headway (metres), is held up. Sooner than `stuckDuration` */
  lingerSecs: 0.2,
  progress: 0.15,
  /** Metres they step aside by, and the least worth moving once slid along the navmesh */
  by: 0.8,
  minMove: 0.2,
  /** Up to this share of a step is back, away from the walker */
  backMax: 0.6,
  /** Seconds a collapsed npc lies where they fell before being parked */
  parkAfterSecs: 1,
  /** Metres at most a collapsed npc is parked from where they fell: further reads as a teleport */
  parkMaxMove: 2,
};
