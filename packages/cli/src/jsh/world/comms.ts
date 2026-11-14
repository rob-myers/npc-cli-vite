import { spotQueryDetached, unfaced } from "./perception.main";

/**
 * What a conversation's replies wait on: each need defined on the World, and tested whilst a talk is held.
 * Idempotent, as `inventory` — see `docs/scenarios.md`
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
      // its replies are hidden until they answer, so its pips are left be
      if (talk === undefined || talk.answer !== null) continue;
      const test = { threadKey, talk, met: [] as string[] };
      tests.push(test);
      const player = w.n[talk.playerKey];
      const npc = w.n[talk.npcKey];
      if (player === undefined || npc === undefined || repliesShown(w, threadKey) === false) continue;
      const needs = new Set((talk.conv.nodes[talk.at]?.choices ?? []).flatMap((choice) => choice.needs ?? []));
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
      const fresh = tests.filter(({ threadKey, talk }) => w.speech.talks[threadKey] === talk && talk.answer === null);
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
    if (e.key === "talk-line") void test(w, [e.threadKey]);
  });
}

/** Whether the thread's replies may be drawn: the comms tab open on it unfolded, its player the player */
function repliesShown(w: JshCli.WorldState, threadKey: string) {
  return (
    w.speech.panelOpen === true &&
    w.speech.panelTab === "comms" &&
    w.speech.folded.has(threadKey) === false &&
    w.player?.key === w.speech.talks[threadKey]?.playerKey
  );
}

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
