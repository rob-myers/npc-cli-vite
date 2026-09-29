import { sessionApi, useSession } from "@npc-cli/cli";
import { getTtyStore } from "@npc-cli/cli/shell/storage";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { jsStringify, restoreFromPersistedJsStringify } from "@npc-cli/util/legacy/generic";
import { createStore } from "zustand/vanilla";
import { queryClientApi } from "./query-client";

/**
 * DEV only: what `scripts/src/mcp` drives over CDP, as `window.__devMcp` — see `docs/mcp.md`
 */
const devMcp = createStore<DevMcpState>()((_set, get) => ({
  logs: {},
  nextSeq: 1,

  async ensureTty(key) {
    if (useSession.getState().session[key] === undefined) {
      const ui = Object.values(uiStore.getState().byId).find(
        ({ meta }) => meta.uiKey === "Jsh" && meta.sessionKey === key,
      );
      if (ui === undefined) addJshTab(key);
      else uiStoreApi.markEverSeen(ui.meta.id);
    }
    await until(() => useSession.getState().session[key]?.ttyShell.isProfileFinished() === true, 20_000);
    tap(key);
  },

  async run(key, cmd, typed) {
    await get().ensureTty(key);
    const { ttyShell } = sessionApi.getSession(key);
    const from = get().nextSeq - 1;
    if (typed === false) {
      ttyShell
        .sourceExternal(cmd)
        .catch((e) => push(key, { level: "error", msg: `${e}` }))
        .finally(() => push(key, { done: sessionApi.getSession(key).lastExit.fg }));
    } else {
      showTty(key);
      await until(() => ttyShell.isInteractive(), 2000, false);
      if (ttyShell.isInteractive() === false) {
        throw Error(`${key} is busy: read its output, interrupt it, or use another tty`);
      }
      ttyShell.xterm.pasteAndRunLines([cmd]).catch(() => {}); // rejected by ctrl-c
    }
    return from;
  },

  async await(key, since, ms) {
    const isDone = () => get().logs[key]?.some((x) => x.seq > since && "done" in x) === true;
    await until(isDone, ms, false);
    return get().read(key, since);
  },

  read(key, since) {
    const entries = (get().logs[key] ?? []).filter((x) => x.seq > since);
    const done = entries.findLast((x) => "done" in x) as undefined | { done: number };
    return { entries, done: done !== undefined, exitCode: done?.done ?? null, last: get().nextSeq - 1 };
  },

  interrupt(key) {
    sessionApi.getSession(key).ttyShell.xterm.sendSigKill();
  },

  async query(fn, worldKey = "world-0", depth = 4) {
    const w = queryClientApi.get([worldKey]);
    if (w === undefined) throw Error(`${worldKey} not ready`);
    return toPlain(await fn(w), depth);
  },

  worldToClient(x, z, y = 0, worldKey = "world-0") {
    const w = queryClientApi.get([worldKey]) as undefined | { r3f?: R3fLike };
    if (w?.r3f === undefined) throw Error(`${worldKey} not ready`);
    const { camera, gl } = w.r3f;
    const ndc = camera.position.clone().set(x, y, z).project(camera);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) return null;
    const rect = gl.domElement.getBoundingClientRect();
    return {
      clientX: rect.left + ((ndc.x + 1) / 2) * rect.width,
      clientY: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  },
}));

/** Per tty, the io tapped and how to stop — a tab closed and reopened has a new io */
const taps = new Map<string, { io: unknown; off(): void }>();

function tap(key: string) {
  const { ttyIo } = sessionApi.getSession(key);
  const prev = taps.get(key);
  if (prev?.io === ttyIo) return;
  prev?.off();
  const off = ttyIo.handleWriters((msg) => {
    if (isDataChunk(msg)) for (const item of msg.items) push(key, { out: toPlain(item) });
    else if (typeof msg === "object" && msg !== null && "key" in msg && ignoredKeys.has(`${msg.key}`)) {
      if (msg.key === "send-xterm-prompt") push(key, { done: sessionApi.getSession(key).lastExit.fg });
    } else if (typeof msg === "object" && msg !== null && "key" in msg && (msg.key === "info" || msg.key === "error")) {
      push(key, { level: msg.key, msg: `${(msg as { msg: unknown }).msg}` });
    } else if (msg !== undefined) push(key, { out: toPlain(msg) });
  });
  taps.set(key, { io: ttyIo, off });
}

function push(key: string, entry: EntryBody) {
  devMcp.setState(({ logs, nextSeq }) => ({
    nextSeq: nextSeq + 1,
    logs: { ...logs, [key]: [...(logs[key] ?? []), { seq: nextSeq, ...entry }].slice(-maxEntries) },
  }));
}

/** Brings tty `key`'s tab to the front: one never shown takes no typed input */
function showTty(key: string) {
  const ui = Object.values(uiStore.getState().byId).find(({ meta }) => meta.uiKey === "Jsh" && meta.sessionKey === key);
  const parentId = ui?.meta.parentId;
  if (ui === undefined || parentId === undefined) return;
  uiStore.setState((draft) => {
    (draft.byId[parentId].meta as UiInstanceMeta & { currentTabId?: string }).currentTabId = ui.meta.id;
  });
  uiStoreApi.markEverSeen(ui.meta.id);
}

/** As the Tabs "+" does, beside `tty-0` — see `JshBootstrap` */
function addJshTab(key: string) {
  const { byId } = uiStore.getState();
  const parentId =
    Object.values(byId).find(({ meta }) => meta.uiKey === "Jsh" && meta.sessionKey === "tty-0")?.meta.parentId ??
    uiStoreApi.getTabsInstances()[0]?.id;
  if (parentId === undefined) throw Error("no Tabs to add a tty to");

  const store = getTtyStore(key);
  const vars = restoreFromPersistedJsStringify(store.read().vars ?? "{}");
  delete vars.PROFILE_KEY; // else a persisted one wins
  store.patch({ vars: jsStringify(vars, false, true) });
  store.flush();

  const meta = {
    id: `ui-${crypto.randomUUID()}`,
    uiKey: "Jsh",
    title: key,
    parentId,
    sessionKey: key,
    env: { CACHE_SHORTCUTS: { w: "WORLD_KEY" }, WORLD_KEY: "world-0", PROFILE_KEY: "default_profile" },
  } as UiInstanceMeta;
  uiStoreApi.addUis({ metas: [meta] });
  uiStore.setState((draft) => {
    const tabs = draft.byId[parentId].meta as UiInstanceMeta & { items: string[]; currentTabId?: string };
    tabs.items.push(meta.id);
    tabs.currentTabId = meta.id;
  });
  uiStoreApi.markEverSeen(meta.id);
}

/** JSON-safe, bounded — a World object is far too deep to send back */
function toPlain(x: unknown, depth = 4, seen = new WeakSet<object>()): unknown {
  if (typeof x === "string") return x.replace(ansiRegex, "");
  if (x === null || typeof x === "number" || typeof x === "boolean") return x;
  if (typeof x === "function") return `[Function ${x.name || "anonymous"}]`;
  if (typeof x !== "object") return `${x}`;
  if (x instanceof HTMLElement) return `<${x.tagName.toLowerCase()}>`;
  if (seen.has(x)) return "[Circular]";
  if (depth === 0) return Array.isArray(x) ? `[Array(${x.length})]` : "[Object]";
  seen.add(x);
  if (x instanceof Map) return toPlain(Object.fromEntries(x), depth, seen);
  if (x instanceof Set) return toPlain([...x], depth, seen);
  if (Array.isArray(x)) return x.slice(0, 100).map((y) => toPlain(y, depth - 1, seen));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x).slice(0, 50)) {
    try {
      out[k] = toPlain((x as Record<string, unknown>)[k], depth - 1, seen);
    } catch {
      out[k] = "[Unreadable]";
    }
  }
  return out;
}

function isDataChunk(x: unknown): x is { items: unknown[] } {
  return typeof x === "object" && x !== null && (x as Record<string, unknown>).__chunk__ === true;
}

async function until(test: () => boolean, ms: number, throws = true) {
  for (const endMs = Date.now() + ms; test() === false; await new Promise((r) => setTimeout(r, 50))) {
    if (Date.now() > endMs) {
      if (throws === true) throw Error(`timed out after ${ms}ms`);
      return;
    }
  }
}

/** Control messages for xterm, none of them output */
const ignoredKeys = new Set([
  "send-xterm-prompt",
  "tty-received-line",
  "send-history-line",
  "send-completion",
  "clear-xterm",
  "external",
]);
// biome-ignore lint/suspicious/noControlCharactersInRegex: ansi escapes
const ansiRegex = /\x1b\[[0-9;]*m/g;
const maxEntries = 2000;

(window as unknown as { __devMcp: typeof devMcp }).__devMcp = devMcp;

type EntryBody = { out: unknown } | { level: "info" | "error"; msg: string } | { done: number };

export type DevMcpEntry = { seq: number } & EntryBody;

type R3fLike = {
  camera: { position: { clone(): { set(x: number, y: number, z: number): { project(c: unknown): Ndc } } } };
  gl: { domElement: HTMLCanvasElement };
};
type Ndc = { x: number; y: number; z: number };

export type DevMcpState = {
  /** Per tty, what was written to it, oldest first */
  logs: Record<string, DevMcpEntry[]>;
  nextSeq: number;
  /** Opens tty `key` if need be, and taps it */
  ensureTty(key: string): Promise<void>;
  /** Starts `cmd`, giving the last seq before it */
  run(key: string, cmd: string, typed: boolean): Promise<number>;
  /** Waits up to `ms` for `cmd` started after `since` to finish */
  await(key: string, since: number, ms: number): Promise<DevMcpRead>;
  read(key: string, since: number): DevMcpRead;
  /** ctrl-c */
  interrupt(key: string): void;
  /** `fn` of the World as plain data, bypassing every tty */
  query(fn: (w: any) => unknown, worldKey?: string, depth?: number): Promise<unknown>;
  /** Where a world point shows in the viewport, or `null` if off-screen */
  worldToClient(x: number, z: number, y?: number, worldKey?: string): null | { clientX: number; clientY: number };
};

type DevMcpRead = { entries: DevMcpEntry[]; done: boolean; exitCode: null | number; last: number };
