import { useStateRef } from "@npc-cli/util";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
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

  // On HMR, SpeechBubbleApi is a new class reference — refresh existing bubble prototypes.
  const apiRef = React.useRef(SpeechBubbleApi);
  if (import.meta.env.DEV && apiRef.current !== SpeechBubbleApi) {
    apiRef.current = SpeechBubbleApi;
    for (const bubble of Object.values(state.byKey)) {
      const tempBubble = new SpeechBubbleApi(bubble.key, w);
      Object.assign(bubble, { ...tempBubble }, { ...bubble });
      Object.setPrototypeOf(bubble, Object.getPrototypeOf(tempBubble));
    }
  }

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
    b.mountConnector();
    setTimeout(() => {
      b.initializeOffset();
      b.update();
      b.resolveOnMount();
      b.html3d?.onFrame();
    }, 30);
    return () => b.unmountConnector();
  }, []);

  return (
    <Html3d
      ref={b.html3dRef.bind(b)}
      className="pointer-events-none absolute top-0 left-0 [&>div]:flex [&>div]:justify-center"
      baseScale={speechBubbleBaseScale}
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      visible
    >
      <div
        ref={(el) => { b.bubbleDiv = el; }}
        className="relative pointer-events-auto cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.stopPropagation();
          b.onDragStart(e.nativeEvent);
        }}
        onPointerMove={(e) => {
          if (!b.isDragging) return;
          e.stopPropagation();
          b.onDragMove(e.nativeEvent);
        }}
        onPointerUp={(e) => {
          if (!b.isDragging) return;
          e.stopPropagation();
          b.onDragEnd(e.nativeEvent);
        }}
        onWheel={b.forwardWheelEvents.bind(b)}
      >
        <div className="text-[#ff9] p-4 text-[2.2rem] rounded-2xl bg-black/30 border-2 border-white/30 leading-[1.2] text-center select-none">
          {b.words}
        </div>
        <div
          className="absolute -bottom-2 -right-2 size-5 flex items-center justify-center rounded-full bg-black/60 text-white/80 cursor-se-resize hover:bg-black/80"
          onPointerDown={(e) => {
            e.stopPropagation();
            b.onResizeStart(e.nativeEvent);
          }}
          onPointerMove={(e) => {
            if (!b.isResizing) return;
            e.stopPropagation();
            b.onResizeMove(e.nativeEvent);
          }}
          onPointerUp={(e) => {
            if (!b.isResizing) return;
            e.stopPropagation();
            b.onResizeEnd(e.nativeEvent);
          }}
        >
          <ArrowsOutSimpleIcon className="size-3" />
        </div>
      </div>
    </Html3d>
  );
}
const speechBubbleBaseScale = 4;

const MemoizedSpeechBubble = React.memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
