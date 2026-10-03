import type { WorldState } from "@npc-cli/ui__world";
import { type Conversation, type OutlineRow, talkNeeds, toOutline, visibleRows } from "@npc-cli/ui__world/talk";
import { Glyphed, Pips } from "@npc-cli/ui__world/talk-thread";
import { cn } from "@npc-cli/util";
import {
  ArrowBendDownRightIcon,
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { inputClass } from "./classes";
import { dogWatch } from "./demo/dog-watch";
import { thawed } from "./demo/thawed";
import { IconButton, Picker } from "./parts";

/**
 * A conversation tree as an outline to find a way about, and talked through in a World's speech
 * history — demo, hand-written trees: see `docs/manifest-lore.md`
 */
export function TalkTab(props: { w: WorldState | undefined; zoom: number }) {
  const [convKey, setConvKey] = useState(conversations[0].key);
  const conv = conversations.find((c) => c.key === convKey) ?? conversations[0];
  return (
    // keyed, so another tree starts folded afresh
    <Talk
      key={conv.key}
      {...props}
      conv={conv}
      picker={
        <Picker
          value={conv.key}
          options={conversations.map((c) => ({ value: c.key, label: c.title }))}
          onChange={setConvKey}
        />
      }
    />
  );
}

function Talk({
  w,
  zoom,
  conv,
  picker,
}: {
  w: WorldState | undefined;
  zoom: number;
  conv: Conversation;
  /** Chooses the tree, shown as its title */
  picker: React.ReactNode;
}) {
  const outline = useMemo(() => toOutline(conv), [conv]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([conv.start]));
  const [query, setQuery] = useState("");
  /** Whom the player talks to in the World */
  const [npcKey, setNpcKey] = useState("");
  const [, setNpcsSeen] = useState(0);

  // who there is to talk to changes as they come and go
  useEffect(() => {
    const sub = w?.events.subscribe({ next: (e) => void (rosterEvents.has(e.key) && setNpcsSeen((n) => n + 1)) });
    return () => sub?.unsubscribe();
  }, [w]);

  const playerKey = typeof w?.player?.key === "string" ? w.player.key : undefined;
  const npcKeys = Object.keys(w?.n ?? {}).filter((key) => key !== playerKey);
  const chosen = npcKeys.includes(npcKey) ? npcKey : (npcKeys[0] ?? "");

  const needle = query.trim().toLowerCase();
  const rows =
    needle === ""
      ? visibleRows(outline.rows, open)
      : outline.rows.filter(
          (row) =>
            row.ref === false &&
            [row.via, row.nodeId, conv.nodes[row.nodeId]?.text, conv.nodes[row.nodeId]?.topic].some((text) =>
              text?.toLowerCase().includes(needle),
            ),
        );
  const nodeCount = Object.keys(conv.nodes).length;
  const gated = outline.rows.filter((row) => row.ref === false && row.needs.length > 0).length;

  return (
    // clear of the tabs and the zoom buttons
    <div className="size-full overflow-auto scrollbar-thin pt-8">
      <div className="flex flex-col gap-2 p-3" style={{ zoom }}>
        <div>
          {picker}
          <div className="text-zinc-500">
            <Glyphed text={conv.summary} />
          </div>
        </div>
        {w !== undefined && (
          <div className="flex items-center gap-1 text-zinc-500">
            the player talks to
            <Picker
              value={chosen}
              options={chosen === "" ? [{ value: "", label: "nobody" }] : npcKeys}
              onChange={setNpcKey}
            />
            <IconButton
              title="talk in the World: see its speech history"
              icon={ChatCircleTextIcon}
              disabled={chosen === "" || playerKey === undefined}
              onClick={() => w.speech.startTalk(conv, chosen)}
            />
          </div>
        )}
        <div className="flex items-center gap-1">
          <input
            className={cn(inputClass, "min-w-0 flex-1")}
            placeholder="find a line, a topic or an id"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <IconButton
            title="unfold all"
            icon={ArrowsOutLineVerticalIcon}
            onClick={() => setOpen(new Set(outline.rows.map((row) => row.key)))}
          />
          <IconButton title="fold all" icon={ArrowsInLineVerticalIcon} onClick={() => setOpen(new Set([conv.start]))} />
        </div>
        <div className="text-zinc-500">
          {nodeCount} lines · {outline.endings} endings · {gated} replies tested
          {needle !== "" && ` · ${rows.length} found`}
          {outline.missing > 0 && <span className="text-red-400"> · {outline.missing} lead nowhere</span>}
          {outline.unreachable.length > 0 && (
            <span className="text-red-400" title={outline.unreachable.join(", ")}>
              {" "}
              · {outline.unreachable.length} unreachable
            </span>
          )}
        </div>
        <div>
          {rows.map((row) => (
            <OutlineRowView
              key={row.key}
              row={row}
              text={conv.nodes[row.nodeId]?.text}
              flat={needle !== ""}
              open={open.has(row.key)}
              onFold={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.delete(row.key) === false) next.add(row.key);
                  return next;
                })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OutlineRowView(props: {
  row: OutlineRow;
  /** What the npc says there */
  text: undefined | string;
  /** A search result: neither indented nor foldable */
  flat: boolean;
  open: boolean;
  onFold(): void;
}) {
  const { row } = props;
  const Caret = props.open ? CaretDownIcon : CaretRightIcon;
  const foldable = row.kids > 0 && props.flat === false;
  return (
    <div
      title={props.text}
      className={cn("flex items-center gap-1 pr-1 py-0.5 rounded hover:bg-zinc-900", foldable && "cursor-pointer")}
      style={{ paddingLeft: 4 + (props.flat ? 0 : row.depth * indentPx) }}
      onClick={foldable ? props.onFold : undefined}
    >
      {foldable ? (
        <Caret className="size-3 shrink-0 text-zinc-500" />
      ) : row.ref ? (
        <ArrowBendDownRightIcon className="size-3 shrink-0 text-zinc-500" />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <span className="truncate">
        {row.via !== null && (
          <span>
            <Glyphed text={row.via} />{" "}
          </span>
        )}
        {row.missing ? (
          <span className="text-red-400">no such line: {row.nodeId}</span>
        ) : (
          <span className={cn(row.via !== null && "text-zinc-500")}>
            {row.ref ? row.nodeId : <Glyphed text={props.text ?? ""} />}
          </span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1 shrink-0 text-[10px] uppercase text-zinc-500">
        <Pips pips={row.needs.map((need) => ({ label: talkNeeds[need].label }))} />
        {row.ref === false && row.topic}
      </span>
    </div>
  );
}

/** Per level of the outline */
const indentPx = 12;
const conversations = [thawed, dogWatch];
const rosterEvents = new Set(["spawned", "spawned-many", "removed-npcs", "npcs-restored", "set-player"]);
