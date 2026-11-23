import { sessionApi, useSession } from "@npc-cli/cli";
import { forgetBootstrapVars } from "@npc-cli/cli/shell/storage";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { createStore } from "zustand/vanilla";
import { queryClientApi } from "./query-client";

/**
 * DEV only: what `scripts/src/mcp` drives over CDP, as `window.__devMcp` — see `docs/mcp.md`
 */
const devMcp = createStore<DevMcpState>()((_set, get) => ({
  logs: {},
  nextSeq: 1,

  say(text) {
    if (getBanner() === null) setBanner(mcpBusyText);
    const el = document.getElementById(bannerId)?.querySelector<HTMLElement>("[data-say]");
    if (el === undefined || el === null) return;
    el.textContent = text ?? "";
    el.classList.toggle("hidden", !text);
  },

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

  ignoreInputFor(ms) {
    ownInputUntil = performance.now() + ms;
  },

  takeUserInput() {
    return userInput.splice(0);
  },

  async query(fn, worldKey = "world-0", depth = 4) {
    const w = worldKey === "" ? undefined : queryClientApi.get([worldKey]);
    if (w === undefined && worldKey !== "") throw Error(`${worldKey} not ready`);
    return toPlain(await fn(w), depth);
  },

  async refetch(queryKey) {
    await queryClientApi.queryClient.invalidateQueries({ queryKey });
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

// each call is shown on the World as it is made — see `driving`
const { ensureTty, run, await: awaitDone, query, worldToClient, interrupt } = devMcp.getState();
devMcp.setState({
  ensureTty: (...args) => driving(() => ensureTty(...args)),
  run: (...args) => driving(() => run(...args)),
  await: (...args) => driving(() => awaitDone(...args)),
  query: (...args) => driving(() => query(...args)),
  worldToClient(...args) {
    void driving(async () => {});
    return worldToClient(...args);
  },
  interrupt(key) {
    void driving(async () => {});
    interrupt(key);
  },
});

/** Runs a call with "mcp testing" up over the page, until Claude's turn ends */
async function driving<T>(call: () => Promise<T>): Promise<T> {
  if (getBanner() === null) userInput.length = 0;
  setBanner(mcpBusyText); // also back from compacting
  return call();
}

/** The page's "mcp testing" banner, unless it is gone or fading out */
function getBanner(): null | HTMLElement {
  const el = document.getElementById(bannerId);
  return el === null || el.dataset.leaving === "true" ? null : el;
}

/** Shows the banner saying `text`, else fades it out on `null`. Found by id, so an hmr keeps it */
function setBanner(text: null | string) {
  let el = document.getElementById(bannerId);
  // made before it had a message line: made afresh
  if (el !== null && text !== null && el.querySelector("[data-title]") === null) {
    el.remove();
    el = null;
  }
  if (text === null) {
    if (el === null) return;
    el.dataset.leaving = "true";
    el.style.opacity = "0";
    window.setTimeout(() => el?.dataset.leaving === "true" && el.remove(), bannerFadeMs);
    return;
  }
  if (el === null) {
    el = document.createElement("div");
    el.id = bannerId;
    el.className = bannerClass;
    el.innerHTML = `<div class="${spinnerClass}"></div><div class="flex min-w-0 flex-col items-center gap-1"><span data-title class="min-w-0 truncate"></span><span data-say class="${sayClass} hidden"></span></div>`;
    el.style.opacity = "0";
    document.body.append(el);
    placeBanner();
    void el.offsetWidth; // a reflow, so the fade runs even in a background tab, where no frame comes
    el.style.opacity = "1";
  } else {
    delete el.dataset.leaving;
    el.style.opacity = "1";
  }
  (el.querySelector("[data-title]") as HTMLElement).textContent = text;
}

/** Centres the banner in the visual viewport, so a pinch zoom, the keyboard or a notch never hides it */
function placeBanner() {
  const el = document.getElementById(bannerId);
  if (el === null) return;
  const vv = window.visualViewport;
  const [x, y, width] = vv === null ? [0, 0, window.innerWidth] : [vv.offsetLeft, vv.offsetTop, vv.width];
  el.style.left = `${x + width / 2}px`;
  el.style.top = `calc(${y}px + env(safe-area-inset-top) + 4rem)`;
  el.style.maxWidth = `calc(${width}px - 1rem)`;
}

/** Changes the text of "mcp testing", whilst it is up */
function relabelBusy(text: string) {
  if (getBanner() !== null) setBanner(text);
}

function stopBusy() {
  setBanner(null);
}

/** The user's input whilst "mcp testing" is up, told to Claude with its next result */
const userInput: string[] = [];
/** Input until then is Claude's own: a CDP click is trusted too */
let ownInputUntil = 0;

function noteInput(e: Event) {
  if (getBanner() === null || performance.now() < ownInputUntil) return;
  const what = e instanceof KeyboardEvent ? `keydown ${e.key}` : e.type;
  if (userInput.at(-1) !== what && userInput.length < 20) userInput.push(what);
}

const inputTypes = ["pointerdown", "keydown", "wheel"];
for (const type of inputTypes) window.addEventListener(type, noteInput, { capture: true, passive: true });
window.visualViewport?.addEventListener("resize", placeBanner);
window.visualViewport?.addEventListener("scroll", placeBanner);

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

  forgetBootstrapVars(key);

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
const mcpBusyText = "mcp testing";
const mcpCompactingText = "mcp compacting";
const bannerId = "dev-mcp-banner";
const bannerFadeMs = 200;
/** Top-centre of the page, over every ui. Informative only, so it takes no pointer events */
const bannerClass =
  "fixed -translate-x-1/2 z-9999 pointer-events-none select-none flex items-center gap-4 px-6 py-2.5 rounded border border-yellow-200/30 bg-black/75 font-mono text-sm uppercase tracking-[0.25em] sm:tracking-[0.4em] whitespace-nowrap text-yellow-200/80 transition-opacity duration-200";
const spinnerClass = "size-4 shrink-0 rounded-full border-2 border-current border-b-transparent animate-spin";
/** Claude's message under it, e.g. what a demo shows now: see `say` */
const sayClass =
  "max-w-md whitespace-normal text-center text-xs normal-case leading-snug tracking-normal text-yellow-100/90";

(window as unknown as { __devMcp: typeof devMcp }).__devMcp = devMcp;

// sent on by `vite-plugin-dev-mcp` from Claude Code's `Stop` hook
import.meta.hot?.on("dev-mcp:turn-end", stopBusy);
// from the `PreCompact` hook
import.meta.hot?.on("dev-mcp:compact", () => relabelBusy(mcpCompactingText));

// re-run in place on an edit, rather than reloading the page
import.meta.hot?.accept();
import.meta.hot?.dispose(() => {
  for (const { off } of taps.values()) off();
  for (const type of inputTypes) window.removeEventListener(type, noteInput, { capture: true });
  window.visualViewport?.removeEventListener("resize", placeBanner);
  window.visualViewport?.removeEventListener("scroll", placeBanner);
  stopBusy();
});

type EntryBody = { out: unknown } | { level: "info" | "error"; msg: string } | { done: number };

export type DevMcpEntry = { seq: number } & EntryBody;

type R3fLike = {
  camera: { position: { clone(): { set(x: number, y: number, z: number): { project(c: unknown): Ndc } } } };
  gl: { domElement: HTMLCanvasElement };
};
type Ndc = { x: number; y: number; z: number };

export type DevMcpState = {
  /** Writes `text` under "mcp testing", e.g. what a demo shows now, until the turn ends. `null` clears it */
  say(text: null | string): void;
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
  /** Input in the next `ms` is Claude's own, e.g. a `click` */
  ignoreInputFor(ms: number): void;
  /** The user's input since last asked, e.g. `keydown Escape` */
  takeUserInput(): string[];
  /** `fn` of the World as plain data, bypassing every tty */
  query(fn: (w: any) => unknown, worldKey?: string, depth?: number): Promise<unknown>;
  /** Refetches every query whose key starts with `queryKey`, e.g. `["skins-and-gltf"]` after a new glTF */
  refetch(queryKey: unknown[]): Promise<void>;
  /** Where a world point shows in the viewport, or `null` if off-screen */
  worldToClient(x: number, z: number, y?: number, worldKey?: string): null | { clientX: number; clientY: number };
};

type DevMcpRead = { entries: DevMcpEntry[]; done: boolean; exitCode: null | number; last: number };
