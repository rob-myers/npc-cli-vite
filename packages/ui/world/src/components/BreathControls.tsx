import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type BreathTune, breathTuneRanges, defaultBreathTune } from "../const.npc";
import { Slider } from "./PsiControls";
import type { State as WorldState } from "./World";

/** The player's breathing, as `tickBreath` moves them: folded away until asked for */
export default function BreathControls({ w }: { w: WorldState }) {
  const [kept, setTune] = useState(() => ({ ...w.npc.breathTune }));
  /** Over the defaults: a field added since is absent from a tune kept over hmr, here or in the World */
  const tune = { ...defaultBreathTune, ...kept };
  const [open, setOpen] = useState(() => tryLocalStorageGetParsed<boolean>(openStorageKey) === true);
  const Caret = open === true ? CaretDownIcon : CaretRightIcon;
  const apply = (partial: Partial<BreathTune>) => {
    w.npc.setBreathTune(partial);
    setTune({ ...w.npc.breathTune });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-white/20 pt-3 text-lg">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex flex-1 cursor-pointer items-center gap-2 text-left text-white/50 hover:text-white"
          onClick={() => {
            tryLocalStorageSet(openStorageKey, String(!open));
            setOpen(!open);
          }}
        >
          <Caret className="size-5 shrink-0" />
          breathing
        </button>
        {open === true && (
          <button
            type="button"
            className="cursor-pointer rounded-lg border-2 border-white/20 px-3 text-white/60 hover:text-white"
            onClick={() => apply(defaultBreathTune)}
          >
            reset
          </button>
        )}
      </div>
      {open === true &&
        sliderKeys.map((key) => (
          <Slider
            key={key}
            label={key}
            range={breathTuneRanges[key]}
            value={tune[key]}
            onChange={(value) => apply({ [key]: value })}
          >
            {tune[key].toFixed(decimals[key])}
          </Slider>
        ))}
    </div>
  );
}

const openStorageKey = "breath-controls-open";

const sliderKeys = Object.keys(breathTuneRanges) as (keyof typeof breathTuneRanges)[];

const decimals = { rate: 0, inhale: 2, reach: 3, glow: 2 } satisfies Record<keyof BreathTune, number>;
