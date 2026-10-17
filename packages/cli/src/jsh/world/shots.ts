/**
 * How phaser shots end, by these odds: else hits — see `docs/engagements.md`.
 * - player's hud debug phaser badge overrides them
 * - 🚧 to be replaced by other logic
 *
 * ```sh
 * shots missed:0.2 dodged:0.2 shielded:0.1
 * shots off
 * ```
 */
export function shots({ api, args, w }: JshCli.RunArg) {
  if (args[0] === "off") return void (w.e.shotResolver = null);
  const opts: Partial<Record<JshCli.ShotOutcome, unknown>> = api.jsArg(args);
  const odds = outcomes.map((outcome) => [outcome, Number(opts[outcome] ?? 0)] as const);
  if (odds.some(([, p]) => !(p >= 0)) || odds.reduce((sum, [, p]) => sum + p, 0) > 1) {
    throw Error("expected odds from 0 to 1, adding up to 1 at most");
  }
  w.e.shotResolver = () => {
    let r = Math.random();
    for (const [outcome, p] of odds) if ((r -= p) < 0) return outcome;
    return "hit";
  };
}

const outcomes = ["missed", "dodged", "shielded"] as const;
