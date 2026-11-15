import { type TalkChoice, threadKeyOf } from "@npc-cli/ui__world/talk";
import { spotQueryDetached, unfaced } from "./perception.main";

/**
 * What a conversation's replies wait on: each need defined on the World, and tested whilst a talk is held.
 * Idempotent, as `inventory` — see `docs/speech.md`
 * ```sh
 * comms
 * comms off
 * ```
 */
export function comms({ args, w }: JshCli.RunArg) {
  if (args[0] === "off") {
    w.e.keyedTick.delete(commsKey);
    w.e.keyedListener.delete(commsKey);
    w.speech.removeNeeds(Object.keys(commsNeeds));
    return;
  }

  w.speech.defineNeeds(
    Object.fromEntries(Object.entries(commsNeeds).map(([key, { label, icon }]) => [key, { label, icon }])),
  );

  const s = {
    /** A batch is awaiting the worker */
    asking: false,
    /** Threads to test once it answers */
    again: new Set<string>(),
    testedAt: Number.NEGATIVE_INFINITY,
  };

  /** Tests the threads' needs, the worker's in one query */
  const test = async (w: JshCli.WorldState, threadKeys: Iterable<string>) => {
    if (s.asking) {
      for (const threadKey of threadKeys) s.again.add(threadKey);
      return;
    }

    const tests: { threadKey: string; talk: JshCli.WorldState["speech"]["talks"][string]; met: string[] }[] = [];
    const asked: { test: (typeof tests)[number]; need: string }[] = [];
    const queries: WW.SpotQuery[] = [];

    for (const threadKey of threadKeys) {
      const talk = w.speech.talks[threadKey];
      if (talk === undefined || talk.replies.length === 0) continue;
      const needs = new Set(talk.replies.flatMap((choice) => choice.needs ?? []));
      if (needs.size === 0) continue;
      const test = { threadKey, talk, met: [] as string[] };
      tests.push(test);
      const player = w.n[talk.toKey];
      const npc = w.n[talk.npcKey];
      if (player === undefined || npc === undefined || repliesShown(w, threadKey) === false) continue;
      for (const need of needs) {
        const def = commsNeeds[need];
        if (def === undefined || def.met(w, player, npc) === false) continue;
        const query = def.ask?.(w, player, npc);
        if (query === undefined) {
          test.met.push(need);
        } else {
          asked.push({ test, need });
          queries.push(query);
        }
      }
    }
    if (tests.length === 0) return;

    s.asking = queries.length > 0;
    try {
      const answers = queries.length === 0 ? [] : await spotQueryDetached(w, queries).catch(() => []);
      asked.forEach(({ test, need }, i) => {
        if (commsNeeds[need].answered?.(answers[i]) === true) test.met.push(need);
      });
      // only where nothing changed whilst asked
      const fresh = tests.filter(
        ({ threadKey, talk }) => w.speech.talks[threadKey] === talk && talk.replies.length > 0,
      );
      w.speech.setMet(
        Object.fromEntries(
          fresh.map(({ threadKey, met }) => [threadKey, repliesShown(w, threadKey) ? met : []] as const),
        ),
      );
    } finally {
      s.asking = false;
    }
    if (s.again.size > 0) {
      const again = [...s.again];
      s.again.clear();
      void test(w, again);
    }
  };

  w.e.addKeyedTick(commsKey, (w) => {
    const now = w.gameTime.now();
    if (now - s.testedAt < commsConfig.everySecs) return;
    s.testedAt = now;
    void test(w, Object.keys(w.speech.talks));
  });

  w.e.addKeyedListener(commsKey, (e, w) => {
    if (e.key === "talk-ask") void test(w, [e.threadKey]);
  });
}

/** Whether the thread's replies may be drawn: the comms tab open on it unfolded, the player the one asked */
function repliesShown(w: JshCli.WorldState, threadKey: string) {
  return (
    w.speech.panelOpen === true &&
    w.speech.panelTab === "comms" &&
    w.speech.folded.has(threadKey) === false &&
    w.player?.key === w.speech.talks[threadKey]?.toKey
  );
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
 * `with:` answers the ask of `npc:` with a reply's key, each the player unless given
 * ```sh
 * reply friend npc:abe with:bob
 * reply friend npc:abe
 * ```
 */
export function reply({ api, args, w }: JshCli.RunArg) {
  const opts = api.jsArg(args) as TalkOpts;
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
 * Each need a reply may name: a pip in the speech history, green once `met`.
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
  /** Seconds of game time between tests */
  everySecs: 0.2,
};
