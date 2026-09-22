import { Select } from "@base-ui/react/select";
import { useStateRef } from "@npc-cli/util";
import { CaretDownIcon, PersonSimpleIcon } from "@phosphor-icons/react";
import { useContext, useEffect, useState } from "react";
import type { AnimationClipKey } from "./NPCs";
import type { State as WorldState } from "./World";
import { WorldContext } from "./world-context";

/** A card over an npc, following them — shown through `w.html`, as a route node's is */
export default function NpcBubbles() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ensure(npcKey) {
        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        w.html.show(bubbleKey(npcKey), tracked, <NpcBubble w={w} npcKey={npcKey} />);
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

function NpcBubble({ w, npcKey }: { w: WorldState; npcKey: string }) {
  const [grKey, setGrKey] = useState(() => w.e.npcToRoom.get(npcKey)?.grKey);
  const [pose, setPose] = useState(() => w.n[npcKey]?.anim.pose);

  useEffect(() => {
    // not only theirs e.g. "spawned-many", "nav-updated" — and an unchanged key re-renders nothing
    const sub = w.events.subscribe({ next: () => setGrKey(w.e.npcToRoom.get(npcKey)?.grKey) });
    // the pose changes on its own too e.g. walking, idling
    const id = setInterval(() => setPose(w.n[npcKey]?.anim.pose), posePollMs);
    return () => (sub.unsubscribe(), clearInterval(id));
  }, [w, npcKey]);

  const npc = w.n[npcKey];

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
      {npc !== undefined && (
        <Select.Root
          value={pose}
          onValueChange={(next) => {
            if (next === null || w.n[npcKey] === undefined) return;
            w.n[npcKey].anim.setPose(next);
            setPose(next);
          }}
        >
          <Select.Trigger className="flex min-w-0 items-center gap-2 rounded-lg border-2 border-white/20 bg-black/50 px-3 py-0.5 text-left outline-none cursor-pointer focus:border-white/60">
            <span className="text-white/50 pr-1">anim</span>
            <Select.Value className="min-w-0 flex-1 truncate" />
            <CaretDownIcon className="size-7 shrink-0 text-white/60" />
          </Select.Trigger>
          <Select.Portal container={w.rootEl}>
            <Select.Positioner className="z-70" sideOffset={4} align="start" alignItemWithTrigger={false}>
              <Select.Popup className="max-h-60 overflow-auto rounded border border-slate-700 bg-slate-800 py-1 text-xs text-slate-300 shadow-lg scrollbar-thin">
                {(Object.keys(npc.clips) as AnimationClipKey[]).map((clipKey) => (
                  <Select.Item
                    key={clipKey}
                    value={clipKey}
                    className="px-3 py-1 cursor-pointer data-highlighted:bg-slate-700"
                  >
                    <Select.ItemText>{clipKey}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      )}
    </div>
  );
}

const bubbleKey = (npcKey: string) => `bubble:${npcKey}`;
/** Their pose changes on its own, and nothing announces it */
const posePollMs = 250;

export type State = {
  /** Up, redrawn if already */
  ensure(npcKey: string): void;
  delete(...npcKeys: string[]): void;
  setShown(npcKey: string, shown: boolean): void;
};
