import { wallHeight } from "@npc-cli/ui__world/const.env";
import { spotKindInk } from "@npc-cli/ui__world/spot.schema";
import { getSpotsRev, spotQuery, spotQueryDetached } from "./perception.main";

/**
 * The map's spots: in rooms, of kinds, or near an npc, nearest first. With `of`, every spot an npc is at.
 * Answered by the worker — see `docs/spots.md`
 *
 * ```sh
 * spots room:g0r16 kind:cover,corner
 * spots near:rob within:3
 * spots of:rob
 * ```
 */
export async function* spots(ct: JshCli.RunArg) {
  const opts: { room?: string; kind?: string; near?: string; within?: number; of?: string } = ct.api.jsArg(ct.args);
  const [found] = await spotQuery(ct, [
    opts.of !== undefined
      ? { q: "of", npc: opts.of, all: true }
      : {
          q: "list",
          rooms: csv(opts.room),
          kinds: csv(opts.kind),
          near: opts.near === undefined ? undefined : { npc: opts.near, within: opts.within ?? 3 },
        },
  ]);
  yield* answered(found) as WW.SpotJson[];
}

/**
 * Npcs: those the first sees, or with `--all` each ordered pair `a b` where `a` sees `b`. Exits 1 if none.
 * `--los` asks for line of sight alone, whatever their eyes and facing.
 * `--debug` says why, then again as that changes, drawing the rays it needed, until killed.
 * Spots: whether one sees another, doors shut, else the door it would through. Alone, every spot it sees
 *
 * ```sh
 * sees rob abe cal
 * sees --all abe ben cal
 * sees --los --all abe ben
 * sees --debug rob kate
 * sees g0s12 g0s40
 * sees g0s12
 * ```
 */
export async function* sees(ct: JshCli.RunArg) {
  const flags = { "--all": "all", "--los": "los", "--debug": "debug" };
  const { all, los, debug } = ct.api.jsArg(ct.args, flags) as { all?: boolean; los?: boolean; debug?: boolean };
  const keys = ct.args.filter((arg) => arg.startsWith("-") === false);
  const [a, b] = keys;
  if (a === undefined) throw Error("expected npcs or spots");
  if (debug === true) {
    if (b === undefined) throw Error("expected two npcs or spots");
    yield* watchSight(ct, pairsOf(keys, all === true), los === true);
    return;
  }
  if (b !== undefined && keys.every((key) => ct.w.n[key] !== undefined)) {
    const seen = await perceive(ct, pairsOf(keys, all === true), los === true);
    if (seen.length === 0) throw ct.api.getShError("", 1);
    yield* seen.map(([u, v]) => (all === true ? `${u} ${v}` : v));
    return;
  }
  const [answer] = await spotQuery(ct, [b === undefined ? { q: "seenBy", a } : { q: "sees", a, b }]);
  const result = answered(answer);
  if (Array.isArray(result)) yield* result;
  else yield result;
}

/**
 * One spot: the one an npc is at (the nearest in their room), else by key
 *
 * ```sh
 * spot of:rob
 * spot g0s116
 * ```
 */
export async function spot(ct: JshCli.RunArg) {
  const opts: { of?: string } = ct.api.jsArg(ct.args);
  const [answer] = await spotQuery(ct, [
    opts.of === undefined ? { q: "get", key: ct.args[0] ?? "" } : { q: "of", npc: opts.of },
  ]);
  return answered(answer);
}

/**
 * The pairs whose first sees the second: eyes open, within `sightHalfArc` of where their head faces, then in sight.
 * The worker decides the last, e.g. a low obstacle hiding one crouched. `los` asks only that
 */
async function perceive(ct: JshCli.RunArg, pairs: [string, string][], los: boolean) {
  const facing = pairs.filter(([a, b]) => los || faces(ct.w, a, b));
  if (facing.length === 0) return [];
  const answers = await spotQuery(
    ct,
    facing.map(([a, b]) => ({ q: "sees", a, b })),
  );
  return facing.filter((_, i) => {
    const x = answers[i];
    return x != null && "crouchHides" in x && x.sees;
  });
}

/** The first and each of the rest, else with `all` every ordered pair */
function pairsOf(keys: string[], all: boolean): [string, string][] {
  return all
    ? keys.flatMap((u) => keys.flatMap((v): [string, string][] => (u === v ? [] : [[u, v]])))
    : keys.slice(1).map((v): [string, string] => [keys[0], v]);
}

/** Npc `a`'s eyes are open, and `b` is within `sightHalfArc` of where their head faces */
function faces(w: JshCli.WorldState, a: string, b: string) {
  return unfaced(w, a, b) === null;
}

/** Why npc `a` cannot see `b` for their eyes or the way their head faces, else `null` */
function unfaced(w: JshCli.WorldState, a: string, b: string) {
  const [watcher, seen] = [w.n[a], w.n[b]];
  if (watcher.anim.eyes.look === "shut") return "eyes shut";
  const off = watcher.anim.bearingOf(seen.point) - watcher.lookY; // the head's way, e.g. sat and turned
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sightHalfArc ? null : "fov";
}

/** Radians either side of where their head faces that an npc sees */
const sightHalfArc = Math.PI / 3;

/**
 * Until killed, why each pair's first sees the second or not: said at first, then each time that changes.
 * Every `watchSecs` the rays a verdict needed are drawn: to the centre, then either side until one is clear
 */
async function* watchSight(ct: JshCli.RunArg, pairs: [string, string][], los: boolean) {
  const { api, w } = ct;
  /** By pair, what was last said: whether it sees, and why */
  const said = new Map<string, string>();
  let drawn = new Set<string>();
  let killed = () => {};
  const stopped = new Promise<void>((resolve) => void (killed = resolve));
  const handlers = api.handleStatus({ cleanup: () => killed() });
  try {
    while (true) {
      const why = pairs.map(([a, b]) =>
        los || w.n[a] === undefined || w.n[b] === undefined ? null : unfaced(w, a, b),
      );
      const asked = pairs.filter((_, i) => why[i] === null);
      const answers =
        asked.length === 0
          ? []
          : await spotQuery(
              ct,
              asked.map(([a, b]) => ({ q: "explain", a, b })),
            );
      const rays = new Set<string>();
      /** What changed this look, said seen first */
      const changed: { sees: boolean; line: string }[] = [];
      const { ansi } = api;
      for (const [i, [a, b]] of pairs.entries()) {
        const answer = why[i] === null ? answered(answers[asked.indexOf(pairs[i])]) : null;
        const x = answer != null && "settled" in answer ? answer : null;
        const sees = x?.sees === true;
        const reason = why[i] ?? (x === null ? "?" : reasonOf(x, ansi));
        if (said.get(`${a} ${b}`) !== `${sees} ${reason}`) {
          said.set(`${a} ${b}`, `${sees} ${reason}`);
          const arrow = `${sees ? ansi.GreenBright : ansi.Red}→`; // `↛` renders too wide
          const line = `${ansi.White}${a} ${arrow}${ansi.Reset} ${ansi.White}${b} ${ansi.GreenBright}${reason}${ansi.Reset}`;
          changed.push({ sees, line });
        }
        if (x?.settled !== "lines") continue;
        const needed = x.sees ? x.lines.slice(0, x.lines.findIndex((line) => line.hit === null) + 1) : x.lines;
        for (const [k, { from, to, hit }] of needed.entries()) {
          const key = `sees-debug/${a}>${b}/${k}`;
          const end = hit ?? to;
          // the heights the worker tested, so a stopped ray ends on what stopped it
          const t =
            hit === null
              ? 1
              : Math.hypot(hit.x - from.x, hit.y - from.y) / (Math.hypot(to.x - from.x, to.y - from.y) || 1);
          w.debug.setPolyline(key, {
            points: [
              [from.x, from.y, x.eye],
              [end.x, end.y, x.eye + (x.top - x.eye) * t],
            ],
            // amber where low cover stopped one, yet another got over it
            color: hit === null ? "#40d080" : hit.kind === "low" && x.sees ? "#f0a030" : "#e04040",
            ...rayStyle,
          });
          rays.add(key);
        }
      }
      for (const { line } of changed.sort((u, v) => Number(v.sees) - Number(u.sees))) yield line;
      for (const key of drawn) if (rays.has(key) === false) w.debug.removePolyline(key);
      drawn = rays;
      w.view.forceUpdate();
      // rays drawn for someone moving keep up with them, a tick at a time
      const moving = drawn.size > 0 && pairs.some(([a, b]) => w.n[a]?.isMoving() || w.n[b]?.isMoving());
      const next = moving ? w.npc.nextTick() : w.e.wait(watchSecs);
      if ((await Promise.race([next.then(() => true), stopped.then(() => false)])) === false) {
        throw api.getKillError();
      }
    }
  } finally {
    handlers.dispose();
    for (const key of drawn) w.debug.removePolyline(key);
    w.view.forceUpdate();
  }
}

/** What settled a verdict, tersely */
function reasonOf(x: Extract<WW.SpotAnswer, { settled: string }>, ansi: JshCli.RunArg["api"]["ansi"]) {
  const pair = (x.pair ?? ["?", "?"]).join(" ");
  switch (x.settled) {
    case "rooms":
      return "room out of view";
    case "never":
      return "spots never";
    case "always":
      return `always ${pair}`;
    case "may":
      return `may ${pair}`;
    case "lines": {
      const kind = x.lines[0]?.hit?.kind;
      if (x.sees === false) return kind === "low" ? "crouched behind cover" : `blocked by ${kind ?? "?"}`;
      // rays go to the centre, then right, then left
      const clear = x.lines.findIndex((line) => line.hit === null);
      const partial = x.lines.slice(0, clear).some((line) => line.hit?.kind === "low");
      return `ray ${["direct", "right", "left"][clear]}${partial ? ` ${ansi.Orange}partial${ansi.GreenBright}` : ""}`;
    }
  }
}

/** Game seconds between looks at a pair: as quick as anyone would notice */
const watchSecs = 0.25;
/** Rays as `sees --debug` draws them: thin, faint, with small discs */
const rayStyle = { width: 0.008, opacity: 0.5, discRadius: 0.03 };

/**
 * Draws the map's spots in the World whilst its overlay is on (debug menu, overlay, spots), an icon per kind.
 * Each is coloured by sight from the chosen spot, else the player, kept up as they move and doors change (idempotent)
 *
 * ```sh
 * spot_overlay
 * spot_overlay off
 * ```
 */
export function spot_overlay({ args, w }: JshCli.RunArg) {
  if (args[0] === "off") {
    w.e.keyedListener.delete(overlayKey);
    w.e.keyedTick.delete(overlayKey);
    w.debug.setSpots([]);
    w.view.forceUpdate();
    return;
  }
  /** What was drawn: the spots, as of which map and files, then whose sight, from where */
  const drawn = { spots: "", from: "", at: null as null | Geom.VectJson, theme: "" };
  /** The spots as drawn: a remounted mesh, e.g. on its HMR, starts empty */
  const spotsKey = () => `${w.mapKey} ${w.gmsHash} ${getSpotsRev()} ${w.debug.spotsInst?.uuid}`;
  let [busy, again] = [false, false];

  /** Redraws what has changed, one query at a time */
  async function sync() {
    if (busy) return void (again = true);
    busy = true;
    try {
      if (w.debug.spotsShown === false) return;
      const key = spotsKey();
      if (drawn.spots !== key) {
        const [all] = await spotQueryDetached(w, [{ q: "list" }]);
        if (Array.isArray(all)) w.debug.setSpots(all.map((spot) => toDraw(w, spot)));
        drawn.spots = key;
      }
      const chosen = w.debug.chosenSpot;
      const from = chosen ?? (w.n[w.player.key] === undefined ? null : w.player.key);
      const [view] = from === null ? [null] : await spotQueryDetached(w, [{ q: "view", from }]);
      const ink = inkOf(w);
      const colors =
        view == null || !("view" in view)
          ? null
          : Object.fromEntries(Object.entries(view.view).map(([key, how]) => [key, ink[how]]));
      w.debug.colourSpots(colors, chosen);
      drawn.from = from ?? "";
      drawn.theme = w.themeKey;
      drawn.at = from === null || chosen !== null ? null : { ...w.n[from].point };
      w.view.forceUpdate();
    } finally {
      busy = false;
      if (again) (again = false), void sync();
    }
  }

  w.e.addKeyedListener(overlayKey, (e, w) => {
    if (e.key === "spots-overlay" && e.shown === false) return void (drawn.spots = "");
    // the rooms beyond fade out first, their spots in the colours they had
    if (e.key === "door-closed") return void setTimeout(() => void sync(), roomFadeOutMs);
    if (redrawOn.has(e.key) || (e.key === "enter-room" && e.npcKey === w.player.key)) void sync();
  });
  // moved far enough, the spot files remade, or the theme changed
  w.e.addKeyedTick(overlayKey, (w) => {
    if (w.debug.spotsShown === false || busy) return;
    const at = drawn.at;
    const npc = drawn.from === "" ? undefined : w.n[drawn.from];
    if (drawn.spots !== spotsKey() || drawn.theme !== w.themeKey) void sync();
    else if (at !== null && npc !== undefined && npc.distanceTo(at) >= overlayStep) void sync();
  });
  void sync();
}

const overlayKey = "spot-overlay";
/** Events after which the overlay is coloured afresh */
const redrawOn = new Set<string>(["spots-overlay", "spot-chosen", "set-player", "door-opening"]);
/** Milliseconds a room takes to fade out, on the wall clock: `ROOM_FADE_OUT_SECS` in `fade-rooms` */
const roomFadeOutMs = 600;
/** Metres the player walks before the overlay redraws */
const overlayStep = 0.5;

/** How each `view` answer is coloured, by theme: muted on a dark floor, mid tones on a light one. A chosen spot is its own */
const howInk: Record<"dark" | "light", Record<WW.SpotHow, string>> = {
  dark: { own: "#5b8cff", always: "#2f9a60", may: "#a89a30", shut: "#ffffff", never: "#8a929c" },
  light: { own: "#4a7cff", always: "#3cc870", may: "#f0b820", shut: "#ffffff", never: "#7a8490" },
};
const inkOf = (w: JshCli.WorldState) => howInk[w.themeKey === "light-theme" ? "light" : "dark"];

/**
 * A spot as the overlay draws it: a doable's icon by its decor's `do`, raised to its height, e.g. on a seat.
 * A door spot's atop its door. A wall's is its arrow alone
 */
function toDraw(w: JshCli.WorldState, spot: WW.SpotJson) {
  const meta = spot.kind === "doable" ? w.decor.byKey[spot.decorKey ?? ""]?.meta : undefined;
  const icon = spot.kind !== "doable" ? spot.kind : meta?.do === "sit" || meta?.do === "lie" ? meta.do : "do";
  const lift = spot.kind === "door" ? wallHeight : (meta?.y ?? 0);
  /** Cover, seats and beds are drawn without an arrow */
  const facing = spot.kind === "cover" || icon === "sit" || icon === "lie" ? undefined : spot.facing;
  const img = `icon--spot-${icon}`;
  return { ...spot, facing, img, color: spotKindInk[spot.kind], lift, iconHidden: spot.kind === "wall" };
}

/** `a,b,c` as a list, e.g. `room:g0r1,g0r2` */
const csv = (x: undefined | string) => (x === undefined ? undefined : String(x).split(","));

/** An answer, unless it is an error, which is thrown */
function answered(answer: undefined | WW.SpotAnswer) {
  if (answer !== null && answer !== undefined && "error" in answer) throw Error(answer.error);
  return answer;
}
