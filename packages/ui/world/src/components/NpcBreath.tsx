import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import { createBreathGhost } from "../service/breath-ghost";
import { WorldContext } from "./world-context";

/** The lungs and diaphragm of every npc breathing, in one draw call — see `docs/npc-breath.md` */
export default function NpcBreath() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ghost: createBreathGhost(w.view.objectPick),
      onTick() {
        const { mesh, nowData, nowAttr } = state.ghost;
        let i = 0;
        for (const npcKey in w.n) {
          const npc = w.n[npcKey];
          const { breath } = npc.anim;
          if (!(breath.amount > 0)) continue; // nearly everyone, nearly always
          breath.chest ??= npc.group?.getObjectByName("chest") ?? null;
          if (breath.chest === null) continue;
          // this frame's, which the render has yet to work out
          breath.chest.updateWorldMatrix(true, false);
          mesh.setMatrixAt(i, breath.chest.matrixWorld);
          const shown = breath.amount * breath.amount * (3 - 2 * breath.amount);
          nowData[i * 4] = breath.full;
          nowData[i * 4 + 1] = breath.drive;
          nowData[i * 4 + 2] = breath.glow * shown;
          nowData[i * 4 + 3] = breath.reach;
          i++;
        }
        mesh.count = i;
        mesh.visible = i > 0; // nobody breathing: no draw call at all
        if (i === 0) return; // nor anything sent
        // only the instances in use, not the room for every npc there could be
        for (const [attr, size] of [
          [mesh.instanceMatrix, 16],
          [nowAttr, 4],
        ] as const) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, i * size);
          attr.needsUpdate = true;
        }
      },
    }),
    { reset: { ghost: true } },
  );

  w.breaths = state;

  return <primitive object={state.ghost.mesh} />;
}

export type State = {
  ghost: ReturnType<typeof createBreathGhost>;
  /** One instance per npc breathing, on their chest — after the npcs' own tick has posed them */
  onTick(): void;
};
