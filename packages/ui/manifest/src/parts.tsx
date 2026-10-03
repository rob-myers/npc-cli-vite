import { Picker as BasePicker } from "@npc-cli/util/picker";

export function IconButton(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className="grid place-items-center size-6 shrink-0 rounded border border-zinc-800 text-zinc-400 cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default"
      onClick={props.onClick}
    >
      <props.icon className="size-3.5" />
    </button>
  );
}

/** Its popup is portalled out of the panel, so it is told whose theme to take */
export function Picker<T extends string>(props: Omit<Parameters<typeof BasePicker<T>>[0], "popupClassName">) {
  return <BasePicker {...props} popupClassName="manifest" />;
}
