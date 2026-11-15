import { type TalkChoice, threadKeyOf } from "@npc-cli/ui__world/talk";
import { spotQueryDetached, unfaced } from "./perception.main";

/**
 * What a reply waits on: each need defined on the World, and tested when the player presses it. A "Say again?" is said again.
 * Idempotent, as `inventory` — see `docs/speech.md`
 * ```sh
 * comms
 * comms off
 * ```
 */
export function comms({ args, w }: JshCli.RunArg) {
  if (args[0] === "off") {
    w.e.keyedListener.delete(commsKey);
    w.speech.removeNeeds(Object.keys(commsNeeds));
    return;
  }

  w.speech.defineNeeds(
    Object.fromEntries(Object.entries(commsNeeds).map(([key, { label, icon }]) => [key, { label, icon }])),
  );

  w.e.addKeyedListener(commsKey, (e, w) => {
    if (e.key === "talk-choose") void decide(w, e);
    // as yet, always said again
    if (e.key === "speech-repeat") w.speech.repeat(e.id);
  });
}

/** Says the pressed reply, or refuses it with the needs that failed */
async function decide(w: JshCli.WorldState, e: Extract<JshCli.Event, { key: "talk-choose" }>) {
  const player = w.n[e.npcKey];
  const npc = w.n[e.to];
  const failed = player === undefined || npc === undefined ? e.needs : await unmet(w, e.needs, player, npc);
  // too late, e.g. refused on timeout
  if (w.speech.talks[e.threadKey]?.choosing !== e.choice) return;
  if (failed.length === 0) w.speech.reply(e.threadKey, e.choice);
  else w.speech.refuse(e.threadKey, e.choice, failed);
}

/** The needs not met between the one asked and the asker. Those asking the worker go in one query */
async function unmet(w: JshCli.WorldState, needs: string[], player: JshCli.Npc, npc: JshCli.Npc) {
  const failed: string[] = [];
  const asked: string[] = [];
  const queries: WW.SpotQuery[] = [];
  for (const need of needs) {
    const def = commsNeeds[need];
    if (def === undefined || def.met(w, player, npc) === false) {
      failed.push(need);
      continue;
    }
    const query = def.ask?.(w, player, npc);
    if (query !== undefined) {
      asked.push(need);
      queries.push(query);
    }
  }
  if (queries.length > 0) {
    const answers = await spotQueryDetached(w, queries).catch(() => []);
    asked.forEach((need, i) => commsNeeds[need].answered?.(answers[i]) !== true && failed.push(need));
  }
  return failed;
}

/**
 * `with:` asks `npc:`, each the player unless given. Each other `key:"text"` is a reply, its needs first in brackets
 * ```sh
 * ask "Who goes there?" with:abe friend:"A friend" foe:"[near] Step aside"
 * ask npc:bob "Who goes there?" with:abe friend:"A friend"
 * ask npc:abe "Got a light?" yes:Sure no:Sorry topic:smoke
 * ```
 */
export function ask({ api, args, w }: JshCli.RunArg) {
  const opts = api.jsArg(args) as TalkOpts;
  const [npcKey, toKey] = partiesOf(w, opts);
  const operands = api.getJsOperands(args, opts);
  const replies = Object.entries(opts).flatMap(([key, value]) =>
    talkOptKeys.has(key) || operands.includes(key) ? [] : [toChoice(key, String(value))],
  );
  const topic = opts.topic === undefined ? undefined : String(opts.topic);
  w.speech.ask(npcKey, toKey, lineOf(operands), replies, { topic });
}

/**
 * `with:` ends their talk with `npc:`, each the player unless given
 * ```sh
 * bye with:abe
 * bye npc:abe
 * ```
 */
export function bye({ api, args, w }: JshCli.RunArg) {
  const [npcKey, toKey] = partiesOf(w, api.jsArg(args) as TalkOpts);
  w.speech.bye(npcKey, toKey);
}

/**
 * `with:` answers the ask of `npc:` with a reply's key, each the player unless given. `to:` is an alias of `npc:`
 * ```sh
 * reply friend to:abe
 * reply friend npc:abe with:bob
 * ```
 */
export function reply({ api, args, w }: JshCli.RunArg) {
  const opts = api.jsArg(args, { to: "npc" }) as TalkOpts;
  const [npcKey, toKey] = partiesOf(w, opts);
  const [key] = api.getJsOperands(args, opts);
  const threadKey = threadKeyOf([npcKey, toKey]);
  if (w.speech.talks[threadKey]?.toKey !== npcKey || w.speech.reply(threadKey, key) === false) {
    throw Error(`${toKey} offers ${npcKey} no reply: ${key}`);
  }
}

/**
 * `with:` tells `npc:`, each the player unless given
 * ```sh
 * tell "Move along" with:abe
 * tell npc:bob "Move along" with:abe
 * tell npc:abe "Move along"
 * ```
 */
export function tell({ api, args, w }: JshCli.RunArg) {
  const opts = api.jsArg(args) as TalkOpts;
  const [npcKey, toKey] = partiesOf(w, opts);
  w.speech.tell(npcKey, toKey, lineOf(api.getJsOperands(args, opts)));
}

/** The bare words, as a line */
function lineOf(operands: string[]) {
  const line = operands.join(" ");
  if (line === "") throw Error("nothing to say");
  return line;
}

/** Who speaks (`with:`) and who is spoken to (`npc:`), each the player unless given */
function partiesOf(w: JshCli.WorldState, opts: TalkOpts): [string, string] {
  const playerKey = w.player?.key;
  const from = opts.with ?? playerKey;
  const to = opts.npc ?? playerKey;
  if (from === undefined || to === undefined) throw Error("no player");
  if (from === to) throw Error(`${from} cannot talk to themself`);
  return [w.npc.get(String(from)).key, w.npc.get(String(to)).key];
}

/** `"[near,psi] Step aside"` as a reply needing `near` and `psi` */
function toChoice(key: string, value: string): TalkChoice {
  const [, needs, text] = value.match(/^\[([^\]]*)\]\s*(.*)$/) ?? [];
  if (needs === undefined) return { key, text: value };
  return { key, text, needs: needs.split(",").flatMap((need) => need.trim() || []) };
}

type TalkOpts = { with?: unknown; npc?: unknown; topic?: unknown } & Record<string, unknown>;

/** Options of `ask` that are not replies */
const talkOptKeys = new Set(["with", "npc", "topic"]);

/**
 * Each need a reply may name: a pip on it, tested when pressed.
 * One that `ask`s the worker is met only if `answered` too
 */
export const commsNeeds: Record<
  string,
  {
    label: string;
    icon?: string;
    met(w: JshCli.WorldState, player: JshCli.Npc, npc: JshCli.Npc): boolean;
    ask?(w: JshCli.WorldState, player: JshCli.Npc, npc: JshCli.Npc): WW.SpotQuery;
    answered?(answer: undefined | WW.SpotAnswer): boolean;
  }
> = {
  near: {
    label: "near them",
    met: (_w, player, npc) =>
      Math.hypot(npc.point.x - player.point.x, npc.point.y - player.point.y) <= commsConfig.nearDist,
  },
  facing: {
    label: "facing them",
    met(_w, player, npc) {
      const look = -player.rotation.y - Math.PI / 2;
      const bearing = Math.atan2(npc.point.y - player.point.y, npc.point.x - player.point.x);
      return Math.abs(Math.atan2(Math.sin(bearing - look), Math.cos(bearing - look))) <= commsConfig.facingArc;
    },
  },
  psi: {
    label: "psi raised",
    met: (w) => w.e.isPsiRaised(),
  },
  sees: {
    label: "sees them",
    met: (w, player, npc) => unfaced(w, player.key, npc.key) === null,
    ask: (_w, player, npc) => ({ q: "sees", a: player.key, b: npc.key }),
    answered: (answer) => answer != null && "crouchHides" in answer && answer.sees,
  },
};

const commsKey = "comms";

const commsConfig = {
  /** Metres apart, at most, to be `near` */
  nearDist: 1.6,
  /** Radians either side of straight ahead still `facing` */
  facingArc: Math.PI / 5,
};
