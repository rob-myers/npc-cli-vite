import { toProcessStatus } from "./const";
import { sessionApi } from "./session";

/**
 * Jobs suspended and resumed together, under the hold `key` — so neither the `<Tty>` nor another group
 * resumes what this one paused. A job (process group) is held whole once any of its processes is tagged
 * `ptags[key] === true`. One per session and key: a new one disposes the last
 */
export function createPauseGroup(sessionKey: string, key: string): PauseGroup {
  const id = `${sessionKey} ${key}`;
  groups.get(id)?.dispose();

  const teardowns: (() => void)[] = [];
  const live = () =>
    Object.values(sessionApi.getSession(sessionKey)?.process ?? {}).filter((p) => p.status !== toProcessStatus.Killed);

  const group: PauseGroup = {
    pause() {
      const processes = live();
      // whole process groups, never part of a pipeline: any with a member
      const pgids = new Set(processes.flatMap((p) => (p.ptags[key] === true ? p.pgid : [])));
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
      if (groups.get(id) === group) groups.delete(id);
    },
  };
  groups.set(id, group);
  return group;
}

export type PauseGroup = {
  pause(): void;
  resume(): void;
  /** Run on dispose e.g. unsubscribe whatever drives it */
  own(teardown: () => void): void;
  dispose(): void;
};

const groups = new Map<string, PauseGroup>();
