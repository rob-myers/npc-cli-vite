import { useState } from "react";
import * as THREE from "three/webgpu";
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
      {/* not `<input type="color">`, whose native picker the card's zoom blows up */}
      <label className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-white/50">hue</span>
        <input
          type="range"
          min={0}
          max={359}
          value={hueOf(tune.color)}
          onChange={(e) => apply({ color: colorOfHue(Number(e.target.value)) })}
          className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full accent-white"
          style={{ background: hueTrack }}
        />
        <span className="flex w-16 shrink-0 justify-end">
          <span className="h-4 w-8 rounded" style={{ background: tune.color }} />
        </span>
      </label>
    </div>
  );
}

/** Saturation and lightness of the default, so every hue is as pale a glow */
const { s, l } = new THREE.Color(defaultPsiTune.color).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const hueOf = (color: string) =>
  Math.round(new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h * 360) % 360;
const colorOfHue = (hue: number) =>
  `#${new THREE.Color().setHSL(hue / 360, s, l, THREE.SRGBColorSpace).getHexString()}`;
const hueTrack = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => colorOfHue(hue % 360)).join(", ")})`;

const psiSliders = [
  ["reach", "reach"],
  ["speed", "speed"],
  ["gap", "gap"],
  ["fadeSecs", "fade"],
] as const satisfies [keyof typeof psiTuneRanges, string][];
