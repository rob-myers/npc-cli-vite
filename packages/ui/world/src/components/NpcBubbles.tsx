import { useStateRef } from "@npc-cli/util";
import React from "react";
import { Html3d } from "../components/Html3d";
import { SpeechBubbleApi } from "./speech-bubble-api";
import { WorldContext } from "./world-context";

export default function NpcBubbles() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: {},
      lastFront: "",
      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.byKey[npcKey]?.dispose();
          delete state.byKey[npcKey];
        }
        state.update();
      },
      ensure(npcKey) {
        let bubble = state.byKey[npcKey];
        if (!bubble) {
          bubble = state.byKey[npcKey] = new SpeechBubbleApi(npcKey, w);
          const npc = w.npc.get(npcKey);
          bubble.setTracked({ object: npc.skinnedMesh, offset: npc.bubbleOffset });
          state.update();
        }
        return bubble;
      },
      async ensureMounted(npcKey) {
        const bubble = state.ensure(npcKey);
        if (!bubble.isMounted()) {
          await new Promise<void>((resolve) => {
            bubble.resolveOnMount = resolve;
            bubble.epochMs = Date.now();
            state.update();
          });
        }
        return bubble;
      },
      toFront(npcKey) {
        const prevBubbleDiv = state.byKey[state.lastFront]?.html3d.rootDiv;
        if (prevBubbleDiv) prevBubbleDiv.style.zIndex = "";
        const bubbleDiv = state.byKey[npcKey].html3d.rootDiv;
        bubbleDiv.style.zIndex = `20`;
        state.lastFront = npcKey;
      },
    }),
  );

  w.bubble = state;
  w.b = state.byKey;

  React.useMemo(() => {
    if (import.meta.env.DEV) {
      for (const bubble of Object.values(state.byKey)) {
        const tempBubble = new SpeechBubbleApi(bubble.key, w);
        Object.assign(bubble, { ...tempBubble }, { ...bubble });
        Object.setPrototypeOf(bubble, Object.getPrototypeOf(tempBubble));
      }
    }
  }, []);

  return Object.values(state.byKey).map((bubble) => (
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} />
  ));
}

export type State = {
  byKey: { [npcKey: string]: SpeechBubbleApi };
  lastFront: string;
  delete(...npcKeys: string[]): void;
  ensure(npcKey: string): SpeechBubbleApi;
  ensureMounted(npcKey: string): Promise<SpeechBubbleApi>;
  toFront(npcKey: string): void;
};

interface SpeechBubbleProps {
  bubble: SpeechBubbleApi;
}

function NpcBubble({ bubble: b }: SpeechBubbleProps) {
  React.useEffect(() => {
    setTimeout(() => {
      b.update();
      b.resolveOnMount();
    }, 30);
  }, []);

  return (
    <Html3d
      ref={b.html3dRef.bind(b)}
      className="absolute -top-4 left-0 pointer-events-none [&>div]:flex [&>div]:justify-center"
      baseScale={speechBubbleBaseScale}
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      // docked
      visible
    >
      <div className="text-[#ff9] p-4 rounded-2xl bg-black/30 leading-[1.2]">Hello, world!</div>

      {/* 🚧 mount ui */}
    </Html3d>
  );
}

const MemoizedSpeechBubble = React.memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);

const speechBubbleBaseScale = 4;
