import { PreludeEntries } from "./PreludeEntries";
import type { JshPreludeUiMeta } from "./schema";
import { preludeApi, usePrelude } from "./store";

/** A World's prelude: whether auto-boot is on, and the commands it runs */
export default function JshPrelude({ meta }: { meta: JshPreludeUiMeta }) {
  const { autoBoot } = usePrelude(meta.worldKey);
  return (
    <div className="size-full overflow-y-auto scrollbar-thin bg-background text-sm text-on-background">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-term-border-subtle">
        <span className="font-mono text-xs text-term-muted">{meta.worldKey}</span>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <input
            type="checkbox"
            className="size-3 cursor-pointer"
            checked={autoBoot}
            onChange={(e) => preludeApi.setAutoBoot(meta.worldKey, e.currentTarget.checked)}
          />
          auto-boot
        </label>
      </div>
      <PreludeEntries worldKey={meta.worldKey} />
    </div>
  );
}
