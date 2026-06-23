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
          if (!npc) continue;
          npc.drawLabel({ speaking: false });
          npc.labelMaterial.visible = true;
        }
        w.view.forceUpdate();
      },
      ensure(npcKey) {
        const extant = state.byKey[npcKey];
        if (extant) return extant;

        const npc = w.npc.get(npcKey);
        const bubble = (state.byKey[npcKey] = new SpeechBubbleApi(npcKey, w));
        bubble.setTracked({ object: npc.skinnedMesh, offset: npc.bubbleOffset });

        if (state.isTopDown) {
          npc.drawLabel({ speaking: true });
        } else {
          npc.labelMaterial.visible = false;
        }
        w.view.forceUpdate();
        return bubble;
      },
      onChangeTopDown(topDown: boolean) {
        state.isTopDown = topDown;
        for (const bubble of Object.values(state.byKey)) {
          const npc = w.n[bubble.key];
          if (!npc) continue;
          const rootDiv = bubble.html3d?.rootDiv;
          if (rootDiv) rootDiv.style.opacity = topDown ? "0" : "";
          npc.drawLabel({ speaking: topDown });
          npc.labelMaterial.visible = topDown;
        }
      },
      setShownIfExists(npcKey: string, shown: boolean) {
        const rootDiv = this.byKey[npcKey]?.html3d?.rootDiv;
        if (!rootDiv) return false;
        rootDiv.style.opacity = shown && !state.isTopDown ? "" : "0";
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
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} />
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
}

function NpcBubble({ bubble: b }: SpeechBubbleProps) {
  React.useLayoutEffect(() => {
    setTimeout(() => {
      b.initializeOffset();
      b.update();
      b.resolveOnMount();
      b.html3d?.onFrame();
      if (b.w.bubble.isTopDown && b.html3d?.rootDiv) {
        b.html3d.rootDiv.style.opacity = "0";
      }
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
          "transform-[translate(-50%)] relative flex flex-col rounded-none cursor-grab active:cursor-grabbing pointer-events-auto overflow-hidden",
          "h-64 w-64",
        )}
        onMouseDown={b.onMouseDown}
        onTouchStart={b.onTouchStart}
        onWheel={b.onWheel}
      >
        <div className="text-[2.5rem]">{b.key}</div>

        <div className="flex flex-1 overflow-hidden text-[#ff99] p-4 text-[3rem] tracking-wider rounded-2xl border-6 border-white/10 leading-[1.2] text-center select-none">
          <div className="my-auto w-full">{b.words}</div>
        </div>

        <div
          className="absolute bottom-0 right-0 border-2 border-white p-2 flex items-center justify-center rounded-full bg-black/60 text-white/80 cursor-se-resize hover:bg-black/80"
          onMouseDown={b.onResizeMouseDown}
          onTouchStart={b.onResizeTouchStart}
        >
          <ArrowDownRightIcon className="size-8" />
        </div>
      </div>
    </Html3d>
  );
}
const speechBubbleBaseScale = 2;

const MemoizedSpeechBubble = React.memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
