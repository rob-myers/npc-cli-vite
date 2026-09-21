import { useStateRef } from "@npc-cli/util";
import { PersonSimpleIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import { WorldContext } from "./world-context";

/** A card over an npc, following them — shown through `w.html`, as a route node's is */
export default function NpcBubbles() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ensure(npcKey) {
        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        w.html.show(bubbleKey(npcKey), tracked, <NpcBubble npcKey={npcKey} grKey={w.e.npcToRoom.get(npcKey)?.grKey} />);
      },
      delete(...npcKeys) {
        w.html.hide(...npcKeys.map(bubbleKey));
      },
      setShown(npcKey, shown) {
        w.html.setShown(bubbleKey(npcKey), shown);
      },
    }),
  );

  w.bubble = state;

  return null;
}

function NpcBubble({ npcKey, grKey }: { npcKey: string; grKey?: string }) {
  return (
    <div className="pointer-events-auto flex w-(--html-width,32rem) flex-col gap-3 rounded-2xl border-4 border-white/40 bg-black/70 px-5 py-4 text-[1.8rem] text-white/90">
      <div className="flex items-center gap-3">
        <PersonSimpleIcon className="size-9 shrink-0 text-white/80" weight="duotone" />
        <span className="truncate font-medium tracking-wide">{npcKey}</span>
      </div>
      {grKey !== undefined && (
        <span className="w-fit rounded-lg border border-white/20 bg-black/40 px-3 py-0.5 whitespace-nowrap">
          <span className="text-white/50">room </span>
          {grKey}
        </span>
      )}
    </div>
  );
}

const bubbleKey = (npcKey: string) => `bubble:${npcKey}`;

export type State = {
  /** Up, redrawn if already */
  ensure(npcKey: string): void;
  delete(...npcKeys: string[]): void;
  setShown(npcKey: string, shown: boolean): void;
};
