import type { WorldState } from "@npc-cli/ui__world";
import { helper } from "@npc-cli/ui__world/helper";
import { useWorld } from "@npc-cli/ui__world/use-world";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { Picker as BasePicker } from "@npc-cli/util/picker";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  FloppyDiskIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Allotment } from "allotment";
import stringify from "json-stringify-pretty-compact";
import { useContext, useEffect, useRef, useState } from "react";
import { GrammarEditor } from "./GrammarEditor";
import { deleteLoreEntry, loadLore, saveLoreEntry } from "./library";
import { type LoreEntry, type LoreKind, loreChangedEvent, loreKinds, loreSlugRe } from "./lore.schema";
import type { ManifestUiMeta } from "./schema";
import { manifestShared, useManifestShared } from "./shared";
import { expand, factsGrammar, type Grammar, mergeGrammars, seededRng } from "./tracery";

import "./manifest.css";

/**
 * The setting's lore: backstories and grammars, and a line of them said in a live World, should
 * there be one — see `docs/manifest-lore.md`
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
      grammarText: "{}",
      grammarError: null,
      newKind: "character",
      newSlug: "",
      rule: "origin",
      seed: 1,
      npcKey: null,

      async load() {
        try {
          const entries = await loadLore();
          state.set({ entries, error: null });
          // an edit under way is kept, and our own save left alone: re-showing would reformat the grammar
          const key = state.draft?.key ?? meta.entryKey;
          const same = key !== undefined && JSON.stringify(entries[key]) === JSON.stringify(state.draft);
          if (state.dirty === false && same === false) state.show(key);
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      show(key) {
        const entry = key === undefined ? undefined : state.entries[key];
        state.set({
          draft: entry === undefined ? null : structuredClone(entry),
          dirty: false,
          grammarText: stringify(entry?.grammar ?? {}, { maxLength: grammarLineLength }),
          grammarError: null,
        });
      },
      select(key) {
        if (key === state.draft?.key) return;
        // what is typed is kept, bar a grammar that does not parse
        if (state.grammarError === null) state.dirty === true && state.save();
        else if (window.confirm("Discard the unparsed grammar?") === false) return;
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
      setGrammarText(grammarText) {
        try {
          const grammar = parseGrammar(grammarText);
          state.set({ grammarText, grammarError: null });
          state.patch({ grammar });
        } catch (e) {
          state.set({ grammarText, grammarError: e instanceof Error ? e.message : String(e), dirty: true });
        }
      },
      async save() {
        clearTimeout(state.saveTimer);
        if (state.draft === null || state.grammarError !== null || editable === false) return;
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
        const key = `${state.newKind}/${state.newSlug}`;
        if (loreSlugRe.test(state.newSlug) === false || key in state.entries) return;
        try {
          await saveLoreEntry({ ...emptyEntry, key, kind: state.newKind, title: state.newSlug });
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
      toggleFold(name, all) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          const d = draft as ManifestUiMeta;
          const folded = d.folded.includes(name);
          // every section goes the way the pressed one does
          if (all) d.folded = folded ? [] : [...sectionNames];
          else d.folded = folded ? d.folded.filter((x) => x !== name) : [...d.folded, name];
        });
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
  /** Room for three columns, which are then resizable; else they stack */
  const wide = width / zoom >= wideWidth;
  const npcKeys = Object.keys(w?.n ?? {});
  const npcKey =
    [state.npcKey, draft?.npcKey, mapNpcKey, w?.psi?.getTarget(), w?.player?.key].find(
      (key) => typeof key === "string" && npcKeys.includes(key),
    ) ?? null;

  const grammar = draft === null ? {} : toGrammar(entries, draft, w, npcKey);
  const rules = Object.keys(grammar).sort();
  const rule = rules.includes(state.rule) ? state.rule : (Object.keys(draft?.grammar ?? {})[0] ?? rules[0]);
  const samples =
    rule === undefined ? [] : sampleSeeds.map((i) => expand(grammar, rule, seededRng(state.seed * 1000 + i)));

  const hereKeys = draft === null || w === undefined ? undefined : draft.maps[w.mapKey];
  const keyCount = (hereKeys?.rooms.length ?? 0) + (hereKeys?.doors.length ?? 0) + (draft?.links.length ?? 0);
  const ruleCount = Object.keys(draft?.grammar ?? {}).length;

  const entriesCol = (
    <div className="p-3 flex flex-col gap-2">
      {loreKinds.map((kind) => {
        const ofKind = Object.values(entries).filter((e) => e.kind === kind);
        return (
          ofKind.length > 0 && (
            <div key={kind}>
              <div className="text-zinc-500 uppercase text-[10px]">{kind}</div>
              {ofKind.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  title={e.summary}
                  className={cn(
                    "block w-full text-left px-1 py-0.5 rounded cursor-pointer truncate",
                    e.key === draft?.key ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900",
                  )}
                  onClick={() => state.select(e.key)}
                >
                  {e.title || e.key}
                </button>
              ))}
            </div>
          )
        );
      })}
      {editable && (
        <div className="flex gap-1 mt-auto">
          <Picker value={state.newKind} options={loreKinds} onChange={(newKind) => state.set({ newKind })} />
          <input
            className={cn(inputClass, "min-w-0 flex-1")}
            placeholder="new-slug"
            value={state.newSlug}
            onChange={(e) => state.set({ newSlug: e.currentTarget.value })}
            onKeyDown={(e) => e.key === "Enter" && state.add()}
          />
          <IconButton title="add entry" icon={PlusIcon} onClick={state.add} />
        </div>
      )}
    </div>
  );
  const cardCol =
    draft === null ? (
      <div className="h-full grid place-items-center text-zinc-500 p-4">
        {state.error ?? (Object.keys(entries).length === 0 ? "no lore yet" : "choose an entry")}
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
                disabled={state.dirty === false || state.grammarError !== null}
                onClick={state.save}
              />
              <IconButton title="delete" icon={TrashIcon} onClick={state.remove} />
            </>
          )}
        </div>
        <Section name="about" hint={draft.title} folded={meta.folded} onToggle={state.toggleFold}>
          <input
            className={cn(inputClass, "text-zinc-100")}
            readOnly={!editable}
            placeholder="title"
            value={draft.title}
            onChange={(e) => state.patch({ title: e.currentTarget.value })}
          />
          <textarea
            // grows with its text; two rows where `field-sizing` is unsupported
            className={cn(inputClass, "field-sizing-content resize-none")}
            rows={2}
            readOnly={!editable}
            placeholder="summary"
            value={draft.summary}
            onChange={(e) => state.patch({ summary: e.currentTarget.value })}
          />
          {Object.entries(draft.facts).map(([key, value], i) => (
            // keyed by position: a key being typed must not remount its row
            <div key={i} className="flex items-center gap-1">
              <input
                className={cn(inputClass, "w-24")}
                readOnly={!editable}
                value={key}
                onChange={(e) => state.patch({ facts: withFact(draft.facts, i, e.currentTarget.value, value) })}
              />
              <input
                className={cn(inputClass, "flex-1 min-w-0")}
                readOnly={!editable}
                value={value}
                onChange={(e) => state.patch({ facts: withFact(draft.facts, i, key, e.currentTarget.value) })}
              />
              {editable && (
                <button
                  type="button"
                  title="remove fact"
                  className={bareButtonClass}
                  onClick={() => state.patch({ facts: withFact(draft.facts, i) })}
                >
                  <XIcon />
                </button>
              )}
            </div>
          ))}
          {editable && (
            <button
              type="button"
              className={cn(bareButtonClass, "self-start flex items-center gap-1")}
              onClick={() => state.patch({ facts: { ...draft.facts, [`fact${Object.keys(draft.facts).length}`]: "" } })}
            >
              <PlusIcon /> fact
            </button>
          )}
        </Section>
        <Section
          name="world"
          hint={[draft.npcKey, keyCount > 0 && `${keyCount} key${keyCount === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
          folded={meta.folded}
          onToggle={state.toggleFold}
        >
          {w !== undefined && draft.kind === "character" && (
            <NpcFields w={w} draft={draft} onNpcKey={state.setNpcKey} onSkin={state.setSkin} />
          )}
          <KeyBox w={w} draft={draft} entries={entries} onPatch={state.patch} onSelect={state.select} />
        </Section>
        <Section name="story" hint={draft.backstory} folded={meta.folded} onToggle={state.toggleFold}>
          <textarea
            className={cn(inputClass, "h-40 resize-y leading-relaxed")}
            readOnly={!editable}
            placeholder="backstory"
            value={draft.backstory}
            onChange={(e) => state.patch({ backstory: e.currentTarget.value })}
          />
          <textarea
            className={cn(inputClass, "h-12 resize-y")}
            readOnly={!editable}
            placeholder="voice: how they speak"
            value={draft.voice}
            onChange={(e) => state.patch({ voice: e.currentTarget.value })}
          />
        </Section>
        <Section
          name="grammar"
          hint={state.grammarError ?? `${ruleCount} rule${ruleCount === 1 ? "" : "s"}`}
          alert={state.grammarError !== null}
          folded={meta.folded}
          onToggle={state.toggleFold}
        >
          <GrammarEditor
            value={state.grammarText}
            invalid={state.grammarError !== null}
            readOnly={!editable}
            onChange={state.setGrammarText}
          />
          {state.grammarError !== null && <div className="text-red-400">{state.grammarError}</div>}
        </Section>
        {state.error !== null && <div className="text-red-400 break-all">{state.error}</div>}
      </div>
    );
  const previewCol = draft !== null && (
    <div className="p-3">
      <Section name="say" hint={rule ?? ""} folded={meta.folded} onToggle={state.toggleFold}>
        <div className="flex items-center gap-1 text-zinc-500">
          {w !== undefined && (
            <Picker
              value={npcKey ?? ""}
              options={npcKey === null ? [{ value: "", label: "no npc" }, ...npcKeys] : npcKeys}
              onChange={(npcKey) => state.set({ npcKey })}
            />
          )}
          {w !== undefined && "says"}
          <Picker value={rule ?? ""} options={rules} onChange={(rule) => state.set({ rule })} />
          <IconButton title="resample" icon={ArrowsClockwiseIcon} onClick={() => state.set({ seed: state.seed + 1 })} />
        </div>
        {samples.length > 0 && (
          // dragged shorter or taller by its corner, as the backstory is
          <div className="h-40 min-h-8 resize-y overflow-hidden rounded border border-zinc-800">
            {/* fades out at the foot, so more below is seen to be there; padded, so the last line clears it */}
            <div
              className="size-full overflow-auto scrollbar-thin flex flex-wrap content-start gap-1.5 p-1 pb-6"
              style={fadeFootStyle}
            >
              {samples.map((line, i) => {
                const speaker = w !== undefined ? npcKey : null;
                return (
                  <span
                    key={i}
                    title={speaker === null ? undefined : `${speaker} says it`}
                    className={cn(
                      "px-1.5 py-0.5 rounded bg-zinc-900 leading-relaxed select-text",
                      speaker !== null && "cursor-pointer hover:bg-zinc-800 hover:text-zinc-100",
                    )}
                    // a drag that selected text is a copy, not a click
                    onClick={() => {
                      if (speaker === null || window.getSelection()?.isCollapsed === false) return;
                      w?.speech.say(speaker, line);
                    }}
                  >
                    {line}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {rule === undefined && <div className="text-zinc-500">no grammar rules yet</div>}
      </Section>
    </div>
  );

  return (
    <div
      ref={root}
      className="manifest relative size-full bg-gray-950 text-zinc-300 text-xs tracking-wide leading-relaxed"
    >
      {/* over the pane, so in reach however far it has scrolled */}
      <div className="absolute z-10 top-1 right-1 flex items-center gap-1 px-1 rounded bg-gray-950/80 opacity-60 hover:opacity-100">
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
            <div className={columnClass} style={{ zoom }}>
              {cardCol}
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={180} preferredSize={300}>
            {/* clear of the zoom buttons */}
            <div className="size-full pt-8">
              <div className={columnClass} style={{ zoom }}>
                {previewCol}
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
      ) : (
        <div className={cn(columnClass, "divide-y divide-zinc-800")} style={{ zoom }}>
          {entriesCol}
          {cardCol}
          {previewCol}
        </div>
      )}
    </div>
  );
}

/** Setting, then linked entries, then this entry's facts and rules, then the World's — later wins */
function toGrammar(
  entries: Record<string, LoreEntry>,
  draft: LoreEntry,
  w: WorldState | undefined,
  npcKey: null | string,
): Grammar {
  const settings = Object.values(entries).filter((e) => e.kind === "setting" && e.key !== draft.key);
  const linked = draft.links.flatMap((key) => entries[key] ?? []);
  const world: Record<string, string> = {};
  if (npcKey !== null) world.npc = npcKey;
  const grKey = npcKey === null ? undefined : w?.npc.npcToRoom.get(npcKey)?.grKey;
  if (grKey !== undefined) world.room = grKey;
  if (typeof w?.player?.key === "string") world.player = w.player.key;
  return mergeGrammars(
    ...settings.map((e) => e.grammar),
    ...linked.map((e) => e.grammar),
    factsGrammar(draft.facts),
    draft.grammar,
    factsGrammar(world),
  );
}

function parseGrammar(text: string): Grammar {
  const json = JSON.parse(text);
  const ok =
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    Object.values(json).every((v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
  if (!ok) throw Error("expected { rule: [option, …] }");
  return json;
}

/** `facts` with its `index`th renamed or revalued, or without it — order kept */
function withFact(facts: Record<string, string>, index: number, key?: string, value?: string) {
  return Object.fromEntries(
    Object.entries(facts).flatMap((fact, i) =>
      i !== index ? [fact] : key === undefined || value === undefined ? [] : [[key, value]],
    ),
  );
}

/** A character's npc and skin in the World */
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
 * The keys an entry holds, as badges, and ONE box to add to them: a room's or a door's on this map,
 * or another entry's — each becomes a badge once it is found to exist, and what is not stays typed
 */
function KeyBox(props: {
  w: WorldState | undefined;
  draft: LoreEntry;
  entries: Record<string, LoreEntry>;
  onPatch(partial: Partial<LoreEntry>): void;
  onSelect(key: string): void;
}) {
  const { w, draft, entries } = props;
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const here = (w !== undefined && draft.maps[w.mapKey]) || { rooms: [], doors: [] };
  const isCharacter = draft.kind === "character";
  const held = { rooms: here.rooms, doors: here.doors, links: draft.links };

  const kindOf = (key: string): null | keyof typeof held => {
    if (key in entries) return key === draft.key ? null : "links";
    if (w === undefined) return null;
    if (isCharacter && w.door?.byKey[key as Geomorph.GmDoorKey] !== undefined) return "doors";
    return hasRoom(w, key) ? "rooms" : null;
  };
  const apply = ({ rooms, doors, links }: typeof held) =>
    props.onPatch({
      links,
      // per map, and so only with one
      ...(w !== undefined && { maps: { ...draft.maps, [w.mapKey]: { rooms, doors } } }),
    });
  const commit = (typed: string) => {
    const next = { rooms: [...held.rooms], doors: [...held.doors], links: [...held.links] };
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
    ...held.links.map((key) => ({
      key,
      kind: "links" as const,
      known: key in entries,
      title: entries[key]?.title ?? "",
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
          title={known ? title : kind === "links" ? "no such entry" : "not on this map"}
          className={cn("flex items-center gap-1 px-1 rounded border border-zinc-700", !known && "text-red-400")}
        >
          {kind === "links" ? (
            <button type="button" className="cursor-pointer hover:text-zinc-100" onClick={() => props.onSelect(key)}>
              {key}
            </button>
          ) : (
            key
          )}
          {editable && (
            <button type="button" title="remove" className={bareButtonClass} onClick={() => remove(kind, key)}>
              <XIcon />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          className="flex-1 min-w-24 bg-transparent outline-none"
          placeholder={badges.length === 0 ? keyBoxHint(w !== undefined, isCharacter) : ""}
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

/** What the box takes, by what there is to name */
function keyBoxHint(hasWorld: boolean, isCharacter: boolean) {
  const world = hasWorld ? (isCharacter ? "g0r1 g0d29 " : "g0r1 ") : "";
  return `${world}place/dock`;
}

/** A group of the card's fields, under a header which folds it away — `hint` is what a folded one says */
function Section(props: {
  name: SectionName;
  hint: string;
  /** Shown even folded, e.g. a grammar which does not parse */
  alert?: boolean;
  folded: string[];
  onToggle(name: SectionName, all: boolean): void;
  children: React.ReactNode;
}) {
  const folded = props.folded.includes(props.name);
  const Caret = folded ? CaretRightIcon : CaretDownIcon;
  return (
    // shaded by `data-section` — see `manifest.css`
    <div className="manifest-section flex flex-col gap-1 rounded px-2 py-1.5" data-section={props.name}>
      <button
        type="button"
        className="flex items-center gap-1 min-w-0 text-left cursor-pointer text-zinc-500 hover:text-zinc-300"
        title="alt-click folds or unfolds them all"
        onClick={(e) => {
          const header = e.currentTarget;
          props.onToggle(props.name, e.altKey);
          // they all moved: back to the one pressed, once that has been laid out
          if (e.altKey)
            requestAnimationFrame(() => requestAnimationFrame(() => header.scrollIntoView({ block: "start" })));
        }}
      >
        <Caret className="size-3 shrink-0" />
        <span className="pr-2 text-[10px] uppercase">{props.name}</span>
        {(folded || props.alert === true) && (
          <span className={cn("truncate", props.alert === true ? "text-red-400" : "text-zinc-400")}>{props.hint}</span>
        )}
      </button>
      {folded === false && props.children}
    </div>
  );
}

function IconButton(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className="grid place-items-center size-6 shrink-0 rounded border border-zinc-800 text-zinc-400 cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default"
      onClick={props.onClick}
    >
      <props.icon className="size-3.5" />
    </button>
  );
}

/** Files are only writable through the DEV server */
const editable = import.meta.env.DEV;
const inputClass = "px-2 py-1 rounded border border-zinc-800 bg-zinc-900 outline-none focus:border-zinc-600";
const fadeFootStyle = { maskImage: "linear-gradient(to bottom, black calc(100% - 1.5rem), transparent)" };
const bareButtonClass = "shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-100";
/** After the last edit, how long until it saves itself */
const autosaveMs = 800;
/** A short rule stays on one line */
const grammarLineLength = 96;
const columnClass = "size-full overflow-auto scrollbar-thin";
/** In px at 100% text: narrower, the three columns stack */
const wideWidth = 768;
const zoomStep = 0.1;
const minZoom = 0.7;
const maxZoom = 2;
const sampleSeeds = [0, 1, 2, 3, 4, 5, 6, 7];
const emptyEntry = { title: "", summary: "", backstory: "", voice: "", maps: {}, facts: {}, links: [], grammar: {} };

const sectionNames = ["about", "world", "story", "grammar", "say"] as const;
type SectionName = (typeof sectionNames)[number];

type State = {
  entries: Record<string, LoreEntry>;
  error: null | string;
  /** The entry shown, as edited */
  draft: null | LoreEntry;
  dirty: boolean;
  /** Counts edits, so a save knows whether more came whilst it was under way */
  rev: number;
  saveTimer: undefined | ReturnType<typeof setTimeout>;
  grammarText: string;
  grammarError: null | string;
  newKind: LoreKind;
  newSlug: string;
  /** The rule sampled */
  rule: string;
  seed: number;
  /** Who says a line, when chosen here */
  npcKey: null | string;
  load(): Promise<void>;
  /** Replaces the draft by what is on disk */
  show(key: string | undefined): void;
  select(key: string): void;
  /** Folds a section of the card, or unfolds it — `all` of them, its way. Kept in `meta.folded` */
  toggleFold(name: SectionName, all: boolean): void;
  zoomBy(delta: number): void;
  /** Their npc in the World, if there, is respawned under the new key */
  setNpcKey(npcKey: string | undefined): Promise<void>;
  /** Their npc in the World, if there, takes it */
  setSkin(skin: string | undefined): void;
  patch(partial: Partial<LoreEntry>): void;
  setGrammarText(text: string): void;
  save(): Promise<void>;
  remove(): Promise<void>;
  add(): Promise<void>;
  /** Centre the map on the entry's npc, else its room */
  locate(entry: LoreEntry): void;
};

/** Its popup is portalled out of the panel, so it is told whose theme to take */
function Picker<T extends string>(props: Omit<Parameters<typeof BasePicker<T>>[0], "popupClassName">) {
  return <BasePicker {...props} popupClassName="manifest" />;
}
