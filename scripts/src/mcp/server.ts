#!/usr/bin/env node --import=tsx

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Cdp, sleep } from "./cdp";

/**
 * Drives the dev server's page for Claude: jsh in its own ttys, pointer presses on the World, the
 * console and screenshots — see `docs/mcp.md`
 */
const cdp = new Cdp(`http://localhost:${process.env.DEV_PORT ?? 5173}/`, Number(process.env.NPC_MCP_CDP_PORT ?? 9382));

const server = new McpServer(
  { name: "npc-cli", version: "0.1.0" },
  {
    instructions:
      "Drives the running npc-cli dev app. Run jsh commands in tty-1, a long-running one as a background job (`… &`) to keep it free, write reusable commands as exports of packages/cli/src/jsh/world/*_mcp.ts, read output, click the World, check the console. Keep tty lines short: read bulk World state with `query`, which writes to no tty. See docs/mcp.md.",
  },
);

/** Of output per result, the latest kept */
const maxChars = 40_000;

const ttyArg = z
  .string()
  .regex(/^tty-\d+$/)
  .default("tty-1")
  .describe("session key, e.g. tty-1");

server.registerTool(
  "jsh",
  {
    description:
      "Run one jsh line in a tty, typed visibly unless `typed` is false. Returns when the prompt is back, else after `waitMs` with the command left running in the foreground (running: true) — read more with `output`, end it with `interrupt`.",
    inputSchema: {
      cmd: z.string(),
      tty: ttyArg,
      waitMs: z.number().int().min(0).max(120_000).default(2000),
      typed: z.boolean().default(true),
    },
  },
  async ({ cmd, tty, waitMs, typed }) =>
    tryText(async () => {
      await cdp.devMcp();
      const since = await cdp.evaluate<number>(`__devMcp.getState().run(${q(tty)}, ${q(cmd)}, ${typed})`);
      return formatRead(await cdp.evaluate<DevMcpRead>(`__devMcp.getState().await(${q(tty)}, ${since}, ${waitMs})`));
    }),
);

server.registerTool(
  "output",
  {
    description: "What a tty was written to since `since` (a previous result's `since`), else its latest.",
    inputSchema: { tty: ttyArg, since: z.number().int().optional() },
  },
  async ({ tty, since }) =>
    tryText(async () => {
      await cdp.devMcp();
      await cdp.evaluate(`__devMcp.getState().ensureTty(${q(tty)})`);
      return formatRead(await cdp.evaluate<DevMcpRead>(`__devMcp.getState().read(${q(tty)}, ${since ?? 0})`));
    }),
);

server.registerTool(
  "interrupt",
  {
    description: "Ctrl-c in a tty: ends its foreground command so it takes input again.",
    inputSchema: { tty: ttyArg },
  },
  async ({ tty }) =>
    tryText(async () => {
      await cdp.devMcp();
      const since = await cdp.evaluate<number>(`__devMcp.getState().read(${q(tty)}, 0).last`);
      await cdp.evaluate(`__devMcp.getState().interrupt(${q(tty)})`);
      return formatRead(await cdp.evaluate<DevMcpRead>(`__devMcp.getState().await(${q(tty)}, ${since}, 1000)`));
    }),
);

server.registerTool(
  "query",
  {
    description:
      "Evaluate `fn` (JS source, e.g. `w => w.gms[0].rooms.length`) against the World and return its result as JSON, written to no tty — for reads too long or noisy for one. May return a promise.",
    inputSchema: {
      fn: z.string(),
      world: z.string().default("world-0"),
      depth: z.number().int().min(1).max(8).default(4).describe("nesting kept before [Object]"),
    },
  },
  async ({ fn, world, depth }) =>
    tryText(async () => {
      await cdp.devMcp();
      const out = await cdp.evaluate(`__devMcp.getState().query((${fn}), ${q(world)}, ${depth})`);
      const text = JSON.stringify(out) ?? "undefined";
      return text.length > maxChars ? `${text.slice(0, maxChars)}…(truncated)` : text;
    }),
);

server.registerTool(
  "click",
  {
    description:
      "A real pointer press on the page, at a world point (x, z, optional y) projected by the camera, or at client coordinates — e.g. to answer `pick`. `long` holds it past the World's long-press.",
    inputSchema: {
      x: z.number().optional(),
      z: z.number().optional(),
      y: z.number().default(0),
      clientX: z.number().optional(),
      clientY: z.number().optional(),
      long: z.boolean().default(false),
      button: z.enum(["left", "right"]).default("left"),
    },
  },
  async (opts) =>
    tryText(async () => {
      await cdp.devMcp();
      const at =
        opts.x !== undefined && opts.z !== undefined
          ? await cdp.evaluate<null | { clientX: number; clientY: number }>(
              `__devMcp.getState().worldToClient(${opts.x}, ${opts.z}, ${opts.y})`,
            )
          : opts.clientX !== undefined && opts.clientY !== undefined
            ? { clientX: opts.clientX, clientY: opts.clientY }
            : null;
      if (at === null) throw Error("give x and z (on-screen), or clientX and clientY");

      const base = { x: at.clientX, y: at.clientY, button: opts.button };
      const buttons = opts.button === "left" ? 1 : 2;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...base, button: "none" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons, clickCount: 1 });
      await sleep(opts.long ? 600 : 60);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0, clickCount: 1 });
      return `pressed ${opts.button}${opts.long ? " (long)" : ""} at client (${Math.round(at.clientX)}, ${Math.round(at.clientY)})`;
    }),
);

server.registerTool(
  "console",
  {
    description: "The page's console and uncaught exceptions since `since`, e.g. an HMR error after editing a module.",
    inputSchema: {
      since: z.number().int().default(0),
      level: z.string().optional().describe("e.g. error, warning, log, exception"),
    },
  },
  async ({ since, level }) =>
    tryText(async () => {
      await cdp.devMcp();
      const entries = cdp.console.filter((x) => x.seq > since && (level === undefined || x.level === level));
      const last = cdp.console.at(-1)?.seq ?? since;
      // a compile error is shown in vite's overlay rather than logged
      const overlay = await cdp.evaluate<null | string>(
        `document.querySelector("vite-error-overlay")?.shadowRoot?.querySelector(".message-body")?.textContent ?? null`,
      );
      const lines = entries.map((x) => `[${x.seq} ${x.level}] ${x.text}`);
      if (overlay !== null) lines.push(`[vite-error-overlay] ${overlay}`);
      return `${lines.join("\n")}\n---\n${JSON.stringify({ since: last })}`;
    }),
);

server.registerTool("shot", { description: "A screenshot of the page." }, async () => {
  try {
    await cdp.devMcp();
    const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return { content: [{ type: "image", data, mimeType: "image/png" }] };
  } catch (e) {
    return { content: [{ type: "text", text: `${e}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());

/** Output lines, then a status line to go on from */
function formatRead({ entries, done, exitCode, last }: DevMcpRead) {
  const lines = entries.flatMap((x) =>
    "out" in x
      ? typeof x.out === "string"
        ? x.out
        : JSON.stringify(x.out)
      : "level" in x
        ? `[${x.level}] ${x.msg}`
        : [],
  );
  let text = lines.join("\n");
  if (text.length > maxChars) text = `…(truncated)\n${text.slice(-maxChars)}`;
  return `${text}\n---\n${JSON.stringify({ running: !done, exitCode, since: last })}`;
}

async function tryText(run: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: `${e instanceof Error ? e.message : e}` }], isError: true };
  }
}

function q(s: string) {
  return JSON.stringify(s);
}

/** See `DevMcpState` in `packages/app/src/dev-mcp-hooks.ts` */
type DevMcpRead = {
  entries: ({ seq: number } & ({ out: unknown } | { level: string; msg: string } | { done: number }))[];
  done: boolean;
  exitCode: null | number;
  last: number;
};
