import { helper } from "@npc-cli/ui__world/helper";
import { createElement } from "react";
import { isPaused } from "./plan.main";
import { RouteNodeUi } from "./route-ui";
import { sharedMapSlot } from "./shared.service";

/**
 * A `move` or `do` is a waypoint; every other step is done once there — which is what lets a
 * track be walked backwards, see `reverseTrack`
 */
export type RouteStep =
  | { kind: "move"; at: Geom.VectJson; grKey: Geomorph.GmRoomKey; anchor?: RouteAnchor; ms?: number }
  | { kind: "do"; decorKey: string; ms?: number }
  | { kind: "wait"; ms: number }
  | { kind: "look"; at: string | Geom.VectJson }
  | { kind: "open" | "close"; gdKey: Geomorph.GmDoorKey }
  | { kind: "say"; words: string; secs?: number }
  /** A barrier: each bound track with this code waits here until all of them have arrived */
  | { kind: "sync"; code: string }
  /** One-way: a signal stays given, so an `await` after it passes at once */
  | { kind: "signal"; code: string }
  | { kind: "await"; code: string };

export type RouteAnchor = { gdKey: Geomorph.GmDoorKey } | { decorKey: string };

export type Route = {
  /** By role, bound to an npc when run e.g. `route patrol guard:rob-0` */
  tracks: Record<string, RouteStep[]>;
  /** `cycle` walks round to the first waypoint again; `pingpong` walks the track backwards */
  loop?: "cycle" | "pingpong";
};

/** `/shared/path`, kept per map: a route means nothing on another map */
const slot = sharedMapSlot<Record<string, Route>>("path", () => ({}));

slot.setHandler(function onWorldEvent(e, w) {
  if (e.key === "map-settled") restoreRoutes(w.mapKey);
  if (e.key === "map-settled" || e.key === "path-changed") drawRoutes(w);
  // a click on a node shows its steps, or takes them down again
  if (e.key === "picked" && isDecorRouteNode(e.meta)) {
    const { route: name, role, stepIndex, decorKey } = e.meta;
    const ui = nodeUi(w, name, role, stepIndex);
    if (ui === null) return;
    // whilst open, the ui stands in for the kind label
    if (w.html.byKey.has(decorKey) === false) w.labels.remove(decorKey);
    w.html.toggle(decorKey, ui.at, ui.node, { onHide: () => w.labels.add(decorKey, ui.label) });
  }
});

/** What a route node's decor carries — see `drawTrack` — and so a pick on it */
type RouteNodeMeta = { route: string; role: string; stepIndex: number; decorKey: string };

function isDecorRouteNode(meta: Meta): meta is Meta<RouteNodeMeta> {
  return (
    typeof meta.route === "string" &&
    typeof meta.role === "string" &&
    typeof meta.stepIndex === "number" &&
    typeof meta.decorKey === "string"
  );
}

/** `/shared/path`'s side — an object, so no shell function is made of it */
export const routes = {
  all: () => slot.get(),
  get: (name: string): Route | undefined => slot.get()[name],
  validate: validateRoute,
  reverse: reverseTrack,
  set(w: JshCli.WorldState, name: string, def: Route) {
    const error = validateRoute(def);
    if (error !== null) throw Error(`route ${name}: ${error}`);
    slot.get()[name] = def;
    w.events.next({ key: "path-changed", name }); // drawn off the event
  },
  remove(w: JshCli.WorldState, name: string) {
    delete slot.get()[name];
    w.events.next({ key: "path-changed", name });
  },
};

/** Warns of an entry the user has broken rather than throwing it away: `route` refuses it */
function restoreRoutes(mapKey: string) {
  for (const [name, def] of Object.entries(slot.restore(mapKey))) {
    const error = validateRoute(def);
    if (error !== null) console.warn(`/shared/path/${name}: ${error}`);
  }
}

/** @returns what is wrong, or `null` */
function validateRoute(def: unknown): string | null {
  if (typeof def !== "object" || def === null) return "not an object";
  const { tracks, loop } = def as Partial<Route>;
  if (loop !== undefined && loop !== "cycle" && loop !== "pingpong") return `bad loop: ${loop}`;
  if (typeof tracks !== "object" || tracks === null) return "tracks not an object";
  for (const [role, steps] of Object.entries(tracks)) {
    if (!Array.isArray(steps)) return `track ${role}: not an array`;
    const bad = steps.findIndex((s) => isRouteStep(s) === false);
    if (bad !== -1) return `track ${role}: bad step ${bad}`;
  }
  return null;
}

function isRouteStep(s: any): s is RouteStep {
  if (typeof s !== "object" || s === null) return false;
  // biome-ignore format: succinct
  switch (s.kind) {
    case "move": return helper.isVectJson(s.at) && typeof s.grKey === "string";
    case "do": return typeof s.decorKey === "string";
    case "wait": return typeof s.ms === "number";
    case "look": return typeof s.at === "string" || helper.isVectJson(s.at);
    case "open": case "close": return typeof s.gdKey === "string";
    case "say": return typeof s.words === "string";
    case "sync": case "signal": case "await": return typeof s.code === "string";
    default: return false;
  }
}

/** Waypoints in the opposite order, each keeping the steps done once there */
function reverseTrack(steps: RouteStep[]): RouteStep[] {
  return groupByWaypoint(steps)
    .reverse()
    .flatMap((group) => group.map(([, step]) => step));
}

/** Each waypoint with the steps done there, indexed — and first, any done before setting off */
function groupByWaypoint(steps: RouteStep[]): [index: number, step: RouteStep][][] {
  const groups: [number, RouteStep][][] = [[]];
  for (const [index, step] of steps.entries()) {
    if (isWaypoint(step)) groups.push([[index, step]]);
    else groups[groups.length - 1].push([index, step]);
  }
  return groups;
}

function isWaypoint(step: RouteStep): step is Extract<RouteStep, { kind: "move" | "do" }> {
  return step.kind === "move" || step.kind === "do";
}

/** Where a waypoint stands, else `null` */
function waypointOf(w: JshCli.WorldState, step: RouteStep): Geom.VectJson | null {
  if (step.kind === "move") return step.at;
  const d = step.kind === "do" ? w.decor.byKey[step.decorKey] : undefined;
  return d?.type === "point" ? { x: d.x, y: d.y } : null;
}

/**
 * `route_init` is idempotent and must be invoked before the other `route_*` commands. It is also
 * what puts routes on show: a World with no terminal has run it, so draws none
 */
export function route_init(ct: JshCli.RunArg) {
  restoreRoutes(ct.w.mapKey);
  ct.w.e.addKeyedListener("path", slot.handle);
  drawRoutes(ct.w);
}

/**
 * Run a route from `/shared/path`, its roles bound to npcs, until it ends or is killed —
 * a pause holds every track where it is. A one-track route takes any binding.
 * ```sh
 * route patrol guard:rob-0 medic:kate
 * route patrol npc:rob --reverse
 * ```
 */
export async function route(
  ct: JshCli.RunArg,
  opts: Record<string, string | boolean> = ct.api.jsArg(ct.args, { "--reverse": "reverse" }),
) {
  const { api, args, w } = ct;
  const [name] = api.getJsOperands(args, opts);
  const def = routes.get(name);
  if (def === undefined) throw Error(`no such route: ${name}`);
  const error = validateRoute(def);
  if (error !== null) throw Error(`route ${name}: ${error}`);

  const roles = Object.keys(def.tracks);
  let bindings = Object.entries(opts).filter((e): e is [string, string] => typeof e[1] === "string");
  if (roles.length === 1 && bindings.length === 1) bindings = [[roles[0], bindings[0][1]]];
  for (const [role, npcKey] of bindings) {
    if (!(role in def.tracks)) throw Error(`no such role: ${role} (${roles.join(", ")})`);
    w.npc.get(npcKey); // throws when absent
  }
  if (bindings.length === 0) throw Error(`bind a role e.g. ${roles[0] ?? "guard"}:rob`);

  await runRoute(ct, def, bindings, opts.reverse === true);
}

async function runRoute(
  { api, w }: JshCli.RunArg,
  def: Route,
  bindings: [role: string, npcKey: string][],
  reverse: boolean,
) {
  const npcs = bindings.map(([, npcKey]) => w.npc.get(npcKey));

  // a track failing, or a kill, stops the rest — whatever they are waiting on
  let stop: (e: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => (stop = reject));
  stopped.catch(() => {});
  function fail(e: Error) {
    stop(e);
    for (const npc of npcs) npc.rejectAll(e);
  }

  const handlers = api.handleStatus({
    cleanup: (killed) => void (killed === true && fail(api.getKillError())),
    onSuspend() {
      // a fade must complete, as `move` lets it; the step is re-issued on resume
      for (const npc of npcs) {
        if (npc.isFading() === false && (npc.isMoving() || npc.isLooking())) npc.rejectAll(Error("paused"));
      }
      return true;
    },
  });

  const { sync, signal, awaitSignal } = createSyncPoints(bindings.map(([role]) => def.tracks[role]));

  async function doStep(step: RouteStep, next: RouteStep | undefined, role: string, npcKey: string) {
    switch (step.kind) {
      case "move": {
        const grKey = w.e.findRoomContaining(step.at)?.grKey ?? null;
        if (grKey !== step.grKey)
          api.writeError(`route: ${role}'s waypoint ${JSON.stringify(step.at)} was in ${step.grKey}, now ${grKey}`);
        const npc = w.npc.get(npcKey);
        npc.last.unreachableResult = null;
        // straight through a waypoint with nothing to do there
        await w.npc.move({ npcKey, to: step.at, arrive: next?.kind !== "move" });
        // a locked door is no error to `move`: it stops them at the door, and says so here
        const blocked = npc.last.unreachableResult as JshCli.NpcUnreachableResult | null;
        if (blocked !== null) throw Error(`${role}: locked door`);
        return;
      }
      case "do": {
        const d = w.decor.byKey[step.decorKey];
        if (d === undefined || d.type !== "point") throw Error(`no such decor point: ${step.decorKey}`);
        await w.npc.move({ npcKey, to: { x: d.x, y: d.y, meta: d.meta } });
        return;
      }
      case "wait":
        await Promise.race([api.sleep(step.ms / 1000), stopped]);
        return;
      case "look":
        await w.npc.get(npcKey).look({ at: step.at });
        return;
      case "open":
      case "close":
        if (!w.helper.isGmDoorKey(step.gdKey)) throw Error(`invalid gdKey: ${step.gdKey}`);
        w.e.toggleDoor(step.gdKey, step.kind === "open" ? { open: true } : { close: true });
        w.view.forceUpdate();
        return;
      case "say":
        w.speech.say(npcKey, step.words, step.secs);
        return;
      case "sync":
        await Promise.race([sync(step.code), stopped]);
        return;
      case "signal":
        signal(step.code);
        return;
      case "await":
        await Promise.race([awaitSignal(step.code), stopped]);
        return;
    }
  }

  async function runTrack(role: string, npcKey: string) {
    const forwards = def.tracks[role];
    let backwards = reverse;
    if (forwards.some((s) => s.kind === "signal" || s.kind === "await") && (reverse || def.loop === "pingpong")) {
      api.writeError(`route: ${role} has a signal/await, which reversed may wait on the wrong side`);
    }
    do {
      const steps = backwards ? reverseTrack(forwards) : forwards;
      for (const [i, step] of steps.entries()) {
        // a paused step is re-issued once resumed, from wherever the npc stopped
        while (true) {
          try {
            await doStep(step, steps[i + 1], role, npcKey);
            await api.awaitResume(); // a fade let finish whilst suspended
            break;
          } catch (e) {
            if (isPaused(e) === false) throw e;
            await api.awaitResume();
          }
        }
      }
      if (def.loop === "pingpong") backwards = !backwards;
    } while (def.loop !== undefined);
  }

  try {
    await Promise.all(
      bindings.map(([role, npcKey]) =>
        runTrack(role, npcKey).catch((e) => {
          fail(e);
          throw e;
        }),
      ),
    );
  } finally {
    handlers.dispose();
  }
}

/** The `sync` barriers and one-way `signal`/`await`s of one run, over the tracks it binds */
function createSyncPoints(tracks: RouteStep[][]) {
  // how many tracks meet at each barrier
  const parties = new Map<string, number>();
  for (const steps of tracks) {
    const codes = new Set(steps.flatMap((s) => (s.kind === "sync" ? [s.code] : [])));
    for (const code of codes) parties.set(code, (parties.get(code) ?? 0) + 1);
  }
  const barriers = new Map<string, { arrived: number; release: (() => void)[] }>();
  const given = new Set<string>();
  const awaiting = new Map<string, (() => void)[]>();

  return {
    sync(code: string) {
      const b = barriers.get(code) ?? { arrived: 0, release: [] };
      barriers.set(code, b);
      if (++b.arrived < (parties.get(code) ?? 1)) return new Promise<void>((resolve) => b.release.push(resolve));
      barriers.delete(code); // the next arrival starts a new round
      for (const release of b.release) release();
      return Promise.resolve();
    },
    signal(code: string) {
      given.add(code);
      for (const release of awaiting.get(code) ?? []) release();
      awaiting.delete(code);
    },
    awaitSignal(code: string) {
      if (given.has(code)) return Promise.resolve();
      const release = awaiting.get(code) ?? [];
      awaiting.set(code, release);
      return new Promise<void>((resolve) => release.push(resolve));
    },
  };
}

/**
 * Append to a route's track, making it if need be: points from stdin or `to:` become `move`
 * steps in the room each lies in; `step:` is any step. `loop:` sets the route's loop, `null` none
 * ```sh
 * pick 3 | route_add patrol guard
 * route_add patrol guard to:$( pick 1 )
 * route_add patrol guard step:'{ kind: "wait", ms: 2000 }'
 * route_add patrol loop:pingpong
 * ```
 */
export async function route_add(
  ct: JshCli.RunArg,
  opts: {
    to?: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
    step?: RouteStep;
    loop?: Route["loop"] | null;
  } = ct.api.jsArg(ct.args),
) {
  const { api, args, w } = ct;
  const [name, role] = api.getJsOperands(args, opts);
  if (name === undefined) throw Error("expected route name");
  const def = routes.get(name) ?? { tracks: {} };

  if (opts.loop === null) delete def.loop;
  else if (opts.loop !== undefined) def.loop = opts.loop;

  if (role === undefined) {
    if (opts.to !== undefined || opts.step !== undefined) throw Error("expected role e.g. route_add patrol guard");
    return routes.set(w, name, def);
  }

  const steps = (def.tracks[role] ??= []);
  const start = steps.length;
  for (const point of toPoints(opts.to)) steps.push(moveStep(w, point));
  if (opts.step !== undefined) steps.push(opts.step);
  routes.set(w, name, def);
  if (api.isTtyAt(0)) return;

  // piped points are saved one by one, so the track is drawn as it is picked...
  const handlers = api.handleStatus({
    cleanup(killed) {
      // ...and a kill takes back what this run added, nodes and all
      if (killed !== true) return;
      steps.length = start;
      if (steps.length === 0) delete def.tracks[role];
      if (Object.keys(def.tracks).length === 0) routes.remove(w, name);
      else routes.set(w, name, def);
    },
  });
  try {
    let datum: any;
    while ((datum = await api.read()) !== api.eof) {
      steps.push(moveStep(w, datum));
      routes.set(w, name, def);
    }
  } finally {
    handlers.dispose();
  }
}

function toPoints(to: undefined | JshCli.PointAnyFormat | JshCli.PointAnyFormat[]): JshCli.PointAnyFormat[] {
  if (to === undefined) return [];
  return Array.isArray(to) && typeof to[0] !== "number"
    ? (to as JshCli.PointAnyFormat[])
    : [to as JshCli.PointAnyFormat];
}

function moveStep(w: JshCli.WorldState, point: JshCli.PointAnyFormat): RouteStep {
  if (!w.helper.isPointAnyFormat(point)) throw Error(`expected point: ${JSON.stringify(point)}`);
  const grKey = w.e.findRoomContaining(point)?.grKey;
  if (grKey === undefined) throw Error(`not in a room: ${JSON.stringify(point)}`);
  const { x, y } = w.helper.parseGroundPoint(point); // sans any pick meta
  return { kind: "move", at: { x, y }, grKey };
}

/**
 * ```sh
 * route_rm patrol
 * route_rm patrol guard
 * ```
 */
export function route_rm(ct: JshCli.RunArg, opts: Record<string, boolean> = ct.api.jsArg(ct.args)) {
  const { api, args, w } = ct;
  const [name, role] = api.getJsOperands(args, opts);
  const def = routes.get(name);
  if (def === undefined) throw Error(`no such route: ${name}`);
  if (role === undefined) return routes.remove(w, name);
  if (!(role in def.tracks)) throw Error(`no such role: ${role}`);
  delete def.tracks[role];
  routes.set(w, name, def);
}

const trackColors = ["gold", "deeppink", "aquamarine", "orange", "violet", "springgreen"];
const edgeWidth = 0.03;
/** An open node's ui sits this far up */
const nodeLift = 0.6;

/**
 * Every route's waypoints and the edges between them as runtime decor, a colour per role — so
 * they are pickable, and `meta` says which step. Shown by the "Routes" debug toggle
 */
function drawRoutes(w: JshCli.WorldState) {
  const isRoute = (key: string) => key.startsWith("route:");
  w.decor.remove(...Object.keys(w.decor.runtime.byKey).filter(isRoute));
  w.labels.remove(...[...w.labels.byKey.keys()].filter(isRoute));
  if (w.debug?.routesShown === true) {
    for (const [name, def] of Object.entries(routes.all())) {
      Object.entries(def.tracks).forEach(([role, steps], i) =>
        drawTrack(w, name, role, steps, trackColors[i % trackColors.length]),
      );
    }
  }
  // an open node follows its step, or goes with it
  for (const key of [...w.html.byKey.keys()].filter(isRoute)) {
    const meta = w.decor.runtime.byKey[key]?.meta;
    const ui = meta !== undefined && isDecorRouteNode(meta) ? nodeUi(w, meta.route, meta.role, meta.stepIndex) : null;
    ui === null ? w.html.hide(key) : w.html.show(key, ui.at, ui.node, { onHide: () => w.labels.add(key, ui.label) });
  }
  w.view.forceUpdate();
}

/** What a route node shows once clicked: its waypoint and the steps done there, and the label it stands in for */
function nodeUi(w: JshCli.WorldState, name: string, role: string, stepIndex: number) {
  const steps = routes.get(name)?.tracks[role];
  const group = steps === undefined ? undefined : groupByWaypoint(steps).find((g) => g[0]?.[0] === stepIndex);
  const at = group === undefined ? null : waypointOf(w, group[0][1]);
  if (group === undefined || at === null) return null;
  return {
    at: { ...at, y3d: nodeLift },
    node: createElement(RouteNodeUi, { name, role, steps: group }),
    label: labelOf(at, group),
  };
}

/** A node's kind label: what is done there */
function labelOf(at: Geom.VectJson, group: [number, RouteStep][]) {
  return { x: at.x, y: at.y, text: group.map(([, s]) => s.kind).join(" · ") };
}

function drawTrack(w: JshCli.WorldState, name: string, role: string, steps: RouteStep[], color: string) {
  // coloured through `meta`, which a rebuild of the runtime instances reads back; a tint would be lost
  const meta = { shown: true, noPersist: true, route: name, role, tint: color, color };
  let prev: Geom.VectJson | null = null;
  for (const group of groupByWaypoint(steps)) {
    const [stepIndex, step] = group[0] ?? [];
    const at = step === undefined ? null : waypointOf(w, step);
    if (at === null) continue;
    const key = `route:${name}:${role}:${stepIndex}`;
    w.decor.create({
      type: "point",
      key,
      x: at.x,
      y: at.y,
      img: "number-zero",
      orient: 0,
      y3d: 0.01,
      meta: { ...meta, stepIndex },
    });
    if (w.html.byKey.has(key) === false) w.labels.add(key, labelOf(at, group)); // else its ui is up
    if (prev !== null) {
      w.decor.create({
        type: "rect",
        key: `${key}-edge`,
        x: prev.x,
        y: prev.y,
        width: Math.hypot(at.x - prev.x, at.y - prev.y),
        height: edgeWidth,
        angle: Math.atan2(at.y - prev.y, at.x - prev.x),
        meta: { ...meta, edgeTo: stepIndex },
      });
    }
    prev = at;
  }
}
