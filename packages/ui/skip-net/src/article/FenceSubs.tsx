import { Input } from "@base-ui/react/input";
import { Popover } from "@base-ui/react/popover";
import { subsPattern } from "@npc-cli/ui__jsh-prelude/store";
import { cn, Tip, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { ArrowCounterClockwiseIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useContext, useState } from "react";
import { SkipNetContext } from "../context";
import { titlePickerPopupClass } from "../desktop/classes";
import { type FenceRule, fenceKinds } from "./fence-rules";

/** `text` with `subs` applied, each replaced word coloured as a shell keyword */
export function Subbed({ text, subs }: { text: string; subs: Record<string, string> }) {
  const pattern = subsPattern(subs);
  if (pattern === null) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(
      text.slice(at, match.index),
      <span key={match.index} className="text-sh-keyword">
        {subs[match[0]]}
      </span>,
    );
    at = match.index + match[0].length;
  }
  return [...parts, text.slice(at)];
}

/**
 * An input for one rule's replacement, a reset beside it, and a picker of rules if many.
 * A value is kept only once valid for its kind.
 */
export function SubsEditor({
  rules,
  values,
  onChange,
}: {
  rules: FenceRule[];
  values: Record<string, string>;
  onChange(literal: string, value: string): void;
}) {
  const [at, setAt] = useState(rules[0].literal);
  /** What is typed, valid or not, by literal */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rule = rules.find((x) => x.literal === at) ?? rules[0];
  const value = values[rule.literal] ?? rule.literal;
  const draft = drafts[rule.literal] ?? value;
  const valid = fenceKinds[rule.kind].test(draft);

  const change = (next: string) => {
    setDrafts({ ...drafts, [rule.literal]: next });
    fenceKinds[rule.kind].test(next) && onChange(rule.literal, next);
  };

  return (
    <span className="ml-auto flex min-w-0 items-center gap-1">
      {rules.length > 1 && (
        <Picker
          value={rule.literal}
          options={rules.map((x) => ({ value: x.literal, label: `${x.literal}:${x.kind}` }))}
          onChange={setAt}
          className={pickerClass}
          popupClassName={titlePickerPopupClass}
        />
      )}
      <span aria-invalid={!valid} className={fieldClass}>
        <Input
          value={draft}
          onValueChange={change}
          aria-invalid={!valid}
          spellCheck={false}
          title={`${rule.kind} in place of ${rule.literal}`}
          className={inputClass}
        />
        <Tip content={`reset to ${rule.literal}`}>
          <button
            type="button"
            disabled={draft === rule.literal}
            className={resetClass}
            onClick={() => change(rule.literal)}
          >
            <ArrowCounterClockwiseIcon className="size-2.5" weight="bold" />
          </button>
        </Tip>
      </span>
    </span>
  );
}

/** An edit button on a flat fence, opening its `SubsEditor` in a popover beside it */
export function SubsPopover({
  inline,
  ...props
}: Parameters<typeof SubsEditor>[0] & {
  /** Among a command's buttons, else over its fence's top-right edge */
  inline?: boolean;
}) {
  const state = useContext(SkipNetContext);
  return (
    <Popover.Root>
      <Tip content="substitutions">
        <Popover.Trigger className={cn(editClass, inline ? "size-5" : cornerClass)}>
          <PencilSimpleIcon className="size-3" />
        </Popover.Trigger>
      </Tip>
      <Popover.Portal container={state.rootEl}>
        <Popover.Positioner className="z-3000" positionMethod="absolute" side="top" align="end" sideOffset={4}>
          <Popover.Popup className={popupClass}>
            <SubsEditor {...props} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Its input and reset as one control, one border round both */
const fieldClass = tw(
  "flex h-5 items-stretch overflow-hidden rounded-sm border border-term-border bg-term-inset focus-within:border-term-focus aria-[invalid=true]:border-term-danger",
);
/** As wide as its text, growing as it is typed */
const inputClass = tw(
  "min-w-[3ch] max-w-[16ch] [field-sizing:content] bg-transparent px-1 font-mono text-xs text-term-foreground outline-none aria-[invalid=true]:text-term-danger",
);
const pickerClass = tw("h-5 py-0 text-xs");
/** Flush on the input's right, its icon plainly shown, even whilst there is nothing to reset */
const resetClass = tw(
  "grid w-5 place-items-center border-l border-term-border text-term-muted cursor-pointer enabled:hover:text-term-foreground enabled:hover:bg-term-hover-strong disabled:cursor-default",
);
/** Over a flat fence's top-right edge, partly see-through until used */
const cornerClass = tw("absolute -right-1 -top-3 z-2 size-6 opacity-75 hover:opacity-100 data-popup-open:opacity-100");
/** Its edit button, bordered to stand out */
const editClass = tw(
  "grid place-items-center rounded-sm border border-term-border bg-term-surface text-term-muted shadow-sm cursor-pointer hover:text-term-foreground hover:border-term-focus data-popup-open:border-term-focus data-popup-open:text-term-foreground",
);
const popupClass = tw(
  "p-1.5 rounded-sm bg-term-fence border border-term-border shadow-[2px_2px_0_var(--color-mac-shadow)] outline-none",
);
