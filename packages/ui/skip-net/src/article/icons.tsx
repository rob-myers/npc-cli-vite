import { cn, tw } from "@npc-cli/util";
import {
  CopyIcon as Copy,
  LightningIcon as Lightning,
  PencilSimpleIcon as Pencil,
  PlayIcon as Play,
} from "@phosphor-icons/react";

/** The autorun bolt, in text, e.g. `<BoltIcon />`. `on` as when a command autoruns */
export function BoltIcon({ on }: { on?: boolean }) {
  return <Lightning weight={on ? "fill" : "regular"} className={cn(iconClass, on && "text-yellow-400")} />;
}

/** The run button, in text, e.g. `<PlayIcon />` */
export function PlayIcon() {
  return <Play weight="fill" className={iconClass} />;
}

/** The copy button, in text, e.g. `<CopyIcon />` */
export function CopyIcon() {
  return <Copy className={iconClass} />;
}

/** The substitutions' edit button, in text, e.g. `<EditIcon />` */
export function EditIcon() {
  return <Pencil className={iconClass} />;
}

/** As tall as its text, on its baseline */
const iconClass = tw("inline-block size-[1.1em] align-[-0.2em]");
