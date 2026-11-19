import { type Session, sessionApi, toProcessStatus } from "@npc-cli/cli";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { type PreludeEntry, preludeApi } from "./store";

/** Runs the World's prelude if auto-boot is on. Resolves once each command has started or been skipped */
export async function runPrelude(worldKey: string): Promise<void> {
  const { autoBoot, entries } = preludeApi.get(worldKey);
  if (autoBoot === false || entries.length === 0) return;

  const bySession = Map.groupBy(entries, (x) => x.sessionKey);
  await Promise.all(
    Array.from(bySession.values(), async (group) => {
      for (const entry of group) await runEntry(entry).catch(error);
    }),
  );
}

/** The tty with this session, if any */
function findTty(sessionKey: string): undefined | JshUiMeta {
  return Object.values(uiStore.getState().byId).find(
    ({ meta }) => meta.uiKey === "Jsh" && (meta as JshUiMeta).sessionKey === sessionKey,
  )?.meta as undefined | JshUiMeta;
}

async function runEntry({ sessionKey, src }: PreludeEntry) {
  const ttyMeta = findTty(sessionKey);
  if (ttyMeta === undefined) {
    return warn(`prelude: no tty ${sessionKey}: skipped: ${src}`);
  }
  if (getSession(sessionKey) === undefined) {
    uiStoreApi.markEverSeen(ttyMeta.id); // mounts it offscreen
  }

  const ready = await until(() => getSession(sessionKey)?.ttyShell.isProfileFinished() === true);
  const session = getSession(sessionKey);
  if (ready === false || session === undefined) {
    return warn(`prelude: ${sessionKey} never finished its profile: skipped: ${src}`);
  }
  if (isRunning(session, src)) return;

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
}

function getSession(sessionKey: string): undefined | Session {
  return sessionApi.getSession(sessionKey);
}

/** Does an unkilled process lead `src`? */
function isRunning(session: Session, src: string) {
  return Object.values(session.process).some(
    (p) => p.key === p.pgid && p.origSrc === src && p.status !== toProcessStatus.Killed,
  );
}

/** Polls `test` until it holds, else gives up after `waitMs` */
async function until(test: () => boolean): Promise<boolean> {
  const giveUpAt = Date.now() + waitMs;
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
const pollMs = 250;
/** How long a step waits, e.g. on a tty which never boots */
const waitMs = 20000;
