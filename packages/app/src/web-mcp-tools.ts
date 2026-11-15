import { sessionApi, useSession } from "@npc-cli/cli";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";

/**
 * WebMCP tools for a browser agent such as Gemini in Chrome.
 * Chrome offers `document.modelContext` by origin trial, or by flag on localhost (`docs/mcp.md`).
 */
const unregister = new AbortController();

void registerTools((document as unknown as { modelContext: ModelContext }).modelContext);

async function registerTools(mc: ModelContext) {
  const { signal } = unregister;

  await mc.registerTool(
    {
      name: "list_terminals",
      description:
        "Lists the open jsh terminals (ttys): their keys, which is shown, and which is busy running a command.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const shown = getShownTtys();
        const ttys = Object.entries(useSession.getState().session).map(([key, s]) => ({
          key,
          shown: shown.has(key),
          busy: s.ttyShell.isInteractive() === false,
        }));
        return text(JSON.stringify(ttys));
      },
    },
    { signal },
  );

  await mc.registerTool(
    {
      name: "write_to_terminal",
      description:
        "Types one line into an open jsh terminal and runs it, as if the user typed it, then returns what it printed. " +
        "jsh is a bash-like shell driving the 3D World, e.g. `help`, `ls`, `spawn rob $( click 1 )`. " +
        "Fails if that terminal is busy.",
      inputSchema: {
        type: "object",
        properties: {
          line: { type: "string", description: "The jsh line to run" },
          tty: {
            type: "string",
            description: "A terminal key from list_terminals, e.g. tty-1. Default: the one shown",
          },
          waitMs: { type: "number", description: "How long to wait for it to finish. Default 10000" },
        },
        required: ["line"],
      },
      async execute(input) {
        const { line, tty = getShownTtys().values().next().value, waitMs = 10_000 } = input as WriteInput;
        if (tty === undefined || useSession.getState().session[tty] === undefined) {
          throw Error(`no open terminal ${tty ?? "is shown"}: see list_terminals`);
        }
        const { ttyShell, ttyIo } = sessionApi.getSession(tty);
        if (ttyShell.isInteractive() === false) throw Error(`${tty} is busy running a command`);

        const out: string[] = [];
        const off = ttyIo.handleWriters((msg) => {
          const s = toText(msg);
          if (s !== null) out.push(s);
        });
        try {
          const ran = ttyShell.xterm.pasteAndRunLines([line]).then(
            () => true,
            () => true, // rejected by ctrl-c
          );
          const finished = await Promise.race([ran, new Promise<false>((r) => setTimeout(r, waitMs, false))]);
          const printed = out.join("\n").slice(-maxChars);
          return text(finished === true ? printed : `${printed}\n[still running after ${waitMs}ms]`);
        } finally {
          off();
        }
      },
    },
    { signal },
  );
}

/** Keys of the ttys whose tab is the current one in its Tabs */
function getShownTtys() {
  const { byId } = uiStore.getState();
  const shown = new Set<string>();
  for (const { meta } of Object.values(byId)) {
    if (meta.uiKey !== "Jsh" || meta.parentId === undefined) continue;
    const tabs = byId[meta.parentId]?.meta as undefined | (UiInstanceMeta & { currentTabId?: string });
    if (tabs?.currentTabId === meta.id) shown.add(meta.sessionKey as string);
  }
  return shown;
}

/** A tty write as plain text, or `null` for xterm's control messages */
function toText(msg: unknown): null | string {
  if (typeof msg === "string") return msg.replace(ansiRegex, "");
  if (typeof msg !== "object" || msg === null) return msg === undefined ? null : `${msg}`;
  if ("__chunk__" in msg) return (msg as unknown as { items: unknown[] }).items.map(toText).join("\n");
  if ("key" in msg) {
    const { key } = msg as { key: string; msg?: unknown };
    return key === "info" || key === "error" ? `${key}: ${(msg as { msg?: unknown }).msg}` : null;
  }
  try {
    return JSON.stringify(msg).slice(0, maxChars);
  } catch {
    return "[unprintable]";
  }
}

function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ansi escapes
const ansiRegex = /\x1b\[[0-9;]*m/g;
const maxChars = 20_000;

import.meta.hot?.accept();
import.meta.hot?.dispose(() => unregister.abort());

type WriteInput = { line: string; tty?: string; waitMs?: number };

type ModelContext = {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations?: { readOnlyHint?: boolean };
      execute(input: unknown): Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
};
