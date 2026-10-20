import { SigKillError, sessionApi } from "@npc-cli/cli";
import { getInstances, type ScInstance } from "@npc-cli/cli/sc";
import type { WorldState } from "@npc-cli/ui__world";
import { error } from "@npc-cli/util/legacy/generic";
import { useEffect, useState } from "react";

/** A definition's instances in tty `sessionKey`, read again on each `scenario` event, and each second whilst live */
export function useRuns(w: undefined | WorldState, defKey: string, sessionKey: undefined | string) {
  const [, setTick] = useState(0);
  const runs = Object.values(getInstances()).filter((run) => run.defKey === defKey && run.sessionKey === sessionKey);
  const live = runs.some((run) => run.status === "running");

  useEffect(() => {
    const sub = w?.events.subscribe({ next: (e) => e.key === "scenario" && setTick((t) => t + 1) });
    return () => sub?.unsubscribe();
  }, [w]);

  // a pause holds the director too, so no event says so: looked at again instead
  useEffect(() => {
    if (live === false) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);

  return runs;
}

/** By role, then phase: the npcs in the cell they are running */
export function chipsOf(run: ScInstance) {
  const chips: Record<string, Record<string, string[]>> = {};
  for (const n of Object.values(run.npcs)) {
    if (n.out !== true) ((chips[n.role] ??= {})[run.phase] ??= []).push(n.key);
  }
  return chips;
}

/** Runs `src` in tty `sessionKey` as a background job, as the Jobs panel reruns one */
export function runInTty(sessionKey: string, src: string) {
  sessionApi
    .getSession(sessionKey)
    ?.ttyShell.sourceExternal(src, { background: true })
    .catch((e) => e instanceof SigKillError || error(`${sessionKey}: ${src}: ${e}`)); // a kill is no failure
}
