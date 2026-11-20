import { PlusCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import { tw } from "../service/tailwind-cn";

/** A small card that makes something: labelled rows, then why it can't, else a create button. */
export function CreateForm(props: { children: ReactNode; error: string | null; onCreate(): void }) {
  return (
    <form
      className={cardClass}
      onSubmit={(e) => {
        e.preventDefault();
        if (props.error === null) props.onCreate();
      }}
    >
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">{props.children}</div>
      <div className="flex items-center gap-2 min-h-6">
        {props.error !== null && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <WarningIcon className="size-3.5 shrink-0" weight="duotone" />
            {props.error}
          </span>
        )}
        <button type="submit" className={createClass} disabled={props.error !== null}>
          <PlusCircleIcon className="size-4" weight="duotone" />
          create
        </button>
      </div>
    </form>
  );
}

/** A row of a `CreateForm`: its label, then e.g. a `Picker`. */
export function CreateFormRow(props: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={labelClass}>{props.label}</span>
      {props.children}
    </>
  );
}

/** A row of a `CreateForm` to type a key in, focused with its text selected. */
export function CreateFormKey(props: {
  label: string;
  value: string;
  invalid: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className={labelClass}>
        {props.label}
      </label>
      <input
        id={id}
        type="text"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        className={inputClass}
        aria-invalid={props.invalid}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
    </>
  );
}

/** Like the context menu it opens beside */
const cardClass = tw(
  "w-64 p-3 flex flex-col gap-2.5 rounded-md border border-white/15 bg-black/90 text-white text-sm font-mono shadow-lg",
);
const labelClass = tw("text-xs text-white/60");
/** Like `Picker`'s trigger */
const inputClass = tw(
  "w-full min-w-0 px-1 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 outline-none focus:border-zinc-600 aria-invalid:border-red-400/60",
);
const createClass = tw(
  "ml-auto flex items-center gap-1 px-2 py-1 rounded bg-white/10 text-xs cursor-pointer hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed",
);
