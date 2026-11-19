import { tokenCss, tokenizeShell } from "@npc-cli/cli/shell/sh-tokens";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, tw } from "@npc-cli/util";
import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type PreludeEntry, preludeApi, usePrelude } from "./store";

/** The commands a World autoruns, in order, each removable */
export function PreludeEntries({ worldKey }: { worldKey: string }) {
  const { entries } = usePrelude(worldKey);
  const { uiStore } = useContext(UiContext);
  const sessionKeys = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap(({ meta }) => (meta.uiKey === "Jsh" ? (meta as JshUiMeta).sessionKey : [])),
    ),
  );

  if (entries.length === 0) {
    return <div className="px-5 py-3 text-sm text-term-muted leading-snug">Nothing yet.</div>;
  }
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          missing={sessionKeys.includes(entry.sessionKey) === false}
          onRemove={() => preludeApi.remove(worldKey, entry.id)}
        />
      ))}
    </ol>
  );
}

function EntryRow({ entry, missing, onRemove }: { entry: PreludeEntry; missing: boolean; onRemove(): void }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 px-5 py-2.5 border-b border-term-border-subtle last:border-b-0">
      <button type="button" className="min-w-0 text-left cursor-pointer" onClick={toggle}>
        <code className={cn(codeCss, "text-sh-comment")}>{entry.comment || entry.src}</code>
        <span className="block mt-0.5 text-xs text-term-muted">
          {entry.sessionKey}
          {missing && <span className="text-term-danger"> (no tty)</span>} · {entry.articleKey}
        </span>
      </button>
      <span className="flex items-start gap-0.5">
        <button
          type="button"
          title={expanded ? "hide command" : "show command"}
          className={iconButtonCss}
          onClick={toggle}
        >
          {expanded ? <CaretUpIcon className="size-3.5" /> : <CaretDownIcon className="size-3.5" />}
        </button>
        <button type="button" title="remove" className={iconButtonCss} onClick={onRemove}>
          <XIcon className="size-3.5" />
        </button>
      </span>
      {expanded && (
        <code className={cn(codeCss, "col-span-2 mt-2 px-2 py-1.5 rounded bg-term-fence text-sh-text")}>
          <Highlighted src={entry.src} />
        </code>
      )}
    </li>
  );
}

/** `src` coloured as SkipNet's fences colour it */
function Highlighted({ src }: { src: string }) {
  const tokens = useMemo(() => tokenizeShell(src), [src]);
  return tokens.map(({ start, end, kind }) => (
    <span key={start} className={tokenCss[kind]}>
      {src.slice(start, end)}
    </span>
  ));
}

const codeCss = tw("block font-mono text-xs whitespace-pre-wrap wrap-break-word");
const iconButtonCss = tw("p-0.5 rounded cursor-pointer text-term-muted hover:bg-term-hover hover:text-term-foreground");
