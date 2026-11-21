import { uniform } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { FadeRooms } from "./fade-rooms";

/** What the phaser meshes read of the World's view */
export type PhaserView = {
  objectPick: THREE.UniformNode<"float", number>;
  foldNode: THREE.UniformNode<"float", number>;
  fadeRoomsFx: FadeRooms;
  litNpcsEnabled: THREE.UniformNode<"float", number>;
};

/** The uniforms the guns and beams share */
export function createPhaserUniforms() {
  return {
    phase: uniform(0),
    /** From `theme.npcs.fxStrength` */
    gain: uniform(1),
    /** The beam's alpha on the way: more over a pale deck — see `Phasers.syncTheme` */
    faint: uniform(phaserLook.faint as number),
  };
}

export type PhaserUniforms = ReturnType<typeof createPhaserUniforms>;

/** Seen as an npc in that room slot is, or lit */
export const seenBy =
  ({ fadeRoomsFx, litNpcsEnabled }: PhaserView) =>
  (slot: THREE.Node<"float">, lit: THREE.Node<"float">) =>
    fadeRoomsFx.getVisiblity(slot).max(lit.mul(litNpcsEnabled));

export const phaserLook = {
  color: "#ff8a5c",
  /** Over a pale deck: the lightness `color`'s hue is drawn at, fully saturated */
  paleLightness: 0.4,
  /** The beam's alpha on the way, over a dark deck and a pale one */
  faint: 0.45,
  paleFaint: 0.6,
} as const;
