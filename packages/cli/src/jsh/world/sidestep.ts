import { standConfig } from "@npc-cli/ui__world/const.npc";
import { warn } from "@npc-cli/util/legacy/generic";
import { npcQuery, parkedNow, requestDetached, roomOthers } from "./plan.main";
import { parked } from "./pred";

/**
 * Npcs step out of the way. An idle one holding up a walker beside them strafes off its path. The player never does.
 * One collapsed with no room to walk round them is parked against a wall nearby. Idempotent, as `inventory`
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
  w.e.addKeyedListener("sidestep", (e, w) => {
    if (e.key === "removed-npcs") e.npcKeys.forEach((npcKey) => beside.delete(npcKey));
    else onSidestepEvent(e, w);
  });
  w.e.addKeyedTick("sidestep", (w) => {
    if (w.client === true) return;
    for (const npc of Object.values(w.n)) {
      if (canSidestep(w, npc) === false) {
        beside.delete(npc.key);
        continue;
      }
      const walker = walkerBeside(w, npc);
      if (heldUp(w, beside, npc, walker) === true) stepAside(w, npc, walker);
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

/** The nearest walker within `dist` of `npc`. `neis` have `dist` squared */
function walkerBeside(w: JshCli.WorldState, npc: JshCli.Npc) {
  const [nearest] = (npc.agent?.neis ?? [])
    .filter(({ agentId, dist }) => dist < sidestepConfig.dist ** 2 && w.npc.byAgentId[agentId]?.isMoving())
    .sort((a, b) => a.dist - b.dist);
  return nearest === undefined ? undefined : w.npc.byAgentId[nearest.agentId];
}

/** Has `walker` been beside `npc` for `lingerSecs`, making little headway? */
function heldUp(
  w: JshCli.WorldState,
  beside: Map<string, Beside>,
  npc: JshCli.Npc,
  walker: JshCli.Npc | undefined,
): walker is JshCli.Npc {
  const now = w.timer.getElapsedTime();
  const prev = beside.get(npc.key);
  if (walker === undefined) {
    beside.delete(npc.key);
  } else if (prev?.walker !== walker || walker.distanceTo(prev.at) > sidestepConfig.progress) {
    beside.set(npc.key, { walker, since: now, at: walker.point }); // time it afresh
  } else if (now - prev.since >= sidestepConfig.lingerSecs) {
    beside.delete(npc.key);
    return true;
  }
  return false;
}

/** Strafes `npc` across `walker`'s path on their side of it, so they keep their facing */
function stepAside(w: JshCli.WorldState, npc: JshCli.Npc, walker: JshCli.Npc) {
  const [vx, , vz] = walker.agent?.velocity ?? [0, 0, 0];
  const dx = npc.position.x - walker.position.x;
  const dz = npc.position.z - walker.position.z;
  const [ux, uz] = Math.hypot(vx, vz) < 0.05 ? [dx, dz] : -vz * dx + vx * dz < 0 ? [vz, -vx] : [-vz, vx];
  const by = sidestepConfig.by / (Math.hypot(ux, uz) || 1);
  const slide = npc.getSlideResult({ x: ux * by, y: uz * by });
  if (slide?.success !== true || npc.distanceTo(slide.groundPoint) < sidestepConfig.minMove) return;
  void w.e.move({ npcKey: npc.key, to: slide.groundPoint, strafe: true }).catch(() => {}); // a new push may interrupt
}

/** Parks `npcKey` against a wall nearby, unless they have room to walk round them, or that wall is too far */
async function parkIfInTheWay(w: JshCli.WorldState, npcKey: string) {
  const npc = w.n[npcKey];
  const until = w.timer.getElapsedTime() + sidestepConfig.parkAfterSecs;
  while (w.timer.getElapsedTime() < until) await w.npc.nextTick(); // world seconds, so a pause holds it
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
  /** Within this of a walker they step aside. No further than the crowd's `collisionQueryRange` */
  dist: 0.6,
  /** A walker beside them this long, making less headway (metres), is held up. Sooner than `stuckDuration` */
  lingerSecs: 0.2,
  progress: 0.15,
  /** Metres they step aside by, and the least worth moving once slid along the navmesh */
  by: 0.8,
  minMove: 0.2,
  /** Seconds a collapsed npc lies where they fell before being parked */
  parkAfterSecs: 1,
  /** Metres at most a collapsed npc is parked from where they fell: further reads as a teleport */
  parkMaxMove: 2,
};
