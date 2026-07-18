import { cn, useStateRef } from "@npc-cli/util";
import { ArrowDownRightIcon, DotIcon } from "@phosphor-icons/react";
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

          const npc = w.n[npcKey];
          if (!npc) continue;
          npc.drawLabel({ speaking: false });
          npc.labelVisible.value = 1;
        }

        w.view.forceUpdate();
      },
      ensure(npcKey, secs?: number) {
        let b = state.get(npcKey);
        if (b) return b;

        const npc = w.npc.get(npcKey);
        const tracked = { object: npc.skinnedMesh, offset: npc.bubbleOffset };
        b = state.byKey[npcKey] = new SpeechBubbleApi(npcKey, tracked, w);

        const prev = state.prevData[npcKey];
        if (prev?.offset) b.offset = { ...prev.offset };
        if (prev?.cssVars) b.initialCssVars = { ...prev.cssVars };
        delete state.prevData[npcKey];

        b.deletion.opts = typeof secs === "number" ? { secs } : null;
        b.scheduleAutoDelete();

        if (w.view.topDown) {
          npc.drawLabel({ speaking: true });
        } else {
          npc.labelVisible.value = 0;
        }

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
              bubble.pauseAutoDelete();
              bubble.pauseInteractiveTimer();
            }
            break;

          case "enabled":
            for (const bubble of Object.values(state.byKey)) {
              bubble.resumeAutoDelete();
              bubble.resumeInteractiveTimer();
            }
            break;

          case "enter-topdown":
          case "exit-topdown": {
            const topDown = e.key === "enter-topdown";
            for (const bubble of Object.values(state.byKey)) {
              bubble.setOpacity(topDown ? 0 : 1);
              const npc = w.n[bubble.key];
              if (!npc) continue;
              npc.drawLabel({ speaking: topDown });
              npc.labelVisible.value = topDown ? 1 : 0;
            }
            break;
          }
        }
      },
      setShown(npcKey: string, shown: boolean) {
        const npc = w.n[npcKey];
        const bubble = this.get(npcKey);
        if (!npc || !bubble) {
          return;
        }

        const willShow = shown === true && w.view.topDown === false;
        const targetOpacity = willShow ? 1 : 0;
        bubble.setOpacity(targetOpacity);

        return willShow;
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
  ensure(npcKey: string, secs?: number): SpeechBubbleApi;
  get(npcKey: string): null | SpeechBubbleApi;
  handleDevHotReload(): void;
  onEvent(e: JshCli.Event): void;
  /** forced hidden in topDown view */
  setShown(npcKey: string, shown: boolean): boolean | undefined;
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
          b.interact.active && "pointer-events-auto",
        )}
        onMouseDown={b.onMouseDown}
        onTouchStart={b.onTouchStart}
        onWheel={b.onWheel}
      >
        <div className="flex justify-between items-end">
          <div
            className={cn("transition-opacity text-[2.5rem] truncate", !b.interact.active && "select-none opacity-50")}
          >
            {b.key}
          </div>
          <div
            className={cn(
              "pointer-events-auto border-2 border-white/75 border-b-black! p-3 rounded-t-full bg-black/0 text-white/80 cursor-pointer",
              "border-white/25",
            )}
            onClick={b.toggleInteractive.bind(b)}
          >
            <DotIcon className="size-10" />
          </div>
        </div>

        <div
          className={cn(
            "transition-opacity flex flex-1 overflow-hidden text-[#ff99] p-4 text-[3rem] tracking-wider rounded-2xl rounded-tr-none leading-[1.2] text-center select-none",
            b.interact.active ? "border-3 border-white/25" : "opacity-75 border-6 border-white/10",
          )}
        >
          <div className="my-auto w-full">
            {/* main content */}
            {b.words}
          </div>
        </div>

        <div
          className={cn(
            "absolute bottom-0 right-0 text-white/80 cursor-nwse-resize",
            !b.interact.active && "opacity-25",
          )}
          onMouseDown={b.onResizeMouseDown}
          onTouchStart={b.onResizeTouchStart}
        >
          <ArrowDownRightIcon className="size-16" />
        </div>
      </div>
    </Html3d>
  );
}

const MemoizedSpeechBubble = memo<SpeechBubbleProps & { epochMs: number }>(NpcBubble);
