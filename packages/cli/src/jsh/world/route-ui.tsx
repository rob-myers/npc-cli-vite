import {
  ArmchairIcon,
  BellRingingIcon,
  ChatCircleTextIcon,
  DoorOpenIcon,
  EyeIcon,
  FootprintsIcon,
  HandshakeIcon,
  HourglassIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { RouteStep } from "./route";

/** A route node's steps, shown above it once clicked — see `route.ts`. `WorldHtml` places and scales it */
export function RouteNodeUi({ name, role, steps }: { name: string; role: string; steps: [number, RouteStep][] }) {
  return (
    <div className="pointer-events-auto flex max-h-80 w-(--html-width,40rem) flex-col gap-3 overflow-auto rounded-2xl border-4 border-white/40 bg-black/30 px-5 py-4 text-[1.8rem] text-white/90">
      <div className="flex items-baseline gap-3 text-[1.5rem] tracking-wide">
        <span className="font-medium text-white/90">{name}</span>
        <span className="text-white/40">/</span>
        <span className="text-white/70">{role}</span>
        <span className="ml-auto text-white/40">#{steps[0]?.[0]}</span>
      </div>
      {steps.map(([index, step]) => {
        const StepIcon = iconOf[step.kind];
        return (
          <div key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white/5 px-4 py-2">
            <StepIcon className="size-9 shrink-0 text-white/80" weight="duotone" />
            <span className="w-20 shrink-0 font-medium">{step.kind}</span>
            <div className="flex flex-wrap gap-2">
              {fieldsOf(step).map(([label, value]) => (
                <span
                  key={label}
                  className="rounded-lg border border-white/20 bg-black/40 px-3 py-0.5 whitespace-nowrap"
                >
                  <span className="text-white/50">{label} </span>
                  {value}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const iconOf: Record<RouteStep["kind"], Icon> = {
  move: FootprintsIcon,
  do: ArmchairIcon,
  wait: HourglassIcon,
  look: EyeIcon,
  open: DoorOpenIcon,
  close: DoorOpenIcon,
  say: ChatCircleTextIcon,
  sync: HandshakeIcon,
  signal: BellRingingIcon,
  await: BellRingingIcon,
};

/** A step's fields as label/value chips */
function fieldsOf(step: RouteStep): [label: string, value: string][] {
  // biome-ignore format: succinct
  switch (step.kind) {
    case "move": return [["x", step.at.x.toFixed(2)], ["y", step.at.y.toFixed(2)], ["room", step.grKey], ...(step.anchor ? [["anchor", Object.values(step.anchor)[0]] as [string, string]] : [])];
    case "do": return [["decor", step.decorKey]];
    case "wait": return [["for", `${(step.ms / 1000).toFixed(1)}s`]];
    case "look": return typeof step.at === "string" ? [["at", step.at]] : [["x", step.at.x.toFixed(2)], ["y", step.at.y.toFixed(2)]];
    case "open": case "close": return [["door", step.gdKey]];
    case "say": return [["words", `"${step.words}"`], ...(step.secs === undefined ? [] : [["for", `${step.secs}s`] as [string, string]])];
    case "sync": case "signal": case "await": return [["code", step.code]];
  }
}
