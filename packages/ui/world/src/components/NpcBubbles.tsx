import { cn, useStateRef } from "@npc-cli/util";
import { HandPointingIcon } from "@phosphor-icons/react";
import { memo, useContext, useEffect, useLayoutEffect } from "react";
import { Html3d } from "../components/Html3d";
import { type AutoDeleteOpts, defaultAutoDeleteOpts, SpeechBubbleApi } from "./speech-bubble-api";
import { WorldContext } from "./world-context";

export default function NpcBubbles() {
  const w = useContext(WorldContext);

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
      ensure(npcKey, opts: Partial<AutoDeleteOpts> = {}) {
        const extant = state.byKey[npcKey];
        if (extant) return extant;

        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        const bubble = (state.byKey[npcKey] = new SpeechBubbleApi(npcKey, tracked, w));

        bubble.autoDeleteOpts = { ...defaultAutoDeleteOpts, ...opts };
        bubble.scheduleAutoDelete();

        if (state.isTopDown) {
          npc.drawLabel({ speaking: true });
        } else {
          npc.labelMaterial.visible = false;
        }
        w.view.forceUpdate();
        return bubble;
      },
      handleDevHotReload() {
        for (const bubble of Object.values(state.byKey)) {
          const tempBubble = new SpeechBubbleApi(bubble.key, bubble.tracked, w);
          Object.assign(bubble, { ...tempBubble }, { ...bubble });
          Object.setPrototypeOf(bubble, Object.getPrototypeOf(tempBubble));
        }
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

  useEffect(() => {
    import.meta.env.DEV && state.handleDevHotReload();

    const sub = w.events.subscribe({
      next(e) {
        if (e.key === "disabled") {
          for (const bubble of Object.values(state.byKey)) bubble.pauseAutoDelete();
        } else if (e.key === "enabled") {
          for (const bubble of Object.values(state.byKey)) bubble.resumeAutoDelete();
        }
      },
    });
    return () => sub.unsubscribe();
  }, []);

  return Object.values(state.byKey).map((bubble) => (
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} />
  ));
}

export type State = {
  byKey: { [npcKey: string]: SpeechBubbleApi };
  isTopDown: boolean;
  delete(...npcKeys: string[]): void;
  ensure(npcKey: string, opts?: AutoDeleteOpts): SpeechBubbleApi;
  handleDevHotReload(): void;
  onChangeTopDown(topDown: boolean): void;
  setShownIfExists(npcKey: string, shown: boolean): boolean;
};

type SpeechBubbleProps = {
  bubble: SpeechBubbleApi;
};

function NpcBubble({ bubble: b }: SpeechBubbleProps) {
  useLayoutEffect(() => {
    setTimeout(() => {
      b.html3d?.onFrame();
      b.initializeOpacity();
    }, 30);
  }, []);

  return (
    <Html3d
      ref={b.html3dRef.bind(b)}
      className="pointer-events-none absolute top-0 left-0"
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      visible
    >
      <div
        ref={b.bubbleDivRef.bind(b)}
        className={cn(
          "transform-[translate(-50%)] relative flex flex-col rounded-none cursor-grab active:cursor-grabbing overflow-hidden",
          "h-72 w-140",
          b.isInteractive && "pointer-events-auto",
        )}
        onMouseDown={b.onMouseDown}
        onTouchStart={b.onTouchStart}
        onWheel={b.onWheel}
      >
        <div className={cn("text-[2.5rem] truncate", !b.isInteractive && "select-none opacity-50")}>{b.key}</div>

        <div className="flex flex-1 overflow-hidden text-[#ff99] p-4 text-[3rem] tracking-wider rounded-2xl border-6 border-white/10 leading-[1.2] text-center select-none">
          <div className="my-auto w-full">{b.words}</div>
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 flex gap-2",
            "border-2 border-white p-2 flex items-center justify-center rounded-full bg-black/60 text-white/80",
            b.isInteractive ? "cursor-se-resize" : "cursor-pointer opacity-25",
          )}
          onMouseDown={b.onResizeMouseDown}
          onTouchStart={b.onResizeTouchStart}
          onPointerUp={b.toggleInteractive.bind(b)}
        >
          <HandPointingIcon className="size-10" />
        </div>
      </div>
    </Html3d>
  );
}

const MemoizedSpeechBubble = memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
