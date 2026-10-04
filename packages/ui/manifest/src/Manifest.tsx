import type { WorldState } from "@npc-cli/ui__world";
import { helper } from "@npc-cli/ui__world/helper";
import { useWorld } from "@npc-cli/ui__world/use-world";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  FloppyDiskIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Allotment } from "allotment";
import { useContext, useEffect, useRef, useState } from "react";
import { ConversationCard } from "./ConversationCard";
import { columnClass, inputClass } from "./classes";
import { conversations } from "./demo/trees";
import { deleteLoreEntry, loadLore, saveLoreEntry } from "./library";
import { type LoreEntry, loreChangedEvent, loreSlugRe } from "./lore.schema";
import { IconButton, Picker } from "./parts";
import type { ManifestUiMeta } from "./schema";
import { manifestShared, useManifestShared } from "./shared";

import "./manifest.css";

/**
 * Characters, tied to a live World's rooms, doors and npcs should there be one, and conversation
 * trees, beside the one chosen — see `docs/manifest-lore.md`
 */
export default function Manifest({ meta }: { meta: ManifestUiMeta }) {
  const w = useWorld(meta.worldKey);
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      entries: {},
      error: null,
      draft: null,
      dirty: false,
      rev: 0,
      saveTimer: undefined,
      newSlug: "",

      async load() {
        try {
          const entries = await loadLore();
          state.set({ entries, error: null });
          // an edit under way is kept, and our own save left alone
          const key = state.draft?.key ?? meta.entryKey;
          const same = key !== undefined && JSON.stringify(entries[key]) === JSON.stringify(state.draft);
          if (state.dirty === false && same === false) state.show(key);
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      show(key) {
        const entry = key === undefined ? undefined : state.entries[key];
        state.set({ draft: entry === undefined ? null : structuredClone(entry), dirty: false });
      },
      select(key) {
        if (key === state.draft?.key) return;
        if (state.dirty === true) state.save(); // what is typed is kept
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as ManifestUiMeta).entryKey = key));
        state.show(key);
        const entry = state.entries[key];
        if (entry !== undefined) state.locate(entry);
      },
      patch(partial) {
        if (state.draft === null) return;
        Object.assign(state.draft, partial);
        state.rev++;
        state.set({ dirty: true });
        clearTimeout(state.saveTimer);
        if (editable) state.saveTimer = setTimeout(() => state.save(), autosaveMs);
      },
      async save() {
        clearTimeout(state.saveTimer);
        if (state.draft === null || editable === false) return;
        const { rev } = state;
        try {
          await saveLoreEntry(state.draft);
          // typed since? then still dirty, and the timer has it
          // no reload: the watcher's `lore-changed` brings one
          state.set({ dirty: state.rev !== rev, error: null });
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async remove() {
        const key = state.draft?.key;
        if (key === undefined || window.confirm(`Delete ${key}?`) === false) return;
        try {
          await deleteLoreEntry(key);
          state.set({ draft: null, dirty: false, error: null });
          await state.load();
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async add() {
        const key = `character/${state.newSlug}`;
        if (loreSlugRe.test(state.newSlug) === false || key in state.entries) return;
        try {
          await saveLoreEntry({ key, kind: "character", name: state.newSlug, maps: {} });
          state.set({ newSlug: "", dirty: false });
          await state.load();
          state.select(key);
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async setNpcKey(next) {
        const prev = state.draft?.npcKey;
        state.patch({ npcKey: next });
        const npc = prev === undefined ? undefined : w?.n?.[prev];
        if (w === undefined || npc === undefined || prev === undefined) return;
        // removed, then added back under the new name: where they stood, with their doors
        try {
          const at = { x: npc.point.x, y: npc.point.y };
          const access = w.e.npcToAccess[prev];
          const wasPlayer = w.player?.key === prev;
          const skin = state.draft?.skin;
          w.e.removeNpcs(prev);
          if (next !== undefined) {
            await w.npc.spawn({ npcKey: next, at, as: skin !== undefined && hasSkin(w, skin) ? skin : undefined });
            if (access !== undefined) w.e.npcToAccess[next] = access;
            if (wasPlayer) w.player.assign(next);
          }
          w.view.forceUpdate();
          manifestShared.set(meta.worldKey, { renamed: { from: prev, to: next } }); // a map shows them still
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      setSkin(skin) {
        state.patch({ skin });
        const npc = state.draft?.npcKey === undefined ? undefined : w?.n?.[state.draft.npcKey];
        if (w === undefined || npc === undefined || skin === undefined || !hasSkin(w, skin)) return;
        npc.setSkin(skin);
        w.view.forceUpdate();
      },
      zoomBy(delta) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          const d = draft as ManifestUiMeta;
          d.zoom = Math.min(maxZoom, Math.max(minZoom, Math.round(((d.zoom ?? 1) + delta) * 10) / 10));
        });
      },
      locate(entry) {
        if (w === undefined) return;
        const npc = entry.npcKey === undefined ? undefined : w.n?.[entry.npcKey];
        if (npc !== undefined) return manifestShared.set(meta.worldKey, { locate: { x: npc.point.x, y: npc.point.y } });
        const grKey = entry.maps[w.mapKey]?.rooms[0];
        if (grKey === undefined) return;
        const { gmId, roomId } = helper.getGmRoomId(grKey as Geomorph.GmRoomKey);
        const gm = w.gms[gmId];
        const room = gm?.rooms[roomId];
        if (room === undefined) return;
        const { x, y } = room.center;
        const { a, b, c, d, e, f } = gm.transform;
        manifestShared.set(meta.worldKey, { locate: { x: a * x + c * y + e, y: b * x + d * y + f } });
      },
    }),
    { deps: [w, meta.entryKey] },
  );

  useEffect(() => {
    state.load();
    const onChange = () => state.load();
    import.meta.hot?.on(loreChangedEvent, onChange);
    return () => {
      import.meta.hot?.off(loreChangedEvent, onChange);
      if (state.dirty === true) state.save();
    };
  }, []);

  // a map of this World outlines the entry's rooms and doors, and spawns its npc as edited
  useEffect(() => {
    manifestShared.set(meta.worldKey, { entry: state.draft === null ? null : { ...state.draft } });
    return () => manifestShared.set(meta.worldKey, { entry: null });
  }, [meta.worldKey, state.draft, state.rev]);

  // choosing an npc on such a map shows their entry
  const { npcKey: mapNpcKey } = useManifestShared(meta.worldKey);
  useEffect(() => {
    const entry = Object.values(state.entries).find((e) => mapNpcKey !== null && e.npcKey === mapNpcKey);
    if (entry !== undefined) state.select(entry.key);
  }, [mapNpcKey]);

  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (root.current !== null) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  const { draft, entries } = state;
  const zoom = meta.zoom ?? 1;
  /** Room for both columns, which are then resizable; else they stack */
  const wide = width / zoom >= wideWidth;

  const entriesCol = (
    <div className="p-3 flex flex-col gap-2">
      <div>
        <div className={sectionClass}>characters</div>
        {Object.values(entries).map((e) => (
          <button
            key={e.key}
            type="button"
            title={e.npcKey}
            className={cn(
              "block w-full text-left px-1 py-0.5 rounded cursor-pointer truncate",
              e.key === draft?.key ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900",
            )}
            onClick={() => state.select(e.key)}
          >
            {e.name || e.key}
          </button>
        ))}
      </div>
      {editable && (
        <div className="flex gap-1">
          <input
            className={cn(inputClass, "min-w-0 flex-1")}
            placeholder="new-character"
            value={state.newSlug}
            onChange={(e) => state.set({ newSlug: e.currentTarget.value })}
            onKeyDown={(e) => e.key === "Enter" && state.add()}
          />
          <IconButton title="add a character" icon={PlusIcon} onClick={state.add} />
        </div>
      )}
      <div>
        <div className={sectionClass}>conversations</div>
        {conversations.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.summary}
            className={cn(
              "block w-full text-left px-1 py-0.5 rounded cursor-pointer truncate",
              `${talkPrefix}${c.key}` === meta.entryKey ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900",
            )}
            onClick={() => state.select(`${talkPrefix}${c.key}`)}
          >
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
  const cardCol =
    draft === null ? (
      <div className="h-full grid place-items-center text-zinc-500 p-4">
        {state.error ?? "choose a character or a conversation"}
      </div>
    ) : (
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <span className="text-zinc-500 mr-auto">
            {draft.key}
            {state.dirty && " •"}
          </span>
          {editable && (
            <>
              <IconButton
                title="save now (edits save themselves)"
                icon={FloppyDiskIcon}
                disabled={state.dirty === false}
                onClick={state.save}
              />
              <IconButton title="delete" icon={TrashIcon} onClick={state.remove} />
            </>
          )}
        </div>
        <input
          className={cn(inputClass, "text-zinc-100")}
          readOnly={!editable}
          placeholder="name"
          value={draft.name}
          onChange={(e) => state.patch({ name: e.currentTarget.value })}
        />
        {w !== undefined && <NpcFields w={w} draft={draft} onNpcKey={state.setNpcKey} onSkin={state.setSkin} />}
        <KeyBox w={w} draft={draft} onPatch={state.patch} />
        {state.error !== null && <div className="text-red-400 break-all">{state.error}</div>}
      </div>
    );
  const conv = conversations.find((c) => `${talkPrefix}${c.key}` === meta.entryKey);
  /** The conversation chosen, else the character */
  const shownCol = conv === undefined ? cardCol : <ConversationCard key={conv.key} w={w} conv={conv} />;

  return (
    <div
      ref={root}
      className="manifest relative size-full bg-gray-650 text-zinc-300 text-xs tracking-wide leading-relaxed"
    >
      {/* over the pane, so in reach however far it has scrolled */}
      <div className="absolute z-10 top-1 right-1 flex items-center gap-1 px-1 rounded bg-gray-800/80 opacity-60 hover:opacity-100">
        <span className="text-zinc-500">{Math.round(zoom * 100)}%</span>
        <IconButton title="smaller text" icon={MagnifyingGlassMinusIcon} onClick={() => state.zoomBy(-zoomStep)} />
        <IconButton title="larger text" icon={MagnifyingGlassPlusIcon} onClick={() => state.zoomBy(zoomStep)} />
      </div>
      {wide ? (
        // `zoom` goes inside each pane: on the allotment itself a drag would move its sash too little
        <Allotment
          defaultSizes={meta.split}
          onDragEnd={(split) =>
            uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as ManifestUiMeta).split = split))
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

/** Their npc and skin in the World */
function NpcFields(props: {
  w: WorldState;
  draft: LoreEntry;
  onNpcKey(npcKey: string | undefined): void;
  onSkin(skin: string | undefined): void;
}) {
  const { w, draft } = props;
  return (
    <div className="flex items-center gap-1 text-zinc-500">
      npc
      <NpcKeyInput key={draft.key} value={draft.npcKey ?? ""} onCommit={(v) => props.onNpcKey(v || undefined)} />
      skin
      <Picker
        value={draft.skin ?? ""}
        options={[{ value: "", label: "default" }, ...(w.npc?.skin.entries ?? []).map(({ key }) => key)]}
        disabled={!editable}
        onChange={(skin) => props.onSkin(skin || undefined)}
      />
    </div>
  );
}

/** Committed on enter or blur, not per keystroke: a commit renames their npc in the World */
function NpcKeyInput({ value, onCommit }: { value: string; onCommit(value: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <input
      className={cn(inputClass, "w-24 text-zinc-300")}
      readOnly={!editable}
      placeholder="npcKey"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function hasSkin(w: WorldState, skin: string) {
  return w.npc?.getSkinIndexBySkinKey(skin) !== -1;
}

function hasRoom(w: WorldState, key: string) {
  const [, gmId, roomId] = key.match(/^g(\d+)r(\d+)$/) ?? [];
  return gmId !== undefined && w.gms[Number(gmId)]?.rooms[Number(roomId)] !== undefined;
}

/**
 * The rooms that are theirs and the doors they hold keys to on this map, as badges, and ONE box to
 * add to them — each becomes a badge once it is found to exist, and what is not stays typed
 */
function KeyBox(props: { w: WorldState | undefined; draft: LoreEntry; onPatch(partial: Partial<LoreEntry>): void }) {
  const { w, draft } = props;
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const here = (w !== undefined && draft.maps[w.mapKey]) || { rooms: [], doors: [] };
  const held = { rooms: here.rooms, doors: here.doors };

  const kindOf = (key: string): null | keyof typeof held => {
    if (w === undefined) return null;
    if (w.door?.byKey[key as Geomorph.GmDoorKey] !== undefined) return "doors";
    return hasRoom(w, key) ? "rooms" : null;
  };
  // per map, and so only with one
  const apply = ({ rooms, doors }: typeof held) =>
    w !== undefined && props.onPatch({ maps: { ...draft.maps, [w.mapKey]: { rooms, doors } } });
  const commit = (typed: string) => {
    const next = { rooms: [...held.rooms], doors: [...held.doors] };
    const unknown: string[] = [];
    let added = false;
    for (const key of typed.split(/[\s,]+/).filter(Boolean)) {
      const kind = kindOf(key);
      if (kind === null) unknown.push(key);
      else if (next[kind].includes(key) === false) {
        next[kind].push(key);
        added = true;
      }
    }
    if (added) apply(next);
    setText(unknown.join(" "));
    setInvalid(unknown.length > 0);
  };
  const remove = (kind: keyof typeof held, key: string) =>
    apply({ ...held, [kind]: held[kind].filter((k) => k !== key) });

  const roomLabels = new Map(
    Object.values(w?.decor?.byKey ?? {})
      .filter(helper.isRoomLabel)
      .map((d) => [d.meta.grKey as string, d.meta.label]),
  );
  const badges = [
    ...held.rooms.map((key) => ({
      key,
      kind: "rooms" as const,
      known: w === undefined || hasRoom(w, key),
      title: roomLabels.get(key) ?? "room",
    })),
    ...held.doors.map((key) => ({
      key,
      kind: "doors" as const,
      known: w === undefined || w.door?.byKey[key as Geomorph.GmDoorKey] !== undefined,
      title: "a door they hold the key to",
    })),
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 p-1 rounded border bg-zinc-900",
        invalid ? "border-red-500" : "border-zinc-800 focus-within:border-zinc-600",
      )}
    >
      {badges.map(({ key, kind, known, title }) => (
        <span
          key={`${kind} ${key}`}
          title={known ? title : "not on this map"}
          className={cn("flex items-center gap-1 px-1 rounded border border-zinc-700", !known && "text-red-400")}
        >
          {key}
          {editable && (
            <button type="button" title="remove" className={bareButtonClass} onClick={() => remove(kind, key)}>
              <XIcon />
            </button>
          )}
        </span>
      ))}
      {editable && w !== undefined && (
        <input
          className="flex-1 min-w-24 bg-transparent outline-none"
          placeholder={badges.length === 0 ? "rooms, doors: g0r1 g0d29" : ""}
          value={text}
          onChange={(e) => {
            const typed = e.currentTarget.value;
            // a separator ends a key, as does a paste of several
            if (/[\s,]/.test(typed)) return commit(typed);
            setText(typed);
            setInvalid(false);
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") return commit(text);
            const last = badges[badges.length - 1];
            if (e.key === "Backspace" && text === "" && last !== undefined) remove(last.kind, last.key);
          }}
        />
      )}
    </div>
  );
}

/** Prefixes a conversation's key in `meta.entryKey`, where a character's is `character/{slug}` */
const talkPrefix = "talk/";
const sectionClass = "text-zinc-500 uppercase text-[10px]";
/** Files are only writable through the DEV server */
const editable = import.meta.env.DEV;
const bareButtonClass = "shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-100";
/** After the last edit, how long until it saves itself */
const autosaveMs = 800;
/** In px at 100% text: narrower, the columns stack */
const wideWidth = 520;
const zoomStep = 0.1;
const minZoom = 0.7;
const maxZoom = 2;

type State = {
  entries: Record<string, LoreEntry>;
  error: null | string;
  /** The entry shown, as edited */
  draft: null | LoreEntry;
  dirty: boolean;
  /** Counts edits, so a save knows whether more came whilst it was under way */
  rev: number;
  saveTimer: undefined | ReturnType<typeof setTimeout>;
  newSlug: string;
  load(): Promise<void>;
  /** Replaces the draft by what is on disk */
  show(key: string | undefined): void;
  select(key: string): void;
  zoomBy(delta: number): void;
  /** Their npc in the World, if there, is respawned under the new key */
  setNpcKey(npcKey: string | undefined): Promise<void>;
  /** Their npc in the World, if there, takes it */
  setSkin(skin: string | undefined): void;
  patch(partial: Partial<LoreEntry>): void;
  save(): Promise<void>;
  remove(): Promise<void>;
  add(): Promise<void>;
  /** Centre the map on their npc, else their room */
  locate(entry: LoreEntry): void;
};
