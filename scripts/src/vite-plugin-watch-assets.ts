import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { WorldThemeSchema } from "@npc-cli/ui__world/assets.schema";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import type { Plugin, ViteDevServer } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const WATCH_DECOR_SVGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-decor-svgs.ts");
const WATCH_SKIN_PNGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-skin-pngs.ts");
const WATCH_SKIN_SVGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-skin-svgs.ts");
const ICON_DIR = path.join(PROJECT_ROOT, "packages/media/src/icon");
const ASSETS_JSON_PATH = path.join(PUBLIC_DIR, "assets.json");
const GEN_ASSETS_BIN = path.join(PROJECT_ROOT, "scripts/src/bins/gen-assets-json.ts");
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

      // imported assets outside the app's root are not watched, so an edited icon would never hot-reload
      server.watcher.add(ICON_DIR);

      const symbolGlob = path.join(PUBLIC_DIR, "symbol/*.json");
      const mapGlob = path.join(PUBLIC_DIR, "map/*.json");
      server.watcher.add([symbolGlob, mapGlob, GEOMORPH_SERVICE, ASSETS_JSON_PATH]);

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let running = false;
      const changed = new Map<string, number>();

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

        try {
          // generate assets.json
          await new Promise<void>((resolve, reject) => {
            const proc = childProcess.spawn(
              "node",
              ["--import=tsx", GEN_ASSETS_BIN, `--changedFiles=${JSON.stringify(changedFiles)}`],
              { cwd: PROJECT_ROOT, stdio: "inherit" },
            );
            proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
            proc.on("error", reject);
          });
          // inform browser
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
        } catch (err) {
          console.error("[watch-assets] gen-assets-json failed:", err);
        }

        changed.forEach((epochMs, file) => epochMs <= startEpochMs && changed.delete(file));
        running = false;
        if (changed.size > 0) {
          await runGenAssets(server);
        }
      };

      /** A hand edit of assets.json, e.g. a theme value: the browser is only told of our own writes otherwise */
      let handEditTimer: ReturnType<typeof setTimeout> | null = null;
      const onAssetsJsonChange = () => {
        if (running || Date.now() - themeSavedAt < selfWriteGraceMs) return; // ours: already announced, or the page's own
        if (handEditTimer) clearTimeout(handEditTimer);
        handEditTimer = setTimeout(() => {
          if (running) return;
          console.log("[watch-assets] assets.json edited by hand");
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
        }, 100);
      };

      const onFileChange = (filePath: string) => {
        if (filePath === ASSETS_JSON_PATH) return onAssetsJsonChange();
        if (!isWatchedFile(filePath)) return;
        if (isAssetInputFile(filePath)) changed.set(filePath, Date.now());
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
          return handleGenAssetsJson(res);
        }
        const skinSheetMatch = req.url?.match(/^\/api\/skin-sheet\/(\d+)$/);
        if (skinSheetMatch && req.method === "POST") {
          return handleSkinSheet(req, res, Number(skinSheetMatch[1]));
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

/** A skin sheet drawn by a DEV World — see `docs/skins.md` */
async function handleSkinSheet(req: IncomingMessage, res: ServerResponse, sheetId: number) {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const png = await squeezePng(Buffer.concat(chunks));
    const filePath = path.join(PUBLIC_DIR, "sheet", `skin.${sheetId}.png`);
    // every World sends it on every load: written only if its pixels changed
    if (!fs.existsSync(filePath) || !(await samePixels(png, fs.readFileSync(filePath)))) {
      fs.writeFileSync(filePath, png);
      console.log(`[skin-sheet] redrew skin.${sheetId}.png`);
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

async function samePixels(a: Buffer, b: Buffer) {
  const [pa, pb] = await Promise.all([a, b].map(getPixels));
  return Buffer.from(pa.buffer).equals(Buffer.from(pb.buffer));
}

async function getPixels(png: Buffer) {
  const image = await loadImage(png);
  const ct = new Canvas(image.width, image.height).getContext("2d");
  ct.drawImage(image, 0, 0);
  return ct.getImageData(0, 0, image.width, image.height).data;
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

async function handleGenAssetsJson(res: ServerResponse) {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = childProcess.spawn("pnpm", ["gen-assets-json"], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
      proc.on("error", reject);
    });
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
  const assets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, "utf-8"));
  assets.theme ??= {};
  assets.theme[decodeURIComponent(themeKey)] = parsed.data;
  themeSavedAt = Date.now();
  fs.writeFileSync(ASSETS_JSON_PATH, safeJsonCompact(assets));
  res.writeHead(200).end();
}

// Type mirroring avoids HMR issue
type WorldConst = typeof import("@npc-cli/ui__world/const.env");
const assetsJsonChangingEvent: WorldConst["assetsJsonChangingEvent"] = "assets-json-changing";
const assetsJsonChangedEvent: WorldConst["assetsJsonChangedEvent"] = "assets-json-changed";
