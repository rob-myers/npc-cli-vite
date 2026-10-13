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
        w.player?.get()?.anim.setBreathing(on);
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
        state.syncHands(w.player?.get());
      },
      syncHands(player) {
        if (state.handsOn !== (player?.key ?? null)) {
          const prev = state.handsOn === null ? undefined : w.n[state.handsOn];
          if (prev?.anim.upperLeft.key === "psi") prev.anim.setUpper(null, left); // the player changed
          // and their breath goes with psi, to whoever has it now
          if (state.on === true) {
            prev?.anim.setBreathing(false);
            player?.anim.setBreathing(true);
          }
          state.handsOn = player?.key ?? null;
        }
        if (player === undefined) return;

        const { upperLeft } = player.anim;
        const shown = upperLeft.target === 1 ? upperLeft.key : null;
        if (state.on === false) {
          if (shown === "psi") player.anim.setUpper(null, left);
        } else if (shown === null) {
          // their left hand alone, and not over another's e.g. reaching to put something down
          player.anim.setUpper("psi", { side: "left", past: true, onHead: true });
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
  /** The player's left hand to their temple whilst psi is on */
  syncHands(player: undefined | Npc): void;
};

const left = { side: "left" } as const;
