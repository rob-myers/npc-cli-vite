import { cn, useStateRef } from "@npc-cli/util";
import { DotsSixIcon, DotsThreeIcon, ResizeIcon, XIcon } from "@phosphor-icons/react";
import { memo, useContext, useEffect, useLayoutEffect } from "react";
import { Html3d } from "../components/Html3d";
import { SpeechBubbleApi } from "./speech-bubble-api";
import { WorldContext } from "./world-context";

export default function NpcBubbles() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: {},
      prevData: {},

      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          const b = state.get(npcKey);
          if (!b) continue;

          state.prevData[npcKey] = {
            offset: { ...b.offset },
            cssVars: b.getBubbleCssVars(),
          };

          b.dispose();
          delete state.byKey[npcKey];
        }

        w.view.forceUpdate();
      },
      ensure(npcKey) {
        let b = state.get(npcKey);
        if (b) return b;

        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        b = state.byKey[npcKey] = new SpeechBubbleApi(npcKey, tracked, w);

        const prev = state.prevData[npcKey];
        if (prev?.offset) b.offset = { ...prev.offset };
        if (prev?.cssVars) b.initialCssVars = { ...prev.cssVars };
        delete state.prevData[npcKey];

        w.view.forceUpdate();
        return b;
      },
      get(npcKey: string) {
        return state.byKey[npcKey] ?? null;
      },
      handleDevHotReload() {
        for (const bubble of Object.values(state.byKey)) {
          const tempBubble = new SpeechBubbleApi(bubble.key, bubble.tracked, w);
          Object.assign(bubble, { ...tempBubble }, { ...bubble });
          Object.setPrototypeOf(bubble, Object.getPrototypeOf(tempBubble));
        }
      },
      onEvent(e) {
        switch (e.key) {
          case "disabled":
            for (const bubble of Object.values(state.byKey)) {
              bubble.pauseInteractiveTimer();
            }
            break;

          case "enabled":
            for (const bubble of Object.values(state.byKey)) {
              bubble.resumeInteractiveTimer();
            }
            break;
        }
      },
      setShown(npcKey: string, shown: boolean) {
        const bubble = this.get(npcKey);
        if (!bubble) {
          return;
        }
        bubble.setOpacity(shown ? 1 : 0);
      },
    }),
  );

  w.bubble = state;
  w.b = state.byKey;

  useEffect(() => {
    import.meta.env.DEV && state.handleDevHotReload();
    const sub = w.events.subscribe({ next: (e) => state.onEvent(e) });
    return () => sub.unsubscribe();
  }, []);

  return Object.values(state.byKey).map((bubble) => (
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} />
  ));
}

export type State = {
  byKey: { [npcKey: string]: SpeechBubbleApi };
  /** Persist bubble properties over remounts */
  prevData: {
    [npcKey: string]: { offset?: { x: number; y: number; z: number }; cssVars?: Record<string, string> };
  };
  delete(...npcKeys: string[]): void;
  ensure(npcKey: string): SpeechBubbleApi;
  get(npcKey: string): null | SpeechBubbleApi;
  handleDevHotReload(): void;
  onEvent(e: JshCli.Event): void;
  setShown(npcKey: string, shown: boolean): void;
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
          "relative flex flex-col items-center justify-center rounded-2xl cursor-grab active:cursor-grabbing overflow-hidden",
          "transform-[translate(-50%)] w-(--bubble-width,20rem) h-(--bubble-height,6rem)",
          "border-4 border-white/40 bg-black/70 backdrop-blur-sm transition-colors",
          b.interact.active && "pointer-events-auto border-white/70",
        )}
        onMouseDown={b.onMouseDown}
        onTouchStart={b.onTouchStart}
        onWheel={b.onWheel}
      >
        {b.interact.active && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-white/30">
            <DotsSixIcon className="size-8" weight="bold" />
          </div>
        )}

        <div className="flex items-center gap-3 px-5">
          <div
            className={cn(
              "text-[2.2rem] font-medium tracking-wide truncate max-w-52 select-none text-white/90",
              !b.interact.active && "opacity-70",
            )}
          >
            {b.key}
          </div>

          <div
            className={cn(
              "pointer-events-auto shrink-0 grid place-items-center size-11 rounded-full border-2 cursor-pointer transition-colors",
              b.interact.active ? "border-white/70 text-white bg-white/10" : "border-white/25 text-white/60",
            )}
            onClick={b.toggleInteractive.bind(b)}
          >
            <DotsThreeIcon className="size-8" weight="bold" />
          </div>

          <div
            className={cn(
              "pointer-events-auto shrink-0 grid place-items-center size-11 rounded-full border-2 border-white/25 text-white/60 cursor-pointer",
              "transition-colors hover:border-red-400/70 hover:text-red-300 hover:bg-red-500/10",
            )}
            onClick={() => b.fadeAndDelete()}
          >
            <XIcon className="size-8" weight="bold" />
          </div>
        </div>

        {b.interact.active && (
          <div
            className={cn(
              "pointer-events-auto absolute bottom-1.5 right-1.5 grid place-items-center size-9 rounded-lg cursor-nwse-resize",
              "bg-black/80 border-2 border-white/40 text-white/90",
            )}
            onMouseDown={b.onResizeMouseDown}
            onTouchStart={b.onResizeTouchStart}
          >
            <ResizeIcon className="size-6" weight="bold" />
          </div>
        )}
      </div>
    </Html3d>
  );
}

const MemoizedSpeechBubble = memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
