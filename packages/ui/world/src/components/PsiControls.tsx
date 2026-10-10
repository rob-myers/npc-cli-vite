import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import * as THREE from "three/webgpu";
import { defaultPsiTune, type PsiTune, psiTuneRanges } from "../const.npc";
import type { State as WorldState } from "./World";

/** The player's psi, as `Psi` draws it: folded away until asked for */
export default function PsiControls({ w }: { w: WorldState }) {
  const [tune, setTune] = useState(() => ({ ...w.psi.tune }));
  const [open, setOpen] = useState(() => tryLocalStorageGetParsed<boolean>(openStorageKey) === true);
  const Caret = open === true ? CaretDownIcon : CaretRightIcon;
  const apply = (partial: Partial<PsiTune>) => {
    w.psi.setTune(partial);
    setTune({ ...w.psi.tune });
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
          psi waves
        </button>
        {open === true && (
          <button
            type="button"
            className="cursor-pointer rounded-lg border-2 border-white/20 px-3 text-white/60 hover:text-white"
            onClick={() => apply(defaultPsiTune)}
          >
            reset
          </button>
        )}
      </div>
      {open === true && (
        <>
          {sliderKeys.map((key) => (
            <Slider
              key={key}
              label={key}
              range={psiTuneRanges[key]}
              value={tune[key]}
              onChange={(value) => apply({ [key]: value })}
            >
              {tune[key].toFixed(2)}
            </Slider>
          ))}
          {/* not `<input type="color">`, whose native picker the card's zoom blows up */}
          <Slider
            label="hue"
            range={[0, 359, 1]}
            value={hueOf(tune.color)}
            onChange={(hue) => apply({ color: colorOfHue(hue) })}
            track={hueTrack}
          >
            <span className="h-4 w-8 rounded" style={{ background: tune.color }} />
          </Slider>
        </>
      )}
    </div>
  );
}

/** A labelled range, and beside it whatever shows its value */
function Slider(props: {
  label: string;
  /** `[min, max, step]` */
  range: readonly [number, number, number];
  value: number;
  onChange(value: number): void;
  /** A css background for the track, in place of the plain one */
  track?: string;
  children: ReactNode;
}) {
  const [min, max, step] = props.range;
  return (
    <label className="flex items-center gap-3">
      <span className="w-24 shrink-0 whitespace-nowrap text-white/50">{props.label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className={
          props.track === undefined
            ? "min-w-0 flex-1 cursor-pointer accent-white"
            : "h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full accent-white"
        }
        style={props.track === undefined ? undefined : { background: props.track }}
      />
      <span className="flex w-16 shrink-0 justify-end tabular-nums text-white/60">{props.children}</span>
    </label>
  );
}

const openStorageKey = "psi-controls-open";

const sliderKeys = Object.keys(psiTuneRanges) as (keyof typeof psiTuneRanges)[];

/** Saturation and lightness of the default, so every hue is as pale a glow */
const { s, l } = new THREE.Color(defaultPsiTune.color).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const hueOf = (color: string) =>
  Math.round(new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h * 360) % 360;
const colorOfHue = (hue: number) =>
  `#${new THREE.Color().setHSL(hue / 360, s, l, THREE.SRGBColorSpace).getHexString()}`;
const hueTrack = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => colorOfHue(hue % 360)).join(", ")})`;
