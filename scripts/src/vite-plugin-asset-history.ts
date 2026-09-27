import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Lists the hashed assets a deploy carries, so the next build can carry them forward */
const historyFile = "asset-history.json";
/** A superseded asset is dropped once either runs out */
const retainDeploys = 30;
const retainDays = 14;
const dayMs = 24 * 60 * 60 * 1000;
const assetKeyRegex = /^assets\/[\w.-]+$/;

type History = { seq: number; files: Record<string, { seq: number; at: number }> };

/**
 * Copies forward the live site's hashed assets this build no longer emits, so a tab left open
 * across a deploy can still lazy-load its own build's chunks. The live site is the archive.
 */
export function assetHistoryPlugin(): Plugin {
  let outDir = "";
  // a Netlify production build is still serving the previous deploy
  const from = process.env.ASSET_HISTORY_FROM || (process.env.CONTEXT === "production" ? process.env.URL : undefined);

  return {
    name: "asset-history",
    apply: "build",

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },

    async closeBundle() {
      try {
        const prev = from ? await fetchHistory(from) : null;
        const seq = (prev?.seq ?? 0) + 1;
        const now = Date.now();
        const files: History["files"] = {};
        for (const f of await fs.readdir(path.join(outDir, "assets"))) files[`assets/${f}`] = { seq, at: now };

        const superseded = Object.entries(prev?.files ?? {}).filter(
          ([key, v]) =>
            !(key in files) &&
            assetKeyRegex.test(key) &&
            seq - v.seq <= retainDeploys &&
            now - v.at <= retainDays * dayMs,
        );
        await eachLimit(superseded, 8, async ([key, v]) => {
          const res = await fetch(new URL(`/${key}`, from)).catch(() => null);
          if (!res?.ok) return; // lost upstream, so forget it
          await fs.writeFile(path.join(outDir, key), Buffer.from(await res.arrayBuffer()));
          files[key] = v;
        });

        await fs.writeFile(path.join(outDir, historyFile), `${JSON.stringify({ seq, files })}\n`);
        const carried = Object.values(files).filter((v) => v.seq !== seq).length;
        console.log(`[asset-history] deploy #${seq}: carried ${carried} superseded assets${from ? ` from ${from}` : ""}`);
      } catch (e) {
        console.warn("[asset-history] skipped:", e); // never fail a deploy over history
      }
    },
  };
}

async function fetchHistory(from: string): Promise<History | null> {
  try {
    const res = await fetch(new URL(`/${historyFile}?t=${Date.now()}`, from));
    const json = res.ok ? await res.json() : null; // a first deploy gets the spa's index.html
    return typeof json?.seq === "number" && typeof json.files === "object" ? json : null;
  } catch {
    return null;
  }
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) await fn(queue.shift() as T);
    }),
  );
}
