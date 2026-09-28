import path from "node:path";
import type { Plugin } from "vite";

/**
 * Moves the entry's shared modules into `app-core`/`app-vendor`, so no chunk imports the entry.
 * The entry keeps whatever names hashed chunks, whose renames then stop at the entry.
 */
export function stableEntryPlugin(): Plugin {
  const core = new Set<string>();
  const workerUrlIds = new Set<string>();
  /** Entry-reachable worker spawners, which lazy uis may also import */
  const spawners = new Set<string>();

  return {
    name: "stable-entry",
    apply: "build",
    enforce: "pre",

    config() {
      return {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  // a worker spawner names its worker, so isolate it: importers then rename only with that worker
                  {
                    name: (id: string) => (spawners.has(id) ? path.basename(id).replace(/\.\w+$/, "") : null),
                    test: (id: string) => spawners.has(id),
                    priority: 30,
                  },
                  {
                    name: "app-vendor",
                    test: (id: string) => core.has(id) && id.includes("node_modules"),
                    priority: 20,
                    entriesAware: true,
                    entriesAwareMergeThreshold: 10_000,
                  },
                  {
                    name: "app-core",
                    test: (id: string) => core.has(id),
                    priority: 10,
                    entriesAware: true,
                    entriesAwareMergeThreshold: 10_000,
                  },
                ],
              },
            },
          },
        },
      };
    },

    transform(code, id) {
      if (/new URL\([^)]*import\.meta\.url/.test(code)) workerUrlIds.add(id); // names a worker's hashed file
    },

    buildEnd() {
      const info = (id: string) => this.getModuleInfo(id);
      const ids = [...this.getModuleIds()];
      const reachable = new Set<string>();
      const stack = ids.filter((id) => info(id)?.isEntry);
      while (stack.length) {
        const id = stack.pop() as string;
        if (reachable.has(id)) continue;
        reachable.add(id);
        stack.push(...(info(id)?.importedIds ?? []));
      }
      // naming a hashed chunk makes a module's hash follow it, and likewise its importers'
      const holders = new Set(
        ids.filter((id) => (info(id)?.dynamicallyImportedIds.length ?? 0) > 0 || workerUrlIds.has(id)),
      );
      const queue = [...holders];
      while (queue.length) {
        for (const imp of info(queue.pop() as string)?.importers ?? []) {
          if (!holders.has(imp)) {
            holders.add(imp);
            queue.push(imp);
          }
        }
      }
      for (const id of reachable) if (!holders.has(id)) core.add(id);
      for (const id of reachable) if (workerUrlIds.has(id) && !info(id)?.isEntry) spawners.add(id);
      if (process.env.STABLE_ENTRY_DEBUG)
        for (const id of reachable)
          if (holders.has(id))
            console.log(
              "  holder:",
              id.replace(/.*npc-cli-vite\//, ""),
              info(id)?.dynamicallyImportedIds.length
                ? "(import())"
                : workerUrlIds.has(id)
                  ? "(worker url)"
                  : "(imports a holder)",
            );
      console.log(
        `[stable-entry] ${reachable.size} entry-reachable modules: ${core.size} to app-core/vendor, ${reachable.size - core.size} name-holders stay`,
      );
    },
  };
}
