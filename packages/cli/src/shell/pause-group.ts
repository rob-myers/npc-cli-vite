import { toProcessStatus } from "./const";
import { sessionApi } from "./session";

/**
 * Jobs suspended and resumed together, under the hold `key` — so neither the Jsh pane nor another group
 * resumes what this one paused. A job (process group) is held whole once any of its processes is tagged
 * `pausablePtag(key)`. One per session and key: a new one disposes the last
 */
export function createPauseGroup(sessionKey: string, key: string): PauseGroup {
  const { pauseGroups } = sessionApi.getSession(sessionKey);
  const ptag = pausablePtag(key);
  pauseGroups[key]?.dispose();

  const teardowns: (() => void)[] = [];
  const live = () =>
    Object.values(sessionApi.getSession(sessionKey)?.process ?? {}).filter((p) => p.status !== toProcessStatus.Killed);

  const group: PauseGroup = {
    key,
    ptag,
    pause() {
      const processes = live();
      // whole process groups, never part of a pipeline: any with a member
      const pgids = new Set(processes.flatMap((p) => (p.ptags[ptag] === true ? p.pgid : [])));
      const held = processes.filter((p) => pgids.has(p.pgid));
      sessionApi.killProcesses(held.reverse(), { STOP: true, reason: key });
    },
    resume() {
      // whoever we hold, member or no longer
      sessionApi.killProcesses(
        live().filter((p) => p.holds?.has(key)),
        { CONT: true, reason: key },
      );
    },
    own(teardown) {
      teardowns.push(teardown);
    },
    dispose() {
      group.resume();
      teardowns.splice(0).forEach((teardown) => teardown());
      if (pauseGroups[key] === group) delete pauseGroups[key];
    },
  };
  pauseGroups[key] = group;
  return group;
}

/** The ptag whose jobs the pause group `key` holds: `"world"` holds `WORLD_PAUSABLE` */
export function pausablePtag<K extends string>(key: K) {
  return `${key.toUpperCase()}_PAUSABLE` as `${Uppercase<K>}_PAUSABLE`;
}

/** The keys of the session's groups whose members are tagged `ptag` */
export function pauseGroupKeysOf(sessionKey: string, ptag: string) {
  const { pauseGroups = {} } = sessionApi.getSession(sessionKey) ?? {};
  return Object.values(pauseGroups).flatMap((group) => (group.ptag === ptag ? group.key : []));
}

export type PauseGroup = {
  /** The hold it pauses under */
  readonly key: string;
  /** Whose jobs it holds: those with a process tagged so */
  readonly ptag: string;
  pause(): void;
  resume(): void;
  /** Run on dispose e.g. unsubscribe whatever drives it */
  own(teardown: () => void): void;
  dispose(): void;
};
