import { spotQuery } from "./plan.main";

/**
 * The map's spots: in rooms, of kinds, or near an npc, nearest first. Answered by the worker — see `docs/spots.md`
 *
 * ```sh
 * spots room:g0r16 kind:cover,corner
 * spots near:rob within:3
 * ```
 */
export async function* spots(ct: JshCli.RunArg) {
  const opts: { room?: string; kind?: string; near?: string; within?: number } = ct.api.jsArg(ct.args);
  const [found] = await spotQuery(ct, [
    {
      q: "list",
      rooms: csv(opts.room),
      kinds: csv(opts.kind),
      near: opts.near === undefined ? undefined : { npc: opts.near, within: opts.within ?? 3 },
    },
  ]);
  yield* answered(found) as WW.SpotJson[];
}

/**
 * Whether one spot sees another, doors shut, else the door it would through. Alone, every spot it sees.
 * An npc stands for their spot
 *
 * ```sh
 * sees g0s12 g0s40
 * sees rob abe
 * sees g0s12
 * ```
 */
export async function* sees(ct: JshCli.RunArg) {
  const [a, b] = ct.args;
  if (a === undefined) throw Error("expected a spot key or an npc key");
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

/** `a,b,c` as a list, e.g. `room:g0r1,g0r2` */
const csv = (x: undefined | string) => (x === undefined ? undefined : String(x).split(","));

/** An answer, unless it is an error, which is thrown */
function answered(answer: undefined | WW.SpotAnswer) {
  if (answer !== null && answer !== undefined && "error" in answer) throw Error(answer.error);
  return answer;
}
