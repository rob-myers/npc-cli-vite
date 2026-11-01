import { geomService } from "@npc-cli/util/geom-service";
import { warn } from "@npc-cli/util/legacy/generic";
import { findLocalNeighbourhood, getPolyWallSegments } from "navcat";
import { spotQueryDetached } from "./perception.main";

/**
 * Npcs step out of the way (idempotent).
 * - idle ones holding up a walker strafe to a spot clear of their path, else across their way, turning to face them.
 * - none steps to a spot another is stepping to, nor beside another.
 * - stood pacified ones do too, without turning.
 * - the player does too, unless aiming or crouched.
 * - collapsed ones scoot aside back-first, along the wall if by one.
 * - none does within `stillSecs` of stopping or collapsing, e.g. having just stepped aside.
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
  /** When each collapsed, in world seconds */
  const fell = new Map<string, number>();
  w.e.addKeyedListener("sidestep", (e, w) => {
    if (w.client === true) return;
    if (e.key === "npc-hurt" && e.clip === "collapsed") fell.set(e.npcKey, w.gameTime.now());
  });
  w.e.addKeyedTick("sidestep", (w) => {
    if (w.client === true) return;
    // released or removed
    for (const npcKey of fell.keys()) if (w.n[npcKey]?.anim.hurt == null) fell.delete(npcKey);
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
      if (stepping.has(npcKey) || canSidestep(w, npc, fell) === false) beside.delete(npcKey);
      else if (heldUp(w, beside, npc, walker) === true) makeWay(w, npc, walker, stepping, fell);
    }
  });
}

type Beside = { walker: JshCli.Npc; since: number; left: number };

/** Idle for `stillSecs`, stood or collapsed, and if the player, neither aiming nor crouched */
function canSidestep(w: JshCli.WorldState, npc: JshCli.Npc, fell: Map<string, number>) {
  const since = Math.max(npc.last.idleTime, fell.get(npc.key) ?? -Infinity);
  if (w.gameTime.now() - since < sidestepConfig.stillSecs) return false;
  const { hurt } = npc.anim;
  if (npc.agent === null || (hurt !== null && hurt.key !== "pacified" && npc.anim.dragged === false)) return false;
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
 * Neither is where another stands or is stepping to. One collapsed by a wall keeps to it
 */
function makeWay(
  w: JshCli.WorldState,
  npc: JshCli.Npc,
  walker: JshCli.Npc,
  stepping: Map<string, null | Geom.VectJson>,
  fell: Map<string, number>,
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
  const along = npc.anim.dragged === true ? wallNear(w, npc) : null;
  const found =
    along !== null
      ? Promise.resolve(alongWall(npc, along, path))
      : spotQueryDetached(w, [{ q: "makeWay", npc: npc.key, path, others }]).then(([spot]) =>
          spot != null && "x" in spot && !Array.isArray(spot) ? spot : acrossWay(npc, walker),
        );
  void found
    .then(async (to) => {
      if (to === null || canSidestep(w, npc, fell) === false) return;
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

/** Which way the navmesh edge nearest `npc` runs, if within `hug`, else `null`. Found as the crowd finds walls */
function wallNear(w: JshCli.WorldState, npc: JshCli.Npc) {
  const { agent, position: p, queryFilter } = npc;
  if (agent === null) return null;
  const { navMesh } = w.nav;
  let along: null | Geom.VectJson = null;
  let nearest: number = sidestepConfig.hug;
  // none on failure
  const { nodeRefs } = findLocalNeighbourhood(navMesh, w.npc.getNodeRef(agent), p.toArray(), nearest, queryFilter);
  for (const nodeRef of nodeRefs) {
    const { segmentVerts: s } = getPolyWallSegments(navMesh, nodeRef, queryFilter, false);
    for (let i = 0; i < s.length; i += 6) {
      const d = geomService.getDistanceToSeg(p.x, p.z, { x: s[i], y: s[i + 2] }, { x: s[i + 3], y: s[i + 5] });
      if (d > nearest) continue;
      along = { x: s[i + 3] - s[i], y: s[i + 5] - s[i + 2] };
      nearest = d;
    }
  }
  return along;
}

/** A step either way `along` a wall, whichever ends further from `walker`'s `path`: `null` if neither has room */
function alongWall(npc: JshCli.Npc, along: Geom.VectJson, path: Geom.VectJson[]) {
  const legs = path.map((a, i) => [a, path[i + 1] ?? a] as const);
  const offPath = (p: Geom.VectJson) => Math.min(...legs.map(([a, b]) => geomService.getDistanceToSeg(p.x, p.y, a, b)));
  const { minMove } = sidestepConfig;
  const by = sidestepConfig.by / (Math.hypot(along.x, along.y) || 1);
  const steps = [1, -1].flatMap((sign) => {
    const slide = npc.getSlideResult({ x: sign * along.x * by, y: sign * along.y * by });
    return slide?.success === true && npc.distanceTo(slide.groundPoint) >= minMove ? [slide.groundPoint] : [];
  });
  return steps.sort((a, b) => offPath(b) - offPath(a))[0] ?? null;
}

/** Which way `walker` means to go, their desired velocity, else as they move. Held up, they barely move */
function headingOf({ agent }: JshCli.Npc) {
  for (const [x, , z] of agent === null ? [] : [agent.desiredVelocity, agent.velocity]) {
    if (Math.hypot(x, z) > sidestepConfig.headingMin) return [x, z];
  }
  return null;
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
  /** Seconds after stopping or collapsing before they step aside, so a step aside or an arrival settles first */
  stillSecs: 2,
  /** Metres off the navmesh edge within which one collapsed is by a wall, and keeps to it */
  hug: 0.3,
};
