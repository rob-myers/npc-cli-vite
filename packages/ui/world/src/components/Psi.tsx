import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { defaultPsiTune, type PsiTune, psiMaxReach } from "../const.npc";
import { eased } from "../service/fade";
import {
  advanceInfluence,
  chooseInfluence,
  createInfluence,
  type Influence,
  influenceTarget,
  type NpcFade,
} from "../service/psi-influence";
import { createPsiResources, type PsiResources, psiNodes } from "../service/psi-shader";
import { getWorldStore } from "../service/storage";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/**
 * Contour lines of a field between the player and whom they target, a quad apiece — their own
 * rings alone should they target themself. See `service/psi-influence` for the fades.
 */
export default function Psi() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createPsiResources(),
      tune: { ...defaultPsiTune, ...getWorldStore(w.key).read().psiTune },
      influence: createInfluence(),
      handsOn: null,
      ownAim: null,
      targetRoom: { at: null, also: null },
      flowAt: 0,
      tickedMs: performance.now(),

      choose(target) {
        chooseInfluence(state.influence, target, w.player?.key, w.disabled);
        state.syncTargetRoom();
        state.upload();
        w.r3f?.invalidate();
        return state.getTarget();
      },
      toggle() {
        if (state.getTarget() !== null) return state.choose(null);
        const { lastChosen } = state.influence;
        return state.choose(lastChosen !== null && lastChosen in w.n ? lastChosen : (w.player?.key ?? null));
      },
      getTarget() {
        return influenceTarget(state.influence, w.player?.key);
      },
      onTick() {
        if (w.n === null) return; // <NPCs> mounts after us
        // world time, so a pause holds the rings still — and a phase, so a new speed does not jump them
        const worldSecs = w.timer.getElapsedTime();
        state.flowPhase.value += Math.max(0, worldSecs - state.flowAt) * state.tune.speed;
        state.flowAt = worldSecs;
        const now = performance.now();
        const secs = Math.min((now - state.tickedMs) / 1000, 0.1);
        state.tickedMs = now;

        advanceInfluence(state.influence, secs / state.tune.fadeSecs, w.player?.key, (npcKey) => npcKey in w.n);
        state.syncTargetRoom();
        state.upload();
      },
      syncTargetRoom() {
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
        const { self, current, leaving } = state.influence;
        /** Never the player, should they have become one of them */
        const others = [leaving, current].filter((x): x is NpcFade => x !== null && x.npcKey !== player?.key);
        const off = player === undefined || (self.presence === 0 && others.length === 0);
        state.mesh.visible = off === false; // else no draw call
        if (player === undefined || state.mesh.visible === false) return; // nor any upload

        // as `player-light` has it
        const lookAngle = -player.rotation.y - Math.PI / 2;
        state.facing.value.set(Math.cos(lookAngle), Math.sin(lookAngle));

        const slots = [{ npc: player, presence: self.presence }].concat(
          others.map((x) => ({ npc: w.n[x.npcKey], presence: x.presence })),
        );
        slots.forEach(({ npc, presence }, i) => {
          state.npcData[i * 4] = npc.position.x;
          state.npcData[i * 4 + 1] = npc.position.z;
          state.npcData[i * 4 + 2] = eased(presence);
          state.npcData[i * 4 + 3] = npc.position.y + npc.anim.headY + psiConfig.headAbove; // their peak
        });
        if (slots.length === 1) {
          // a far stand-in, weightless there: alone, the field's loop over the others draws only the first ring
          state.npcData.set([player.position.x + psiConfig.loneFar, player.position.z, 0, 0], 4);
        }
        state.slotCount.value = Math.max(2, slots.length); // drawn by `instanceCount`, which omits the stand-in
        state.geo.instanceCount = slots.length;
        state.npcTex.needsUpdate = true;
      },
      syncHands(player) {
        if (state.handsOn !== (player?.key ?? null)) {
          const prev = state.handsOn === null ? undefined : w.n[state.handsOn];
          if (prev !== undefined && isPsiPose(prev.anim.upper.key)) prev.anim.setUpper(null); // the player changed
          if (prev !== undefined && prev.anim.face.aim === state.ownAim) prev.anim.face.aim = null;
          state.ownAim = null;
          state.handsOn = player?.key ?? null;
        }
        if (player === undefined) return;

        const { nearDist, avoidSecs } = psiConfig;
        const { self, current } = state.influence;
        /** Another, whom alone they aim at */
        const influencing = current !== null && current.npcKey !== player.key;
        const near =
          player.agent?.neis.some(({ dist }) => dist < nearDist ** 2) === true || // `dist` squared
          w.e.npcToDoors[player.key]?.inside != null; // in a doorway
        const pose = self.target === 0 ? null : near ? "psi_avoid" : "psi";
        const { upper } = player.anim;
        const shown = upper.target === 1 ? upper.key : null;
        if (pose === null) {
          if (isPsiPose(shown)) player.anim.setUpper(null);
        } else if (pose !== shown && (shown === null || isPsiPose(shown))) {
          player.anim.setUpper(pose, { swapSecs: near ? avoidSecs : undefined }); // not over another's e.g. `point`
        }

        // the aim, at whom they influence, so a move strafes — only ours, as a drawn sword's is
        const { face } = player.anim;
        if (face.aim === null || face.aim === state.ownAim) {
          const target = influencing ? w.n[current.npcKey] : undefined;
          face.aim = state.ownAim = target === undefined ? null : { at: target.point, rate: 1, untilRest: false };
        }
      },
      syncGms() {
        w.gms.forEach((gm, gmId) => {
          const { a, b, c, d, e, f } = gm.inverseMatrix;
          const { x, y, width, height } = gm.bounds;
          state.gmValues[gmId * 3].set(a, b, c, d);
          state.gmValues[gmId * 3 + 1].set(e, f, x, y);
          state.gmValues[gmId * 3 + 2].set(width, height, 0, 0);
        });
        state.gmCount.value = w.gms.length;
      },
      setTune(partial) {
        Object.assign(state.tune, partial);
        getWorldStore(w.key).patch({ psiTune: { ...state.tune } });
        state.syncTune();
        w.r3f?.invalidate();
      },
      syncTune() {
        state.tune = { ...defaultPsiTune, ...state.tune }; // a field added since, e.g. over hmr
        const { reach, gap, width, opacity, color, tint } = state.tune;
        state.reach.value = Math.min(reach, psiMaxReach);
        state.gap.value = gap;
        state.width.value = width;
        state.opacity.value = opacity;
        state.color.value.set(color);
        const theme = w.getTheme();
        // light cannot be added to a pale deck, so there the lines are laid over it, in a deeper ink
        const pale = theme.floor.deck === "light";
        if (pale) {
          // as seen, not as worked in: linear lightness would come out far paler
          const { h } = state.color.value.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
          state.color.value.setHSL(h, 1, psiConfig.paleLightness, THREE.SRGBColorSpace);
          const coreLightness = 1 - tint * (1 - psiConfig.paleCoreLightness);
          state.coreColor.value.setHSL(h, 1, coreLightness, THREE.SRGBColorSpace);
        } else {
          state.color.value.lerp(white, 1 - tint);
        }
        // there the strength is fixed, to firm the line up, and `opacity` fades it once drawn
        state.gain.value = pale ? psiConfig.paleFirm / opacity : theme.npcs.fxStrength;
        state.fade.value = pale ? Math.min(1, Math.sqrt(opacity) * theme.npcs.fxStrength * psiConfig.paleFade) : 1;
        state.whiten.value = pale ? 0 : 1;
        state.casing.value = pale ? psiConfig.paleCasing : 0;
        state.width.value = width * (pale ? psiConfig.paleWidth : 1);
        const blending = pale ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (state.mat.blending !== blending) {
          state.mat.blending = blending;
          state.mat.needsUpdate = true;
        }
        w.r3f?.invalidate();
      },
    }),
    // a new `psiMaxReach` or `cell` needs a new geometry, and the mesh and material go with it
    { reset: { geo: true, mat: true, mesh: true } },
  );

  w.psi = state;

  useEffect(() => state.syncGms(), [w.hash]);
  useEffect(() => state.syncTune(), []);

  useEffect(() => {
    const { vertexNode, colorNode } = psiNodes(state, w.view);
    state.mat.vertexNode = vertexNode;
    state.mat.colorNode = colorNode;
    state.mat.needsUpdate = true;
    state.upload(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.mesh} />;
}

export type State = PsiResources & {
  /** What the player's bubble adjusts, persisted — see `PsiControls` */
  tune: PsiTune;
  influence: Influence;
  /** Whose hands we move: the player, as last seen */
  handsOn: null | string;
  /** The aim we gave them, so another's is neither replaced nor cleared */
  ownAim: Npc["anim"]["face"]["aim"];
  /** The target's room, shown by the fade, and `also` the far side of a doorway they stand in */
  targetRoom: { at: null | Geomorph.GmRoomId; also: null | Geomorph.GmRoomId };
  /** World seconds `flowPhase` was last advanced at */
  flowAt: number;
  tickedMs: number;

  /** Target `npcKey` — the player themself for their rings alone, `null` for off. At once whilst paused */
  choose(target: null | string): null | string;
  /** Off, else back on to the last target, or the player */
  toggle(): null | string;
  /** The target, or the one taken up once a fade-out ends */
  getTarget(): null | string;
  onTick(): void;
  /** Re-syncs the rooms shown once the target's room changes — theirs is shown too */
  syncTargetRoom(): void;
  /** The slots onto the gpu, and whether to draw them at all */
  upload(): void;
  /** The player's hands to their temples whilst psi is on, elbows forward (`psi_avoid`) near a neighbour or in a doorway */
  syncHands(player: undefined | Npc): void;
  /** Each geomorph's inverse transform and local bounds, for the shader to find a pixel's room */
  syncGms(): void;
  setTune(partial: Partial<PsiTune>): void;
  /** `tune` into the uniforms */
  syncTune(): void;
};

const psiConfig = {
  /** Metres an npc's peak sits above their head bone's pivot: standing, that is the tuned `1.3` */
  headAbove: 0.24,
  /** Metres within which a crowd neighbour brings the player's elbows forward — inside `collisionQueryRange` */
  nearDist: 0.65,
  /** Seconds the player's elbows take to come forward */
  avoidSecs: 0.3,
  /** Metres off the player the stand-in for no one sits, far past any `reach` */
  loneFar: 1e4,
  /** Over a pale deck: the lightness the tuned hue is drawn at, fully saturated — its casing's ink */
  paleLightness: 0.36,
  /** Over a pale deck: the lightness of a line's core at full `tint`, white at none */
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

const white = new THREE.Color("#fff");

/** Ours to clear: never another's upper pose e.g. `point` */
const isPsiPose = (key: null | string) => key === "psi" || key === "psi_avoid";
