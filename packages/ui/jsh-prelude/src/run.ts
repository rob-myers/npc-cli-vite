import { ansi, type ProcessMeta, type Session, sessionApi, toProcessStatus } from "@npc-cli/cli";
import { worldPtag } from "@npc-cli/cli/jsh/world/ptag";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { error, pause, warn } from "@npc-cli/util/legacy/generic";
import { type PreludeEntry, preludeApi } from "./store";

/**
 * How this World came to mount, by the World its key last mounted with: a page `load`, a `remount`, or the `same` World.
 * Outside React, as a World's remount remounts its pill too
 */
export function getMountStatus(worldKey: string, w: object): "load" | "remount" | "same" {
  const last = lastWorldByKey.get(worldKey);
  lastWorldByKey.set(worldKey, w);
  return last === undefined ? "load" : last === w ? "same" : "remount";
}

/** Runs the World's prelude if autorun is on. Resolves once each command has started or been skipped */
export async function runPrelude(worldKey: string): Promise<void> {
  const entries = preludeApi.entries(worldKey);
  if (preludeApi.get(worldKey).autorun === false || entries.length === 0) return;

  const worldTty = worldTtyOf(worldKey);
  const bySession = Map.groupBy(entries, (x) => x.sessionKey ?? worldTty);
  await Promise.all(
    Array.from(bySession, async ([sessionKey, group]) => {
      if (sessionKey === undefined) return warn(`prelude: ${worldKey} has no tty: skipped ${group.length}`);
      const ran: string[] = [];
      for (const entry of group) {
        if (await runEntry(sessionKey, entry.src).catch(error)) ran.push(labelOf(entry));
      }
      if (ran.length > 0) {
        sessionApi.writeMsg(sessionKey, `autorun ${ansi.White}${ran.join(", ")}`, "info");
      }
    }),
  );
}

/** Its comment's first line, else its command's */
function labelOf({ comment, src }: PreludeEntry) {
  return (comment.split("\n")[0].replace(/^#\s*/, "") || src.split("\n")[0]).trim();
}

/**
 * In each tty on the World running a world process: kills its world jobs and any foreground job, then re-runs its profile.
 * Then runs the prelude. Each step is announced, and given a moment
 */
export async function rebootWorld(worldKey: string, onStep: (label: string) => void): Promise<void> {
  const sessionKeys = findTtys(worldKey).flatMap(({ sessionKey }) => {
    const session = getSession(sessionKey);
    // the shell's own `WORLD_KEY`, as a saved one can differ from its tab's, and `awaitWorld` waits on it
    if (session === undefined || session.var.WORLD_KEY !== worldKey) return [];
    return liveProcesses(session).some(isWorldProcess) ? [sessionKey] : [];
  });
  const step = async (label: string, run?: (session: Session) => unknown) => {
    onStep(label);
    for (const sessionKey of sessionKeys) {
      sessionApi.writeMsg(sessionKey, `reboot ${ansi.White}${label}`, "info");
    }
    await Promise.all(sessionKeys.map(async (key) => run?.(getSession(key) as Session)));
    await pause(stepPauseMs);
  };

  await step("killing jobs", killWorldJobs);
  await step("running profiles", async (session) => {
    if (await until(() => session.ttyShell.isInteractive(), interactiveWaitMs)) return session.ttyShell.runProfile();
    warn(`reboot: ${session.key} never became interactive: its profile was not re-run`); // else it would hang
  });
  await step("autorun");
  await runPrelude(worldKey);
}

/** Kills the foreground job, if any, and every job with a world process */
function killWorldJobs(session: Session) {
  if (session.ttyShell.isProfileFinished() && session.ttyShell.isInteractive() === false) {
    sessionApi.killSessionLeader(session.key); // ctrl-c
  }
  const pgids = new Set(liveProcesses(session).flatMap((p) => (isWorldProcess(p) && p.pgid !== 0 ? p.pgid : [])));
  sessionApi.kill(session.key, [...pgids], { GROUP: true, SIGINT: true }); // as the Jobs panel's kill
}

/** Where an entry without a tty runs: its World's lowest-numbered tty, e.g. `tty-0` */
export function worldTtyOf(worldKey: string): undefined | JshUiMeta["sessionKey"] {
  const numberOf = (x: JshUiMeta) => Number(x.sessionKey.slice("tty-".length));
  return findTtys(worldKey).sort((a, b) => numberOf(a) - numberOf(b))[0]?.sessionKey;
}

/** The ttys whose World is this one */
function findTtys(worldKey: string): JshUiMeta[] {
  return jshMetas().filter((meta) => meta.env.WORLD_KEY === worldKey);
}

/** Every tty */
function jshMetas(): JshUiMeta[] {
  return Object.values(uiStore.getState().byId).flatMap(({ meta }) =>
    meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [],
  );
}

function isWorldProcess(p: ProcessMeta) {
  return p.ptags?.[worldPtag] === true;
}

function liveProcesses(session: Session) {
  return Object.values(session.process).filter((p) => p.status !== toProcessStatus.Killed);
}

/** The tty with this session, if any */
function findTty(sessionKey: string): undefined | JshUiMeta {
  return jshMetas().find((meta) => meta.sessionKey === sessionKey);
}

/** Runs `src` in the background, once its tty is up. Was it started? */
async function runEntry(sessionKey: string, src: string): Promise<boolean> {
  const ttyMeta = findTty(sessionKey);
  if (ttyMeta === undefined) {
    warn(`prelude: no tty ${sessionKey}: skipped: ${src}`);
    return false;
  }
  if (getSession(sessionKey) === undefined) {
    uiStoreApi.markEverSeen(ttyMeta.id); // mounts it offscreen
  }

  const ready = await until(() => getSession(sessionKey)?.ttyShell.isProfileFinished() === true);
  const session = getSession(sessionKey);
  if (ready === false || session === undefined) {
    warn(`prelude: ${sessionKey} never finished its profile: skipped: ${src}`);
    return false;
  }
  if (isRunning(session, src)) return false;

  let unlisten = noop;
  const started = new Promise<void>((resolve) => {
    unlisten = session.ttyShell.io.handleWriters((msg) => {
      if (msg?.key !== "external" || msg.msg.key !== "process-leader" || msg.msg.act !== "started") return;
      sessionApi.getProcess({ sessionKey, pid: msg.msg.pid })?.origSrc === src && resolve();
    });
  });
  session.ttyShell.sourceExternal(src, { background: true }).catch(error);
  await Promise.race([started, timeout()]);
  unlisten();
  return true;
}

function getSession(sessionKey: string): undefined | Session {
  return sessionApi.getSession(sessionKey);
}

/** Does an unkilled process lead `src`, as given rather than as the shell re-prints it? Paused counts */
export function isRunning(session: Session, src: string) {
  return liveProcesses(session).some((p) => p.key === p.pgid && p.origSrc === src);
}

/** Polls `test` until it holds, else gives up after `giveUpMs` */
async function until(test: () => boolean, giveUpMs = waitMs): Promise<boolean> {
  const giveUpAt = Date.now() + giveUpMs;
  while (test() === false) {
    if (Date.now() > giveUpAt) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}

function timeout() {
  return new Promise<void>((resolve) => setTimeout(resolve, waitMs));
}

const noop = () => {};
/** The World each key last mounted with. A hot reload of this module empties it, so the next remount is a `load` */
const lastWorldByKey = new Map<string, object>();
/** A pause after each reboot step, so each is seen */
const stepPauseMs = 400;
const pollMs = 250;
/** How long a step waits, e.g. on a tty which never boots */
const waitMs = 20000;
/** How long a reboot waits for a tty's prompt once its jobs are killed */
const interactiveWaitMs = 2000;
