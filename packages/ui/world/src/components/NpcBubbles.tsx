import { cn, useStateRef } from "@npc-cli/util";
import { ArrowDownRightIcon } from "@phosphor-icons/react";
import React from "react";
import { Html3d } from "../components/Html3d";
import { SpeechBubbleApi } from "./speech-bubble-api";
import { WorldContext } from "./world-context";

export default function NpcBubbles() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: {},
      isTopDown: false,
      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.byKey[npcKey]?.dispose();
          delete state.byKey[npcKey];
          const npc = w.n[npcKey];
          if (npc) npc.labelMaterial.visible = true;
        }
        w.view.forceUpdate();
      },
      ensure(npcKey) {
        const extant = state.byKey[npcKey];
        if (extant) return extant;
        const npc = w.npc.get(npcKey);
        const bubble = (state.byKey[npcKey] = new SpeechBubbleApi(npcKey, w));
        bubble.setTracked({ object: npc.skinnedMesh, offset: npc.bubbleOffset });
        npc.labelMaterial.visible = false;
        w.view.forceUpdate();
        return bubble;
      },
      onChangeTopDown(topDown: boolean) {
        state.isTopDown = topDown;
        w.view.forceUpdate();
      },
      setShownIfExists(npcKey: string, shown: boolean) {
        const bubbleDiv = this.byKey[npcKey]?.html3d.rootDiv;
        if (!bubbleDiv) return false;
        bubbleDiv.style.opacity = shown ? "" : "0";
        return true;
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
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} isTopDown={state.isTopDown} />
  ));
}

export type State = {
  byKey: { [npcKey: string]: SpeechBubbleApi };
  isTopDown: boolean;
  delete(...npcKeys: string[]): void;
  ensure(npcKey: string): SpeechBubbleApi;
  onChangeTopDown(topDown: boolean): void;
  setShownIfExists(npcKey: string, shown: boolean): boolean;
};

interface SpeechBubbleProps {
  bubble: SpeechBubbleApi;
  isTopDown: boolean;
}

function NpcBubble({ bubble: b, isTopDown }: SpeechBubbleProps) {
  React.useEffect(() => {
    setTimeout(() => {
      b.initializeOffset();
      b.update();
      b.resolveOnMount();
      b.html3d?.onFrame();
    }, 30);
  }, []);

  return (
    <Html3d
      ref={b.html3dRef.bind(b)}
      className="pointer-events-none absolute top-0 left-0"
      baseScale={speechBubbleBaseScale}
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      visible
    >
      <div
        ref={(el) => {
          b.bubbleDiv = el;
        }}
        className={cn(
          "transform-[translate(-50%)] pointer-events-auto overflow-hidden",
          // "transition-[width,height,border-radius] duration-300",
          isTopDown
            ? "mt-12 max-w-24 max-h-18 rounded-full flex items-center justify-center bg-black/30"
            : "relative flex flex-col w-[512px] h-[256px] rounded-none cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={b.onPointerDown}
        onPointerMove={b.onPointerMove}
        onPointerUp={b.onPointerUp}
        onWheel={b.onWheel}
      >
        {isTopDown ? (
          <div className="text-[2rem] text-white/80">...</div>
        ) : (
          <>
            <div className="text-[2.5rem]">{b.key}</div>

            <div className="flex flex-1 overflow-hidden text-[#ff9] p-4 text-[3rem] rounded-2xl bg-black/30 border-4 border-white/30 leading-[1.2] text-center select-none">
              <div className="my-auto w-full">{b.words}</div>
            </div>

            <div
              className="absolute bottom-0 right-0 border-2 border-white p-2 flex items-center justify-center rounded-full bg-black/60 text-white/80 cursor-se-resize hover:bg-black/80"
              onPointerDown={b.onResizeStart}
              onPointerMove={b.onResizeMove}
              onPointerUp={b.onResizeEnd}
            >
              <ArrowDownRightIcon className="size-8" />
            </div>
          </>
        )}
      </div>
    </Html3d>
  );
}
const speechBubbleBaseScale = 2;

const MemoizedSpeechBubble = React.memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
