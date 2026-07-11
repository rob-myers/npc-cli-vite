import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import {
  AssetsSkinEntrySchema,
  AssetsSkinManifestSchema,
  type AssetsSkinManifestType,
} from "@npc-cli/ui__world/assets.schema";
import { info, safeJsonCompact, tagsToMeta, textToTags, warn } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";
import type { ViteDevServer } from "vite";
import z from "zod";

import { PROJECT_ROOT } from "../const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
/** symlink to packages/media/src/skin */
const SKIN_PUBLIC_DIR = path.join(PUBLIC_DIR, "skin");
const SKIN_MANIFEST_PATH = path.join(SKIN_PUBLIC_DIR, "manifest.json");

export function watchSkinPngs(server: ViteDevServer) {
  fs.mkdirSync(SKIN_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        server.hot.send({ type: "custom", event: devMessageFromServer.skinSheetsRebuilding });
        execSync("pnpm exec gen-skin-sheets", { cwd: PROJECT_ROOT, stdio: "inherit" });
        server.hot.send({ type: "custom", event: devMessageFromServer.skinSheetsRebuilt });
      } catch (e) {
        warn("[watch-skin] gen-skin-sheets failed:", e);
      }
    }, 200);
  };

  server.watcher.add(path.join(SKIN_PUBLIC_DIR, "*.png"));
  server.watcher.on("add", (filePath) => isSkinPng(filePath) && rebuild());
  server.watcher.on("change", (filePath) => isSkinPng(filePath) && rebuild());
  server.watcher.on("unlink", (filePath) => isSkinPng(filePath) && rebuild());

  // initial build (no notification needed)
  rebuildSkinManifest();
}

function isSkinPng(filePath: string) {
  return filePath.startsWith(SKIN_PUBLIC_DIR) && filePath.endsWith(".png") && !filePath.startsWith("skin.");
}

export async function rebuildSkinManifest() {
  const pngFiles = fs.globSync(path.join(SKIN_PUBLIC_DIR, "*.png"));
  const byKey: AssetsSkinManifestType["byKey"] = {};

  for (const filePath of pngFiles) {
    const filename = path.basename(filePath);
    const basename = path.basename(filename, ".png");
    // e.g. human-0--23aa3d70ee53af87
    const [key, namemcDotComUid] = basename.split("--");

    const svgLocalPath = `skin/${key}.svg`;
    const svgPath = path.join(PUBLIC_DIR, svgLocalPath);
    const svgExists = fs.existsSync(svgPath);

    if (!key || !namemcDotComUid) {
      warn(`[rebuildSkinManifest] expected filename format {key}--{namemc.com__uid}.png: saw "${filename}"`);
      continue;
    }

    byKey[key] = AssetsSkinEntrySchema.decode({
      key,
      id: namemcDotComUid,
      filename,
      meta: {
        skinKey: key,
        // via SVG top-level objects with title "meta foo=bar ..."
        ...(svgExists ? parseSvgMetadata(svgPath) : null),
      },
      url: `https://namemc.com/skin/${namemcDotComUid}`,
      svgPath: svgExists ? svgLocalPath : null,
    });
  }

  const nextManifest: AssetsSkinManifestType = { byKey };
  const nextRaw = safeJsonCompact(z.encode(AssetsSkinManifestSchema, nextManifest));

  const prevRaw = await fs.promises.readFile(SKIN_MANIFEST_PATH, "utf-8").catch(() => null);
  if (prevRaw === nextRaw) {
    info(`[watch-skin] manifest.json: no changes detected`);
    return;
  }

  fs.writeFileSync(SKIN_MANIFEST_PATH, nextRaw);
  info(`[watch-skin] rebuilt manifest.json`);
}

/**
 * SVG {skinKey}.svg represents meta via top-level object(s) titled "meta ..."
 */
function parseSvgMetadata(svgPath: string) {
  const svgContent = fs.readFileSync(svgPath, "utf-8");

  const meta = {} as Record<string, any>;
  const tagStack = [] as string[];

  const parser = new Parser({
    onopentag(tagName) {
      tagStack.push(tagName);
      console.log(tagStack);
    },
    ontext(contents) {
      // e.g. ["svg", "g", "title"]
      if (tagStack.length === 3 && tagStack[2] === "title" && contents.startsWith("meta ")) {
        const ownTags = textToTags(contents.slice("meta ".length));
        tagsToMeta(ownTags, meta);
      }
    },
    onclosetag() {
      tagStack.pop();
    },
  });

  parser.write(svgContent);
  parser.end();

  return meta;
}
