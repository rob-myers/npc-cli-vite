import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Lists the hashed assets a deploy carries, so the next build can carry them forward */
const historyFile = "asset-history.json";
/** A superseded asset is dropped once this many deploys have passed without it */
const retainDeploys = 30;
const assetKeyRegex = /^assets\/[\w.-]+$/;

type History = {
  seq: number;
  files: Record<string, { seq: number; at: number }>;
  /** Each retained deploy's ui entry chunks, so consecutive deploys can be diffed */
  deploys?: {
    seq: number;
    at: number;
    commit: string | null;
    ui: Record<string, string>;
    /** `current` is this build's assets, of which `added` are new to the site; `carried` are older */
    counts: Tally;
    bytes: Tally;
  }[];
};
type Tally = { current: number; added: number; carried: number };

/**
 * Copies forward the live site's hashed assets this build no longer emits, so a tab left open
 * across a deploy can still lazy-load its own build's chunks. The live site is the archive.
 */
export function assetHistoryPlugin(): Plugin {
  let outDir = "";
  let ui: Record<string, string> = {};
  // a Netlify production build is still serving the previous deploy
  const from = process.env.ASSET_HISTORY_FROM || (process.env.CONTEXT === "production" ? process.env.URL : undefined);

  return {
    name: "asset-history",
    apply: "build",

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },

    generateBundle(_, bundle) {
      ui = {};
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type === "chunk" &&
          chunk.isDynamicEntry &&
          /[\\/]packages[\\/]ui[\\/]/.test(chunk.facadeModuleId ?? "")
        ) {
          ui[chunk.name] = chunk.fileName;
        }
      }
    },

    async closeBundle() {
      try {
        const prev = from ? await fetchHistory(from) : null;
        const seq = (prev?.seq ?? 0) + 1;
        const now = Date.now();
        const prevFiles = prev?.files ?? {};
        const files: History["files"] = {};
        const counts: Tally = { current: 0, added: 0, carried: 0 };
        const bytes: Tally = { current: 0, added: 0, carried: 0 };
        for (const f of await fs.readdir(path.join(outDir, "assets"))) {
          const key = `assets/${f}`;
          const { size } = await fs.stat(path.join(outDir, key));
          files[key] = { seq, at: now };
          counts.current++;
          bytes.current += size;
          if (!(key in prevFiles)) {
            counts.added++;
            bytes.added += size;
          }
        }

        const superseded = Object.entries(prevFiles).filter(
          ([key, v]) => !(key in files) && assetKeyRegex.test(key) && seq - v.seq <= retainDeploys,
        );
        await eachLimit(superseded, 8, async ([key, v]) => {
          const res = await fetch(new URL(`/${key}`, from)).catch(() => null);
          if (!res?.ok) return; // lost upstream, so forget it
          const buf = Buffer.from(await res.arrayBuffer());
          await fs.writeFile(path.join(outDir, key), buf);
          files[key] = v;
          counts.carried++;
          bytes.carried += buf.length;
        });

        const deploys = [
          ...(Array.isArray(prev?.deploys) ? prev.deploys : []).filter((d) => seq - d.seq < retainDeploys),
          { seq, at: now, commit: process.env.COMMIT_REF ?? null, ui, counts, bytes },
        ];
        await fs.writeFile(path.join(outDir, historyFile), `${JSON.stringify({ seq, files, deploys })}\n`);
        const mb = (n: number) => `${(n / 2 ** 20).toFixed(1)}MB`;
        console.log(
          `[asset-history] deploy #${seq}: ${counts.current} assets ${mb(bytes.current)} (${counts.added} new ${mb(bytes.added)}), carried ${counts.carried} ${mb(bytes.carried)}${from ? ` from ${from}` : ""}`,
        );
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
