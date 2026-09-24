import { useState } from "react";
import { defaultPsiTune, type PsiTune, psiTuneRanges } from "../const.env";
import type { State as WorldState } from "./World";

/** The player's psi, as `Psi` draws it */
export default function PsiControls({ w }: { w: WorldState }) {
  const [tune, setTune] = useState(() => ({ ...w.psi.tune }));
  const apply = (partial: Partial<PsiTune>) => {
    w.psi.setTune(partial);
    setTune({ ...w.psi.tune });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-white/20 pt-3 text-lg">
      <div className="flex items-center gap-3">
        <span className="text-white/50">psi</span>
        <input
          type="color"
          value={tune.color}
          onChange={(e) => apply({ color: e.target.value })}
          className="h-8 w-12 cursor-pointer rounded border-2 border-white/20 bg-transparent"
        />
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-lg border-2 border-white/20 px-3 text-white/60 hover:text-white"
          onClick={() => apply(defaultPsiTune)}
        >
          reset
        </button>
      </div>
      {psiSliders.map(([key, label]) => {
        const [min, max, step] = psiTuneRanges[key];
        return (
          <label key={key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-white/50">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={tune[key]}
              onChange={(e) => apply({ [key]: Number(e.target.value) })}
              className="min-w-0 flex-1 cursor-pointer accent-white"
            />
            <span className="w-16 shrink-0 text-right tabular-nums text-white/60">{tune[key].toFixed(2)}</span>
          </label>
        );
      })}
    </div>
  );
}

const psiSliders = [
  ["reach", "reach"],
  ["speed", "speed"],
  ["gap", "gap"],
  ["fadeSecs", "fade"],
] as const satisfies [keyof typeof psiTuneRanges, string][];
