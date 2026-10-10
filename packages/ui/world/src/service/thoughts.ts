import type { KhandhaKey } from "../const.npc";

/** Something an npc thinks, unsaid: psi reads it — see `docs/psi.md` */
export type Thought = { khandha: KhandhaKey; text: string };

/** How a thought is marked wherever it is shown: its khandha, and that one's colour */
export type ThoughtTag = { khandha: KhandhaKey; color: string };

/** What anyone thinks, in turn, until characters have thoughts of their own */
export const demoThoughts: Thought[] = [
  { khandha: "perception", text: "Not one of ours." },
  { khandha: "formations", text: "Lock up once they've gone." },
  { khandha: "sensation", text: "That shoulder again." },
  { khandha: "perception", text: "They keep looking at the door." },
  { khandha: "formations", text: "Say nothing about the manifest." },
  { khandha: "consciousness", text: "Footsteps. Two of them." },
  { khandha: "form", text: "Key's in the left pocket." },
];

export const thoughtConfig = {
  /** Metres per second a wave goes, per unit of `PsiTune.speed` */
  speedOver: 12,
  /** Seconds a thought stays over them */
  shownSecs: 5,
} as const;
