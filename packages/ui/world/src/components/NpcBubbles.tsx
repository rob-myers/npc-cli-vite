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
      lastBubbleData: {},

      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          const bubble = state.byKey[npcKey];
          if (!bubble) continue;

          state.lastBubbleData[npcKey] = {
            offset: { ...bubble.offset },
            cssVars: bubble.getBubbleCssVars(),
          };

          bubble.dispose();
          delete state.byKey[npcKey];

          const npc = w.n[npcKey];
          if (!npc) continue;
          npc.drawLabel({ speaking: false });
          npc.labelVisible.value = 1;
        }
        w.view.forceUpdate();
      },
      ensure(npcKey, opts: Partial<AutoDeleteOpts> = {}) {
        const extant = state.byKey[npcKey];
        if (extant) return extant;

        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        const bubble = (state.byKey[npcKey] = new SpeechBubbleApi(npcKey, tracked, w));

        const prev = state.lastBubbleData[npcKey];
        if (prev?.offset) bubble.offset = { ...prev.offset };
        if (prev?.cssVars) bubble.initialCssVars = { ...prev.cssVars };
        delete state.lastBubbleData[npcKey];

        bubble.autoDeleteOpts = { ...defaultAutoDeleteOpts, ...opts };
        bubble.scheduleAutoDelete();

        if (w.view.topDown) {
          npc.drawLabel({ speaking: true });
        } else {
          npc.labelVisible.value = 0;
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
        for (const bubble of Object.values(state.byKey)) {
          const npc = w.n[bubble.key];
          if (!npc) continue;
          const rootDiv = bubble.html3d?.rootDiv;
          if (rootDiv) rootDiv.style.opacity = topDown ? "0" : "";
          npc.drawLabel({ speaking: topDown });
          npc.labelVisible.value = topDown ? 1 : 0;
        }
      },
      setShownIfExists(npcKey: string, shown: boolean) {
        const rootDiv = this.byKey[npcKey]?.html3d?.rootDiv;
        if (!rootDiv) return false;
        rootDiv.style.opacity = shown && !w.view.topDown ? "" : "0";
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
          for (const bubble of Object.values(state.byKey)) {
            bubble.pauseAutoDelete();
            bubble.pauseInteractiveTimer();
          }
        } else if (e.key === "enabled") {
          for (const bubble of Object.values(state.byKey)) {
            bubble.resumeAutoDelete();
            bubble.resumeInteractiveTimer();
          }
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
  /** Persist bubble properties over remounts */
  lastBubbleData: {
    [npcKey: string]: { offset?: { x: number; y: number; z: number }; cssVars?: Record<string, string> };
  };
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
      initialCssVars={b.initialCssVars}
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      visible
    >
      <div
        className={cn(
          "relative flex flex-col rounded-none cursor-grab active:cursor-grabbing overflow-hidden",
          "transform-[translate(-50%)] w-(--bubble-width,35rem) h-(--bubble-height,18rem)",
          b.isInteractive && "pointer-events-auto",
        )}
        onMouseDown={b.onMouseDown}
        onTouchStart={b.onTouchStart}
        onWheel={b.onWheel}
      >
        <div className={cn("transition-opacity text-[2.5rem] truncate", !b.isInteractive && "select-none opacity-50")}>
          {b.key}
        </div>

        <div
          className={cn(
            "transition-opacity flex flex-1 overflow-hidden text-[#ff99] p-4 text-[3rem] tracking-wider rounded-2xl leading-[1.2] text-center select-none",
            b.isInteractive ? "border-3 border-white/25" : "opacity-75 border-6 border-white/10",
          )}
        >
          <div className="my-auto w-full">{b.words}</div>
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 flex gap-2",
            "transition-opacity border-2 border-white p-2 flex items-center justify-center rounded-full bg-black/60 text-white/80 cursor-pointer",
            !b.isInteractive && "opacity-50",
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
