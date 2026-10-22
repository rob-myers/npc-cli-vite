import { spotQuery } from "./perception.main";

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
 * Spots: whether one sees another, doors shut, else the door it would through. Alone, every spot it sees
 *
 * ```sh
 * sees rob abe cal
 * sees --all abe ben cal
 * sees g0s12 g0s40
 * sees g0s12
 * ```
 */
export async function* sees(ct: JshCli.RunArg) {
  const { all } = ct.api.jsArg(ct.args, { "--all": "all" }) as { all?: boolean };
  const keys = ct.args.filter((arg) => arg.startsWith("-") === false);
  const [a, b] = keys;
  if (a === undefined) throw Error("expected npcs or spots");
  if (b !== undefined && keys.every((key) => ct.w.n[key] !== undefined)) {
    const pairs =
      all === true
        ? keys.flatMap((u) => keys.flatMap((v) => (u === v ? [] : [[u, v]])))
        : keys.slice(1).map((v) => [a, v]);
    const seen = await perceive(ct, pairs as [string, string][]);
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
 * The worker's lines decide the last, e.g. over a low obstacle hiding one crouched
 */
async function perceive(ct: JshCli.RunArg, pairs: [string, string][]) {
  const { w } = ct;
  const facing = pairs.filter(([a, b]) => {
    const [watcher, seen] = [w.n[a], w.n[b]];
    if (watcher.anim.eyes.look === "shut") return false;
    const off = watcher.anim.bearingOf(seen.point) - watcher.lookY; // the head's way, e.g. sat and turned
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sightHalfArc;
  });
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

/** Radians either side of where their head faces that an npc sees */
const sightHalfArc = Math.PI / 3;

/** `a,b,c` as a list, e.g. `room:g0r1,g0r2` */
const csv = (x: undefined | string) => (x === undefined ? undefined : String(x).split(","));

/** An answer, unless it is an error, which is thrown */
function answered(answer: undefined | WW.SpotAnswer) {
  if (answer !== null && answer !== undefined && "error" in answer) throw Error(answer.error);
  return answer;
}
