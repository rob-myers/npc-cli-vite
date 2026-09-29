import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * One CDP connection to the dev server's page, in a Chrome of its own which is launched if need be.
 * Buffers the page's console, which a tool reads back
 */
export class Cdp {
  private ws: null | WebSocket = null;
  private nextId = 1;
  private pending = new Map<number, (msg: CdpResponse) => void>();
  private consoleSeq = 0;
  readonly console: ConsoleEntry[] = [];
  readonly devUrl: string;
  readonly port: number;

  constructor(devUrl: string, port: number) {
    this.devUrl = devUrl;
    this.port = port;
  }

  async send<T = any>(method: string, params: object = {}): Promise<T> {
    const ws = await this.connect();
    const id = this.nextId++;
    const response = await new Promise<CdpResponse>((resolve) => {
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (response.error !== undefined) throw Error(`${method}: ${response.error.message}`);
    return response.result as T;
  }

  /** `expression` in the page, awaited, as plain data */
  async evaluate<T = any>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails !== undefined) {
      throw Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value as T;
  }

  /** Loads `window.__devMcp` once the World has a canvas — a reload drops it */
  async devMcp() {
    const ready = "typeof window.__devMcpLoad === 'function' && document.querySelector('canvas') !== null";
    for (const endMs = Date.now() + 30_000; (await this.evaluate<boolean>(ready)) === false; await sleep(250)) {
      if (Date.now() > endMs) throw Error("no window.__devMcpLoad or World canvas: is this the DEV app?");
    }
    await this.evaluate("window.__devMcp ?? window.__devMcpLoad().then(() => true)");
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) return this.ws;

    await fetch(this.devUrl).catch(() => {
      throw Error(`dev server not reachable at ${this.devUrl}: run \`pnpm dev\``);
    });
    const target = (await this.findPage()) ?? (await this.openPage());
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = ({ data }) => this.onMessage(JSON.parse(`${data}`));
    ws.onclose = () => void (this.ws = null);
    this.ws = ws;
    await this.send("Runtime.enable");
    return ws;
  }

  private onMessage(msg: CdpResponse & { method?: string; params?: any }) {
    if (msg.id !== undefined) {
      this.pending.get(msg.id)?.(msg);
      this.pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args
        .map((a: any) =>
          a.value !== undefined
            ? typeof a.value === "string"
              ? a.value
              : JSON.stringify(a.value)
            : (a.description ?? a.type),
        )
        .join(" ");
      this.log(msg.params.type, text);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const { exception, text } = msg.params.exceptionDetails;
      this.log("exception", exception?.description ?? text);
    }
  }

  private log(level: string, text: string) {
    this.console.push({ seq: ++this.consoleSeq, level, text: text.replace(ansiRegex, "").slice(0, 4000) });
    if (this.console.length > 500) this.console.shift();
  }

  private async findPage(): Promise<null | CdpTarget> {
    const targets = await fetch(`http://127.0.0.1:${this.port}/json`)
      .then((r) => r.json() as Promise<CdpTarget[]>)
      .catch(() => null);
    if (targets === null) return null;
    return targets.find((t) => t.type === "page" && t.url.startsWith(this.devUrl)) ?? null;
  }

  private async openPage(): Promise<CdpTarget> {
    const running = await fetch(`http://127.0.0.1:${this.port}/json/version`).then(
      () => true,
      () => false,
    );
    if (running === true) {
      await fetch(`http://127.0.0.1:${this.port}/json/new?${this.devUrl}`, { method: "PUT" });
    } else {
      spawn(
        chromePath,
        [
          `--remote-debugging-port=${this.port}`,
          `--user-data-dir=${path.join(os.tmpdir(), "npc-cli-mcp-chrome")}`,
          "--no-first-run",
          "--window-size=1400,900",
          this.devUrl,
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
    }
    for (const endMs = Date.now() + 20_000; Date.now() < endMs; await sleep(250)) {
      const page = await this.findPage();
      if (page !== null) return page;
    }
    throw Error(`no page at ${this.devUrl} on CDP port ${this.port}`);
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ansi escapes
const ansiRegex = /\x1b\[[0-9;]*m/g;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type CdpTarget = { type: string; url: string; webSocketDebuggerUrl: string };
type CdpResponse = { id?: number; result?: any; error?: { message: string } };
export type ConsoleEntry = { seq: number; level: string; text: string };
