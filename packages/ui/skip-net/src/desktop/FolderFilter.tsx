import { tw } from "@npc-cli/util";
import { CheckSquareIcon, SquareIcon } from "@phosphor-icons/react";
import { articleFolders } from "../articles";

/** A checkbox per folder atop the article picker, each ticked at first: a press hides its articles, again shows them */
export function FolderFilter({ hidden, onToggle }: { hidden: string[]; onToggle(folder: string): void }) {
  return (
    <div className={filterBarClass}>
      <div role="group" aria-label="folders shown" className={segmentsClass}>
        {articleFolders.map(({ key }) => {
          const shown = !hidden.includes(key);
          const Check = shown ? CheckSquareIcon : SquareIcon;
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={shown}
              className={segmentClass}
              onClick={() => onToggle(key)}
            >
              <Check weight={shown ? "fill" : "regular"} />
              <span>{key}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The article picker's filters, over a rule */
const filterBarClass = tw("px-2 pt-1 pb-1.5 border-b border-mac-edge");
/** Segments joined in one box, as a classic toolbar's */
const segmentsClass = tw(
  "flex rounded-sm border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)] overflow-hidden divide-x divide-mac-edge",
);
/** Green and ticked whilst shown, else dimmed */
const segmentClass = tw(
  "flex-1 flex items-center justify-center gap-1 px-2 py-0.5 cursor-pointer text-mac-muted hover:bg-mac-text/10 [&_svg]:size-3.5 [&_svg]:shrink-0 aria-checked:bg-emerald-500/20 aria-checked:text-emerald-800 dark:aria-checked:text-emerald-300",
);
