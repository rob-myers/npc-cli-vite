import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { WorldThemeSchema } from "@npc-cli/ui__world/assets.schema";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
import type { Plugin, ViteDevServer } from "vite";

import { PROJECT_ROOT } from "./const.ts";
import { hashOf, skinSheetHash, withHash } from "./skin-sheet-hash.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const WATCH_DECOR_SVGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-decor-svgs.ts");
const WATCH_SKIN_PNGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-skin-pngs.ts");
const WATCH_SKIN_SVGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-skin-svgs.ts");
const WATCH_CURRENT_GLTF_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-current-gltf.ts");
const ICON_DIR = path.join(PROJECT_ROOT, "packages/media/src/icon");
const ASSETS_JSON_PATH = path.join(PUBLIC_DIR, "assets.json");
const THEME_JSON_PATH = path.join(PUBLIC_DIR, "theme.json");
const GEN_ASSETS_SERVICE = path.join(PROJECT_ROOT, "scripts/src/service/gen-assets-json.ts");
const GEOMORPH_SERVICE = path.join(PROJECT_ROOT, "packages/ui/world/src/service/geomorph.ts");

export function watchAssetsPlugin(): Plugin {
  return {
    name: "watch-assets",
    configureServer(server) {
      /**
       * can edit /public/decor/*.svg and see changes in world
       */
      server.ssrLoadModule(WATCH_DECOR_SVGS_PATH).then((mod) => {
        (mod as typeof import("./service/watch-decor-svgs")).watchDecorSvgs(server);
      });
      /**
       * can edit /public/skin/*.png and see changes in world
       */
      server.ssrLoadModule(WATCH_SKIN_PNGS_PATH).then((mod) => {
        (mod as typeof import("./service/watch-skin-pngs")).watchSkinPngs(server);
      });
      /**
       * can edit /public/skin/*.svg and see changes in world
       */
      server.ssrLoadModule(WATCH_SKIN_SVGS_PATH).then((mod) => {
        (mod as typeof import("./service/watch-skin-svgs")).watchSkinSvgs(server);
      });
      /**
       * can export current.gltf from Blockbench and see changes in world
       */
      server.ssrLoadModule(WATCH_CURRENT_GLTF_PATH).then((mod) => {
        (mod as typeof import("./service/watch-current-gltf")).watchCurrentGltf(server);
      });

      // imported assets outside the app's root are not watched, so an edited icon would never hot-reload
      server.watcher.add(ICON_DIR);

      const symbolGlob = path.join(PUBLIC_DIR, "symbol/*.json");
      const mapGlob = path.join(PUBLIC_DIR, "map/*.json");
      server.watcher.add([symbolGlob, mapGlob, GEOMORPH_SERVICE, ASSETS_JSON_PATH, THEME_JSON_PATH]);

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let running = false;
      const changed = new Map<string, number>();
      /** Each input file as a run last succeeded on, so a repeat event is skipped, e.g. the watcher's after a save's */
      const seen = new Map<string, string>();
      /** Each input file as sent to a run not yet done: seen once it succeeds, so a failed one can be retried */
      const sending = new Map<string, string>();

      const isAssetInputFile = (filePath: string) =>
        !filePath.endsWith("manifest.json") &&
        (filePath.startsWith(path.join(PUBLIC_DIR, "symbol/")) || filePath.startsWith(path.join(PUBLIC_DIR, "map/"))) &&
        filePath.endsWith(".json");

      const isWatchedFile = (filePath: string) => filePath === GEOMORPH_SERVICE || isAssetInputFile(filePath);

      const runGenAssets = async (server: ViteDevServer) => {
        if (running) return;
        running = true;

        const startEpochMs = Date.now();
        const changedFiles = Array.from(changed.keys());
        console.log(`[watch-assets] running gen-assets-json for ${changedFiles.length} file(s)`);
        server.hot.send({ type: "custom", event: assetsJsonChangingEvent });
        const contents = changedFiles.map((file) => [file, sending.get(file)] as const);

        try {
          // generate assets.json in-process, sparing a process's startup
          await genAssetsJson(server, { changedFiles });
          for (const [file, content] of contents) if (content !== undefined) seen.set(file, content);
          // inform browser
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
        } catch (err) {
          console.error("[watch-assets] gen-assets-json failed:", err);
        }
        for (const [file, content] of contents) if (sending.get(file) === content) sending.delete(file);

        changed.forEach((epochMs, file) => epochMs <= startEpochMs && changed.delete(file));
        running = false;
        if (changed.size > 0) {
          await runGenAssets(server);
        }
      };

      /** A hand edit of assets.json or theme.json: the browser is only told of our own writes otherwise */
      let handEditTimer: ReturnType<typeof setTimeout> | null = null;
      const onAssetsJsonChange = (filePath: string) => {
        if (running || Date.now() - themeSavedAt < selfWriteGraceMs) return; // ours: already announced, or the page's own
        if (filePath === ASSETS_JSON_PATH && readOrNull(filePath) === wroteAssetsJson) return; // ours, written in-process
        if (handEditTimer) clearTimeout(handEditTimer);
        handEditTimer = setTimeout(() => {
          if (running) return;
          console.log(`[watch-assets] ${path.basename(filePath)} edited by hand`);
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
        }, 100);
      };

      const onFileChange = (filePath: string) => {
        if (filePath === ASSETS_JSON_PATH || filePath === THEME_JSON_PATH) return onAssetsJsonChange(filePath);
        if (!isWatchedFile(filePath)) return;
        if (isAssetInputFile(filePath)) {
          const content = readOrNull(filePath);
          if (content !== null && (seen.get(filePath) === content || sending.get(filePath) === content)) return;
          if (content !== null) sending.set(filePath, content);
          changed.set(filePath, Date.now());
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runGenAssets(server), 30);
      };

      server.watcher.on("change", onFileChange);
      server.watcher.on("add", onFileChange);

      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/api/gen-starship-sheets" && req.method === "POST") {
          return handleGenStarshipSheets(res);
        }
        if (req.url === "/api/gen-skin-sheets" && req.method === "POST") {
          return handleGenSkinSheets(res);
        }
        if (req.url === "/api/gen-assets-json" && req.method === "POST") {
          return handleGenAssetsJson(server, res);
        }
        const skinSheetMatch = req.url?.match(/^\/api\/(skin|skin-slices)-sheet\/(\d+)$/);
        if (skinSheetMatch && req.method === "POST") {
          return handleSkinSheet(req, res, skinSheetMatch[1], Number(skinSheetMatch[2]));
        }
        const themeMatch = req.url?.match(/^\/api\/assets\/theme\/(.+)$/);
        if (themeMatch && req.method === "POST") {
          return handleAssetsTheme(req, res, themeMatch[1]);
        }
        next();
      });
    },
  };
}

import type { IncomingMessage, ServerResponse } from "node:http";

/** A `skin` or `skin-slices` sheet drawn by a DEV World — see `docs/skins.md` */
async function handleSkinSheet(req: IncomingMessage, res: ServerResponse, name: string, sheetId: number) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
    return res.writeHead(403).end();
  }
  // a self-signed https page may draw them wrongly
  if ("encrypted" in req.socket) {
    console.warn(`[skin-sheet] not saving ${name}.${sheetId}.png: drawn over https`);
    return res.writeHead(403).end();
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const filePath = path.join(PUBLIC_DIR, "sheet", `${name}.${sheetId}.png`);
    const hash = skinSheetHash(name as "skin" | "skin-slices", sheetId);
    // every World sends it on every load: written only if what it is drawn from changed
    const was = fs.existsSync(filePath) ? (hashOf(fs.readFileSync(filePath)) ?? "unhashed") : "missing";
    if (was !== hash) {
      fs.writeFileSync(filePath, withHash(await squeezePng(Buffer.concat(chunks)), hash));
      console.log(`[skin-sheet] redrew ${name}.${sheetId}.png: was ${was}, now ${hash}`);
    }
    res.writeHead(200).end();
  } catch (err) {
    console.error("[skin-sheet] failed:", err);
    res.writeHead(500).end();
  }
}

function squeezePng(png: Buffer) {
  return new Promise<Buffer>((resolve) => {
    const proc = childProcess.execFile("pngquant", ["-"], { encoding: "buffer" }, (err, stdout) => {
      if (err) console.warn("[skin-sheet] pngquant failed: left unsqueezed", err.message);
      resolve(err ? png : stdout);
    });
    proc.stdin?.end(png);
  });
}

async function handleGenSkinSheets(res: ServerResponse) {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = childProcess.spawn("pnpm", ["exec", "gen-skin-sheets"], { cwd: PROJECT_ROOT, stdio: "inherit" });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
      proc.on("error", reject);
    });
    res.writeHead(200).end();
  } catch (err) {
    console.error("[gen-skin-sheets] failed:", err);
    res.writeHead(500).end();
  }
}

async function handleGenStarshipSheets(res: ServerResponse) {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = childProcess.spawn("pnpm", ["gen-starship-sheets"], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
      proc.on("error", reject);
    });
    res.writeHead(200).end();
  } catch (err) {
    console.error("[gen-starship-sheets] failed:", err);
    res.writeHead(500).end();
  }
}

/** Every symbol and map, every layout made afresh: the WorldMenu's assets button */
async function handleGenAssetsJson(server: ViteDevServer, res: ServerResponse) {
  try {
    await genAssetsJson(server, { fresh: true });
    // every page, not only the one that pressed it: our own write is otherwise never announced
    server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
    res.writeHead(200).end();
  } catch (err) {
    console.error("[gen-assets-json] failed:", err);
    res.writeHead(500).end();
  }
}

/** When the page last saved a theme, which it has applied already — see `onAssetsJsonChange` */
let themeSavedAt = 0;
const selfWriteGraceMs = 1000;

async function handleAssetsTheme(req: IncomingMessage, res: ServerResponse, themeKey: string) {
  let body = "";
  for await (const chunk of req) body += chunk;
  const parsed = jsonParser.pipe(WorldThemeSchema).safeParse(body);
  if (!parsed.success) {
    res.writeHead(400).end();
    return;
  }
  const themes = fs.existsSync(THEME_JSON_PATH) ? JSON.parse(fs.readFileSync(THEME_JSON_PATH, "utf-8")) : {};
  themes[decodeURIComponent(themeKey)] = parsed.data;
  themeSavedAt = Date.now();
  fs.writeFileSync(THEME_JSON_PATH, safeJsonCompact(themes));
  res.writeHead(200).end();
}

// Type mirroring avoids HMR issue
type WorldConst = typeof import("@npc-cli/ui__world/const.env");
const assetsJsonChangingEvent: WorldConst["assetsJsonChangingEvent"] = "assets-json-changing";
const assetsJsonChangedEvent: WorldConst["assetsJsonChangedEvent"] = "assets-json-changed";

/** Runs `genAssetsJson` in the dev server's own process, its module reloaded once its code changes */
async function genAssetsJson(server: ViteDevServer, opts: Parameters<GenAssetsJson>[0]) {
  const mod = (await server.ssrLoadModule(GEN_ASSETS_SERVICE)) as { genAssetsJson: GenAssetsJson };
  mod.genAssetsJson(opts);
  wroteAssetsJson = readOrNull(ASSETS_JSON_PATH);
}

/** The `assets.json` we last wrote: its own file event is no hand edit */
let wroteAssetsJson: null | string = null;

type GenAssetsJson = typeof import("./service/gen-assets-json.ts").genAssetsJson;

/** The file's text, else `null` if it cannot be read e.g. removed */
function readOrNull(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
