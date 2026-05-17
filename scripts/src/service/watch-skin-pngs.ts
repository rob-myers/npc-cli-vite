import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import {
  AssetsSkinEntrySchema,
  AssetsSkinManifestSchema,
  type AssetsSkinManifestType,
} from "@npc-cli/ui__world/assets.schema";
import { info, parseJsArg, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import type { ViteDevServer } from "vite";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

// SKIN_PUBLIC_DIR is actually a symlink to packages/media/src/skin
const SKIN_PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public/skin");
const SKIN_MANIFEST_PATH = path.join(SKIN_PUBLIC_DIR, "manifest.json");

export function watchSkinPngs(server: ViteDevServer) {
  fs.mkdirSync(SKIN_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
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
  return filePath.startsWith(SKIN_PUBLIC_DIR) && filePath.endsWith(".png") && !filePath.match(/\.\d+\.png$/);
}

export async function rebuildSkinManifest() {
  const pngFiles = fs.globSync(path.join(SKIN_PUBLIC_DIR, "*.png"));
  const byKey: AssetsSkinManifestType["byKey"] = {};

  for (const filePath of pngFiles) {
    // e.g. [{namemc-uid}]{key:'medic-0',tags:['foo','bar','baz']}.png
    const filename = path.basename(filePath);
    const basename = path.basename(filename, ".png");
    const matched = basename.match(/^\[([^\]]+)\](\S+)$/);

    const suffixParseResult = z
      .object({
        key: z.string(),
        tags: z.array(z.string()),
      })
      .safeParse(parseJsArg(matched?.[2]));

    if (!matched || !suffixParseResult.success) {
      warn(
        `[watch-skin] expected filename format [{namemc-uid}]{key:'medic-0',tags:['foo','bar','baz']}.png: saw "${matched?.[2]}"`,
      );
      continue;
    }

    const namemcDotComUid = matched?.[1];
    const meta = suffixParseResult.data;

    byKey[meta.key] = AssetsSkinEntrySchema.parse({
      key: meta.key,
      id: namemcDotComUid,
      filename,
      tags: meta.tags,
      url: `https://namemc.com/skin/${namemcDotComUid}`,
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
