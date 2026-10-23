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
 * `--show` says what decided it, and draws the lines a while. Exits 1 if unseen.
 * Spots: whether one sees another, doors shut, else the door it would through. Alone, every spot it sees
 *
 * ```sh
 * sees rob abe cal
 * sees --all abe ben cal
 * sees --los --all abe ben
 * sees --show rob kate
 * sees g0s12 g0s40
 * sees g0s12
 * ```
 */
export async function* sees(ct: JshCli.RunArg) {
  const flags = { "--all": "all", "--los": "los", "--show": "show" };
  const { all, los, show } = ct.api.jsArg(ct.args, flags) as { all?: boolean; los?: boolean; show?: boolean };
  const keys = ct.args.filter((arg) => arg.startsWith("-") === false);
  const [a, b] = keys;
  if (a === undefined) throw Error("expected npcs or spots");
  if (show === true) {
    if (b === undefined) throw Error("expected two npcs or spots");
    yield await showSight(ct, a, b, los === true);
    return;
  }
  if (b !== undefined && keys.every((key) => ct.w.n[key] !== undefined)) {
    const pairs =
      all === true
        ? keys.flatMap((u) => keys.flatMap((v) => (u === v ? [] : [[u, v]])))
        : keys.slice(1).map((v) => [a, v]);
    const seen = await perceive(ct, pairs as [string, string][], los === true);
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

/** Npc `a`'s eyes are open, and `b` is within `sightHalfArc` of where their head faces */
function faces(w: JshCli.WorldState, a: string, b: string) {
  const [watcher, seen] = [w.n[a], w.n[b]];
  if (watcher.anim.eyes.look === "shut") return false;
  const off = watcher.anim.bearingOf(seen.point) - watcher.lookY; // the head's way, e.g. sat and turned
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sightHalfArc;
}

/** Radians either side of where their head faces that an npc sees */
const sightHalfArc = Math.PI / 3;

/**
 * What decided whether `a` sees `b`, e.g. `lines: seen`, its lines drawn for `showSecs` game seconds.
 * Green is clear, red stopped, amber by a low obstacle. Throws exit 1 after, if unseen
 */
async function showSight(ct: JshCli.RunArg, a: string, b: string, los: boolean) {
  const { api, w } = ct;
  const npcs = w.n[a] !== undefined && w.n[b] !== undefined;
  if (npcs && los === false && faces(w, a, b) === false) throw api.getShError("facing: unseen", 1);
  const [answer] = await spotQuery(ct, [{ q: "explain", a, b }]);
  const x = answered(answer);
  if (x == null || !("settled" in x)) throw Error(`${a} ${b}: cannot explain`);
  const keys = x.lines.map((_, i) => `sees-show/${i}`);
  x.lines.forEach(({ from, to, hit }, i) => {
    const end = hit ?? to;
    const color = hit === null ? "#40d080" : hit.kind === "low" ? "#f0a030" : "#e04040";
    w.debug.setPolyline(keys[i], {
      points: [
        [from.x, from.y],
        [end.x, end.y],
      ],
      color,
    });
  });
  w.view.forceUpdate();
  let killed = () => {};
  const handlers = api.handleStatus({ cleanup: () => killed() });
  try {
    await Promise.race([w.e.wait(showSecs), new Promise<void>((resolve) => void (killed = resolve))]);
  } finally {
    handlers.dispose();
    keys.forEach((key) => w.debug.removePolyline(key));
    w.view.forceUpdate();
  }
  if (x.sees === false) throw api.getShError(`${x.settled}: unseen`, 1);
  return `${x.settled}: seen`;
}

/** Game seconds `sees --show` draws its lines */
const showSecs = 4;

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
const redrawOn = new Set<string>(["spots-overlay", "spot-chosen", "set-player", "door-opening", "door-closed"]);
/** Metres the player walks before the overlay redraws */
const overlayStep = 0.5;

/** How each `view` answer is coloured, by theme: muted on a dark floor, mid tones on a light one. A chosen spot is its own */
const howInk: Record<"dark" | "light", Record<WW.SpotHow, string>> = {
  dark: { own: "#5b8cff", always: "#2f9a60", may: "#a89a30", shut: "#ffffff", never: "#3a3f46" },
  light: { own: "#4a7cff", always: "#3cc870", may: "#f0b820", shut: "#ffffff", never: "#c0c8d0" },
};
const inkOf = (w: JshCli.WorldState) => howInk[w.themeKey === "light-theme" ? "light" : "dark"];

/** A spot as the overlay draws it: a doable's icon by its decor's `do` */
function toDraw(w: JshCli.WorldState, spot: WW.SpotJson) {
  const doing = spot.kind === "doable" ? w.decor.byKey[spot.decorKey ?? ""]?.meta.do : undefined;
  const icon = spot.kind !== "doable" ? spot.kind : doing === "sit" || doing === "lie" ? doing : "do";
  return { ...spot, img: `icon--spot-${icon}`, color: spotKindInk[spot.kind] };
}

/** `a,b,c` as a list, e.g. `room:g0r1,g0r2` */
const csv = (x: undefined | string) => (x === undefined ? undefined : String(x).split(","));

/** An answer, unless it is an error, which is thrown */
function answered(answer: undefined | WW.SpotAnswer) {
  if (answer !== null && answer !== undefined && "error" in answer) throw Error(answer.error);
  return answer;
}
