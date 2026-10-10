import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import { mrt, output, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { defaultPsiTune, type PsiTune, psiKhandhas } from "../const.npc";
import { eased } from "../service/fade";
import {
  advanceInfluence,
  chooseInfluence,
  createInfluence,
  type Influence,
  influenceTarget,
} from "../service/psi-influence";
import { createPsiResources, glowBlend, type PsiResources, psiNodes } from "../service/psi-shader";
import { getWorldStore } from "../service/storage";
import { demoThoughts, type Thought, thoughtConfig } from "../service/thoughts";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/**
 * The player's psi: whom it is on, their hand at their temple, and the waves between the two. The
 * player's intention goes out to the target, and the target's thought comes back. See
 * `service/psi-influence` for the fades, and `docs/psi.md`.
 */
export default function Psi() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createPsiResources(),
      tune: { ...defaultPsiTune, ...getWorldStore(w.key).read().psiTune },
      influence: createInfluence(),
      handsOn: null,
      targetRoom: { at: null, also: null },
      tickedMs: performance.now(),
      wave: { stage: "rest", asked: false, sent: 0, out: 0, thought: null },
      readAt: 0,

      choose(target, { quiet = false } = {}) {
        if (target !== state.getTarget()) {
          // onto another: what was on its way is cut off, and the next is laid afresh
          state.wave.stage = "rest";
          state.come.value = -1;
        }
        chooseInfluence(state.influence, target, w.player?.key);
        // each time another is chosen, the same again or not, the player's intention goes to them
        if (quiet === false && target !== null && target !== w.player?.key) state.wave.asked = true;
        state.syncTargetRoom();
        state.upload();
        w.r3f?.invalidate();
        w.hud?.update();
        return state.getTarget();
      },
      toggle() {
        if (state.getTarget() !== null) return state.choose(null);
        const { lastChosen } = state.influence;
        // back on whom it was on, but nothing is sent them until they are pressed
        const target = lastChosen !== null && lastChosen in w.n ? lastChosen : (w.player?.key ?? null);
        return state.choose(target, { quiet: true });
      },
      getTarget() {
        return influenceTarget(state.influence, w.player?.key);
      },
      onTick() {
        if (w.n === null) return; // <NPCs> mounts after us
        const now = performance.now();
        const secs = Math.min((now - state.tickedMs) / 1000, 0.1);
        state.tickedMs = now;

        // held whilst paused: a choice made then shows once they play on
        const played = w.disabled === true ? 0 : secs;
        const steps = { in: played / psiConfig.fadeInSecs, out: played / psiConfig.fadeOutSecs };
        advanceInfluence(state.influence, steps, w.player?.key, (npcKey) => npcKey in w.n);
        state.exchange(played);
        state.syncTargetRoom();
        state.upload();
      },
      exchange(secs) {
        const { wave } = state;
        const { current } = state.influence;
        const player = w.player === undefined ? undefined : w.n[w.player.key];
        const target = current === null ? undefined : w.n[current.npcKey];
        if (player === undefined || target === undefined) {
          // nobody to send to, yet or any longer: what was on its way is gone
          wave.stage = "rest";
          if (state.getTarget() === null) wave.asked = false; // psi is off
          state.come.value = -1;
          return;
        }
        const apart = Math.hypot(target.position.x - player.position.x, target.position.z - player.position.z);
        const speed = state.tune.speed * thoughtConfig.speedOver;

        if (wave.stage === "rest") {
          if (wave.asked === false) return;
          // the player's intention sets out: one asked for meanwhile waits for this to be answered
          wave.asked = false;
          wave.stage = "intent";
          wave.sent = 0;
        }
        if (wave.stage === "intent") {
          wave.sent += speed * secs;
          state.come.value = wave.sent;
          state.back.value = 0;
          if (wave.sent < apart) return;
          // there: they answer with a thought, which sets out for the player
          wave.stage = "thought";
          wave.out = 0;
          wave.thought = demoThoughts[state.readAt++ % demoThoughts.length];
          state.back.value = 1;
          state.syncTune(); // its colour
        }
        wave.out += speed * secs;
        state.come.value = wave.out;
        if (wave.out < apart) return;
        // it reaches the player. At rest BEFORE it is read: showing a bubble ticks the world again, and so us
        wave.stage = "rest";
        state.come.value = -1;
        const { khandha, text } = wave.thought as Thought;
        w.speech?.think(target.key, text, { khandha, color: psiKhandhas[khandha].color });
      },
      syncTargetRoom() {
        if (w.disabled === true) return; // nothing changes whilst paused
        const target = state.getTarget();
        const at = (target === null ? undefined : w.npc?.npcToRoom.get(target)) ?? null;
        if (at?.grKey === state.targetRoom.at?.grKey) return;
        state.targetRoom = { at, also: null };
        w.e?.syncFadeRooms();
      },
      upload() {
        if (w.n === null) return;
        const player = w.player === undefined ? undefined : w.n[w.player.key];
        state.syncHands(player);
        const { self, current } = state.influence;
        const target = current === null ? undefined : w.n[current.npcKey];
        // nothing to draw with nobody to send to
        state.mesh.visible = false;
        if (player === undefined || target === undefined || current === null) return;
        // nor anything on its way, nor room between them for it to be seen in
        const apart = Math.hypot(target.position.x - player.position.x, target.position.z - player.position.z);
        state.mesh.visible = state.wave.stage !== "rest" && apart >= psiConfig.minApart;
        state.playerAt.value.set(player.position.x, player.position.z, eased(self.presence), headBaseOf(player));
        state.otherAt.value.set(target.position.x, target.position.z, eased(current.presence), headBaseOf(target));
      },
      syncHands(player) {
        if (state.handsOn !== (player?.key ?? null)) {
          const prev = state.handsOn === null ? undefined : w.n[state.handsOn];
          if (prev !== undefined && isPsiPose(prev.anim.upperLeft.key)) prev.anim.setUpper(null, left); // the player changed
          state.handsOn = player?.key ?? null;
        }
        if (player === undefined) return;

        const { nearDist, avoidSecs } = psiConfig;
        const near =
          player.agent?.neis.some(({ dist }) => dist < nearDist ** 2) === true || // `dist` squared
          w.e.npcToDoors[player.key]?.inside != null; // in a doorway
        const pose = state.influence.self.target === 0 ? null : near ? "psi_avoid" : "psi";
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
      setTune(partial) {
        Object.assign(state.tune, partial);
        getWorldStore(w.key).patch({ psiTune: { ...state.tune } });
        state.syncTune();
        w.r3f?.invalidate();
      },
      syncOutlineMask() {
        const { material } = state.mesh;
        material.mrtNode = w.view.npcMaskMrt === null ? null : captionMrt;
        material.needsUpdate = true;
      },
      syncTune() {
        state.tune = { ...defaultPsiTune, ...state.tune }; // a field added since, e.g. over hmr
        const { width, packet, amp, line, opacity, color } = state.tune;
        state.width.value = width;
        state.packet.value = packet;
        state.amp.value = amp;
        state.line.value = line;
        state.opacity.value = opacity;
        state.color.value.set(color);
        state.thoughtColor.value.set(
          state.wave.thought === null ? color : psiKhandhas[state.wave.thought.khandha].color,
        );
        const theme = w.getTheme();
        // light cannot be added to a pale deck, so there the lines are laid over it, in a deeper ink
        const pale = theme.floor.deck === "light";
        if (pale) {
          // as seen, not as worked in: linear lightness would come out far paler
          const { h } = state.color.value.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
          state.color.value.setHSL(h, 1, psiConfig.paleLightness, THREE.SRGBColorSpace);
          const read = state.thoughtColor.value.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
          state.thoughtColor.value.setHSL(read.h, 1, psiConfig.paleLightness, THREE.SRGBColorSpace);
          state.coreColor.value.setHSL(h, 1, psiConfig.paleCoreLightness, THREE.SRGBColorSpace);
        }
        // there the strength is fixed, to firm the line up, and `opacity` fades it once drawn
        state.gain.value = pale ? psiConfig.paleFirm / opacity : theme.npcs.fxStrength;
        state.fade.value = pale ? Math.min(1, Math.sqrt(opacity) * theme.npcs.fxStrength * psiConfig.paleFade) : 1;
        state.whiten.value = pale ? 0 : 1;
        state.casing.value = pale ? psiConfig.paleCasing : 0;
        state.width.value = width * (pale ? psiConfig.paleWidth : 1);
        const blending = pale ? THREE.NormalBlending : glowBlend.blending;
        const { material } = state.mesh;
        if (material.blending !== blending) {
          material.blending = blending;
          material.needsUpdate = true;
        }
        w.r3f?.invalidate();
      },
    }),
    // over hmr the meshes and their materials are made afresh, and so is the exchange
    {
      reset: {
        geo: true,
        mesh: true,
        wave: true,
      },
    },
  );

  w.psi = state;

  useEffect(() => state.syncTune(), []);

  useEffect(() => {
    Object.assign(state.mesh.material, psiNodes(state, w.view), { needsUpdate: true });
    state.syncOutlineMask();
    state.upload();
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.mesh} />;
}

export type State = PsiResources & {
  /** What the player's bubble adjusts, persisted — see `PsiControls` */
  tune: PsiTune;
  influence: Influence;
  /** Whose hands we move: the player, as last seen */
  handsOn: null | string;
  /** The target's room, shown by the fade, and `also` the far side of a doorway they stand in */
  targetRoom: { at: null | Geomorph.GmRoomId; also: null | Geomorph.GmRoomId };
  tickedMs: number;
  /**
   * The exchange: `asked` for and not yet begun, then the player's intention `sent` so many metres,
   * then the target's `thought` so far `out` towards the player
   */
  wave: {
    stage: "rest" | "intent" | "thought";
    asked: boolean;
    sent: number;
    out: number;
    thought: null | Thought;
  };
  /** Which of `demoThoughts` is next */
  readAt: number;

  /** Target `npcKey` — the player themself for psi on nobody else, `null` for off. Takes hold once playing, if paused. Another is sent the player's intention, unless `quiet` */
  choose(target: null | string, opts?: { quiet?: boolean }): null | string;
  /** Off, else back on to the last target, or the player: sending nothing */
  toggle(): null | string;
  /** The target, or the one taken up once a fade-out ends */
  getTarget(): null | string;
  onTick(): void;
  /** The player's intention goes to whom psi is on each time they are chosen: their thought comes back, and is read. `secs` of world time on */
  exchange(secs: number): void;
  /** Re-syncs the rooms shown once the target's room changes — theirs is shown too */
  syncTargetRoom(): void;
  /** Where the two of them are, onto the gpu: and whether to draw at all */
  upload(): void;
  /** The player's left hand to their temple whilst psi is on, elbow tucked (`psi_avoid`) near a neighbour or in a doorway */
  syncHands(player: undefined | Npc): void;
  setTune(partial: Partial<PsiTune>): void;
  /** `tune` into the uniforms */
  syncTune(): void;
  /** Keeps the waves' `mrtNode` in step with `w.view.npcMaskMrt` — see `NPCs.syncOutlineMask` */
  syncOutlineMask(): void;
};

/** A wave marks itself a caption in `npcMask.g`, so an npc's border is not drawn over it — see `npc-outline` */
const captionMrt = mrt({ npcMask: vec4(0, 1, 0, output.a) });

const psiConfig = {
  /** Metres apart below which no wave is drawn: the exchange still happens */
  minApart: 1,
  /** Seconds psi takes to come onto someone, and to leave them */
  fadeInSecs: 0.8,
  fadeOutSecs: 0.3,
  /** Metres within which a crowd neighbour brings the player's elbows forward — inside `collisionQueryRange` */
  nearDist: 0.65,
  /** Seconds the player's elbows take to come forward */
  avoidSecs: 0.3,
  /** Over a pale deck: the lightness the tuned hue is drawn at, fully saturated — its casing's ink */
  paleLightness: 0.36,
  /** Over a pale deck: the lightness of a line's core */
  paleCoreLightness: 0.8,
  /** Over a pale deck: the strength every line is drawn at, past full so its edges are firm */
  paleFirm: 4,
  /** Over a pale deck: of `fxStrength`, by the root of the opacity — `0.25` is opaque at `5` */
  paleFade: 0.4,
  /** Over a pale deck: how much wider, having no glow to carry it */
  paleWidth: 1.5,
  /** Over a pale deck: pixels of dark edging either side of a line */
  paleCasing: 1.5,
} as const;

/** The height of the foot of an npc's head, which a wave of theirs stands on */
const headBaseOf = (npc: Npc) => npc.position.y + npc.anim.headY;
/** Ours to clear: never another's upper pose e.g. `point` */
const isPsiPose = (key: null | string) => key === "psi" || key === "psi_avoid";
const left = { side: "left" } as const;
