import { toProcessStatus } from "./const";
import { sessionApi } from "./session";

/**
 * Processes tagged `ptags[key] === true` suspended and resumed together, under the hold `key` — so
 * neither the `<Tty>` nor another group resumes what this one paused. One per session and key: a
 * new one disposes the last. A process leaves by tagging itself `key: false`, and so do its later children
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
      // members, and their group's leader which `ps` and Jobs show — unless it opted out
      const pgids = new Set(processes.flatMap((p) => (p.ptags[key] === true ? p.pgid : [])));
      const held = processes.filter((p) => p.ptags[key] === true || (pgids.has(p.key) && p.ptags[key] !== false));
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
