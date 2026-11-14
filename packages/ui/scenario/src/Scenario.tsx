import { isConversationEntry } from "@npc-cli/ui__world/scenario.schema";
import { useScenarioEntries } from "@npc-cli/ui__world/scenario-shared";
import { useWorld } from "@npc-cli/ui__world/use-world";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, tw } from "@npc-cli/util";
import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from "@phosphor-icons/react";
import { Allotment } from "allotment";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConversationCard } from "./ConversationCard";
import { columnClass } from "./classes";
import { IconButton } from "./parts";
import { type ScenarioStub, scenarios } from "./scenarios";
import type { ScenarioUiMeta } from "./schema";

import "./scenario.css";

/** Scenarios and conversation trees, listed beside the one chosen — see `docs/scenarios.md` */
export default function Scenario({ meta }: { meta: ScenarioUiMeta }) {
  const w = useWorld(meta.worldKey);
  const { uiStoreApi } = useContext(UiContext);
  const entries = useScenarioEntries();
  const conversations = useMemo(
    () =>
      Object.values(entries)
        .filter(isConversationEntry)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );

  const select = (key: string) =>
    uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as ScenarioUiMeta).entryKey = key));
  const zoomBy = (delta: number) =>
    uiStoreApi.setUiMeta(meta.id, (draft) => {
      const d = draft as ScenarioUiMeta;
      d.zoom = Math.min(maxZoom, Math.max(minZoom, Math.round(((d.zoom ?? 1) + delta) * 10) / 10));
    });

  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (root.current !== null) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  const zoom = meta.zoom ?? 1;
  /** Room for both columns, which are then resizable; else they stack */
  const wide = width / zoom >= wideWidth;

  const listButton = (key: string, label: string, title?: string) => (
    <button
      key={key}
      type="button"
      title={title}
      className={cn(
        "block w-full text-left px-1 py-0.5 rounded cursor-pointer truncate",
        key === meta.entryKey ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900",
      )}
      onClick={() => select(key)}
    >
      {label}
    </button>
  );

  const entriesCol = (
    <div className="p-3 flex flex-col gap-2">
      <div>
        <div className={sectionClass}>scenarios</div>
        {scenarios.map((x) => listButton(`${scenarioPrefix}${x.key}`, x.title, x.npcs))}
      </div>
      <div>
        <div className={sectionClass}>conversations</div>
        {conversations.map((c) => listButton(`${talkPrefix}${c.key}`, c.name, c.summary))}
      </div>
    </div>
  );
  const conv = conversations.find((c) => `${talkPrefix}${c.key}` === meta.entryKey);
  const stub = scenarios.find((x) => `${scenarioPrefix}${x.key}` === meta.entryKey);
  const shownCol =
    stub !== undefined ? (
      <ScenarioCard stub={stub} />
    ) : conv !== undefined ? (
      <ConversationCard key={conv.key} w={w} conv={conv} />
    ) : (
      <div className="h-full grid place-items-center text-zinc-500 p-4">choose a scenario or a conversation</div>
    );

  return (
    <div
      ref={root}
      className="scenario relative size-full bg-gray-650 text-zinc-300 text-xs tracking-wide leading-relaxed"
    >
      {/* over the pane, so in reach however far it has scrolled */}
      <div className="absolute z-10 top-1 right-1 flex items-center gap-1 px-1 rounded bg-zinc-950/80 opacity-60 hover:opacity-100">
        <span className="text-zinc-500">{Math.round(zoom * 100)}%</span>
        <IconButton title="smaller text" icon={MagnifyingGlassMinusIcon} onClick={() => zoomBy(-zoomStep)} />
        <IconButton title="larger text" icon={MagnifyingGlassPlusIcon} onClick={() => zoomBy(zoomStep)} />
      </div>
      {wide ? (
        // `zoom` goes inside each pane: on the allotment itself a drag would move its sash too little
        <Allotment
          defaultSizes={meta.split}
          onDragEnd={(split) =>
            uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as ScenarioUiMeta).split = split))
          }
        >
          <Allotment.Pane minSize={120} preferredSize={190}>
            <div className={columnClass} style={{ zoom }}>
              {entriesCol}
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={220}>
            {/* clear of the zoom buttons */}
            <div className="size-full pt-8">
              <div className={columnClass} style={{ zoom }}>
                {shownCol}
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
      ) : (
        <div className={cn(columnClass, "divide-y divide-zinc-800")} style={{ zoom }}>
          {entriesCol}
          {shownCol}
        </div>
      )}
    </div>
  );
}

/** A scenario's steps, until it can be run */
function ScenarioCard({ stub }: { stub: ScenarioStub }) {
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-zinc-100">{stub.title}</div>
      <div className="text-zinc-500">
        {stub.npcs} · {stub.status}
      </div>
      <ol className="flex flex-col gap-1 list-decimal pl-4">
        {stub.steps.map((step) => (
          <li key={step.title}>
            <span className="text-zinc-100">{step.title}.</span> {step.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Prefix a scenario's or a conversation's key in `meta.entryKey` */
const scenarioPrefix = "scenario/";
const talkPrefix = "talk/";
const sectionClass = tw("text-zinc-500 uppercase text-[10px]");
/** In px at 100% text: narrower, the columns stack */
const wideWidth = 520;
const zoomStep = 0.1;
const minZoom = 0.7;
const maxZoom = 2;
