import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import { psiKhandhas } from "../const.npc";
import { demoThoughts } from "../service/thoughts";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/** The player's psi: whether it is on, their hand at their temple and their breath shown whilst it is, and the thoughts it reads — see `docs/psi.md` */
export default function Psi() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      on: false,
      handsOn: null,
      readAt: 0,

      setOn(on) {
        state.on = on;
        // their breath shows whilst it is raised
        w.n?.[w.player?.key ?? ""]?.anim.setBreathing(on);
        state.onTick();
        w.r3f?.invalidate();
        w.hud?.update();
      },
      toggle() {
        state.setOn(!state.on);
      },
      read(npcKey) {
        if (state.on === false || npcKey === w.player?.key || w.n?.[npcKey] === undefined) return;
        const { khandha, text } = demoThoughts[state.readAt++ % demoThoughts.length];
        w.speech?.think(npcKey, text, { khandha, color: psiKhandhas[khandha].color });
      },
      onTick() {
        if (w.n === null) return;
        state.syncHands(w.player === undefined ? undefined : w.n[w.player.key]);
      },
      syncHands(player) {
        if (state.handsOn !== (player?.key ?? null)) {
          const prev = state.handsOn === null ? undefined : w.n[state.handsOn];
          if (prev !== undefined && isPsiPose(prev.anim.upperLeft.key)) prev.anim.setUpper(null, left); // the player changed
          // and their breath goes with psi, to whoever has it now
          if (state.on === true) {
            prev?.anim.setBreathing(false);
            player?.anim.setBreathing(true);
          }
          state.handsOn = player?.key ?? null;
        }
        if (player === undefined) return;

        const { nearDist, avoidSecs } = psiConfig;
        const near =
          player.agent?.neis.some(({ dist }) => dist < nearDist ** 2) === true || // `dist` squared
          w.e.npcToDoors[player.key]?.inside != null; // in a doorway
        /** Lain on that arm: its elbow comes in front of them, as for a neighbour */
        const onArm = player.anim.pose === "lie_left";
        const pose = state.on === false ? null : near || onArm ? "psi_avoid" : "psi";
        const { upperLeft } = player.anim;
        const shown = upperLeft.target === 1 ? upperLeft.key : null;
        if (pose === null) {
          if (isPsiPose(shown)) player.anim.setUpper(null, left);
        } else if (pose !== shown && (shown === null || isPsiPose(shown))) {
          // their left hand alone, and not over another's e.g. reaching to put something down
          player.anim.setUpper(pose, {
            side: "left",
            swapSecs: near ? avoidSecs : undefined,
            past: true,
            onHead: true,
          });
        }
      },
    }),
  );

  w.psi = state;

  return null;
}

export type State = {
  on: boolean;
  /** Whose hands we move: the player, as last seen */
  handsOn: null | string;
  /** Which of `demoThoughts` is next */
  readAt: number;
  setOn(on: boolean): void;
  toggle(): void;
  /** Whilst psi is on, reads another npc's next thought: over their head, and into the history */
  read(npcKey: string): void;
  onTick(): void;
  /** The player's left hand to their temple whilst psi is on, elbow tucked (`psi_avoid`) near a neighbour or in a doorway */
  syncHands(player: undefined | Npc): void;
};

const psiConfig = {
  /** Metres within which a crowd neighbour brings the player's elbows forward — inside `collisionQueryRange` */
  nearDist: 0.65,
  /** Seconds the player's elbows take to come forward */
  avoidSecs: 0.3,
} as const;

/** Ours to clear: never another's upper pose e.g. `point` */
const isPsiPose = (key: null | string) => key === "psi" || key === "psi_avoid";
const left = { side: "left" } as const;
