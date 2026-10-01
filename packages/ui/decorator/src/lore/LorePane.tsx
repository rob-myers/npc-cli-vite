import type { WorldState } from "@npc-cli/ui__world";
import { helper } from "@npc-cli/ui__world/helper";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  ArrowsClockwiseIcon,
  ChatCircleTextIcon,
  FloppyDiskIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import stringify from "json-stringify-pretty-compact";
import { useContext, useEffect, useState } from "react";
import type { DecoratorUiMeta } from "../schema";
import { GrammarEditor } from "./GrammarEditor";
import { deleteLoreEntry, loadLore, saveLoreEntry } from "./library";
import { type LoreEntry, type LoreKind, loreChangedEvent, loreKinds, loreSlugRe } from "./lore.schema";
import { expand, factsGrammar, type Grammar, mergeGrammars, seededRng } from "./tracery";

/** Backstories and grammars for the setting, and a line of them said in the World — see `docs/lore.md` */
export default function LorePane(props: Props) {
  const { meta, w } = props;
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
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as DecoratorUiMeta).entryKey = key));
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
          uiStoreApi.setUiMeta(meta.id, (draft) => {
            const d = draft as DecoratorUiMeta;
            d.npcKeys = d.npcKeys.flatMap((key) => (key !== prev ? key : (next ?? [])));
          });
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
          const d = draft as DecoratorUiMeta;
          d.loreZoom = Math.min(maxZoom, Math.max(minZoom, Math.round(((d.loreZoom ?? 1) + delta) * 10) / 10));
        });
      },
      locate(entry) {
        if (w === undefined) return;
        const npc = entry.npcKey === undefined ? undefined : w.n?.[entry.npcKey];
        if (npc !== undefined) return props.onLocate(npc.point.x, npc.point.y);
        const grKey = entry.maps[w.mapKey]?.rooms[0];
        if (grKey === undefined) return;
        const { gmId, roomId } = helper.getGmRoomId(grKey as Geomorph.GmRoomKey);
        const gm = w.gms[gmId];
        const room = gm?.rooms[roomId];
        if (room === undefined) return;
        const { x, y } = room.center;
        const { a, b, c, d, e, f } = gm.transform;
        props.onLocate(a * x + c * y + e, b * x + d * y + f);
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

  // the map pane draws the entry's rooms and doors, and can spawn its npc
  useEffect(() => {
    props.onEntry(state.draft === null ? null : { ...state.draft });
    return () => props.onEntry(null);
  }, [state.draft, state.rev]);

  // choosing an npc on the map shows their entry
  const mapNpcKey = meta.npcKeys[meta.npcKeys.length - 1];
  useEffect(() => {
    const entry = Object.values(state.entries).find((e) => mapNpcKey !== undefined && e.npcKey === mapNpcKey);
    if (entry !== undefined) state.select(entry.key);
  }, [mapNpcKey]);

  const { draft, entries } = state;
  const zoom = meta.loreZoom ?? 1;
  /** Its heading carries the zoom buttons */
  const firstKind = loreKinds.find((kind) => Object.values(entries).some((e) => e.kind === kind));
  const zoomButtons = (
    <div className="ml-auto flex items-center gap-1 normal-case text-xs">
      <span className="text-zinc-500">{Math.round(zoom * 100)}%</span>
      <IconButton title="smaller text" icon={MagnifyingGlassMinusIcon} onClick={() => state.zoomBy(-zoomStep)} />
      <IconButton title="larger text" icon={MagnifyingGlassPlusIcon} onClick={() => state.zoomBy(zoomStep)} />
    </div>
  );
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

  return (
    // `zoom` scales the text and everything sized by it; the breakpoints then see the narrower pane
    <div className="@container size-full bg-zinc-950 text-zinc-300 text-xs" style={{ zoom }}>
      <div className="size-full flex flex-col @3xl:flex-row overflow-auto @3xl:overflow-hidden scrollbar-thin">
        {/* entries */}
        <div className="shrink-0 @3xl:w-44 @3xl:overflow-auto border-b @3xl:border-b-0 @3xl:border-r border-zinc-800 p-2 flex flex-col gap-2 scrollbar-thin">
          {firstKind === undefined && zoomButtons}
          {loreKinds.map((kind) => {
            const ofKind = Object.values(entries).filter((e) => e.kind === kind);
            return (
              ofKind.length > 0 && (
                <div key={kind}>
                  <div className="flex items-center text-zinc-500 uppercase text-[10px]">
                    {kind}
                    {kind === firstKind && zoomButtons}
                  </div>
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
              <select
                className={inputClass}
                value={state.newKind}
                onChange={(e) => state.set({ newKind: e.currentTarget.value as LoreKind })}
              >
                {loreKinds.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
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

        {draft === null ? (
          <div className="flex-1 grid place-items-center text-zinc-500 p-4">
            {state.error ?? (Object.keys(entries).length === 0 ? "no lore yet" : "choose an entry")}
          </div>
        ) : (
          <>
            {/* card */}
            <div className="flex-1 min-w-0 @3xl:overflow-auto p-2 flex flex-col gap-2 scrollbar-thin">
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
              <Field label="title">
                <input
                  className={inputClass}
                  readOnly={!editable}
                  value={draft.title}
                  onChange={(e) => state.patch({ title: e.currentTarget.value })}
                />
              </Field>
              <Field label="summary">
                <textarea
                  // grows with its text; two rows where `field-sizing` is unsupported
                  className={cn(inputClass, "field-sizing-content resize-none")}
                  rows={2}
                  readOnly={!editable}
                  value={draft.summary}
                  onChange={(e) => state.patch({ summary: e.currentTarget.value })}
                />
              </Field>
              <Field label="facts">
                {Object.entries(draft.facts).map(([key, value], i) => (
                  // keyed by position: a key being typed must not remount its row
                  <div key={i} className="flex gap-1">
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
                      <IconButton
                        title="remove fact"
                        icon={XIcon}
                        onClick={() => state.patch({ facts: withFact(draft.facts, i) })}
                      />
                    )}
                  </div>
                ))}
                {editable && (
                  <IconButton
                    title="add fact"
                    icon={PlusIcon}
                    onClick={() =>
                      state.patch({ facts: { ...draft.facts, [`fact${Object.keys(draft.facts).length}`]: "" } })
                    }
                  />
                )}
              </Field>
              {w !== undefined && (
                <WorldFields
                  w={w}
                  draft={draft}
                  onPatch={state.patch}
                  onNpcKey={state.setNpcKey}
                  onSkin={state.setSkin}
                />
              )}
              <Field label="links">
                <div className="flex flex-wrap gap-1">
                  {draft.links.map((key) => (
                    <span key={key} className="flex items-center gap-1 px-1 rounded border border-zinc-800">
                      <button
                        type="button"
                        className="cursor-pointer hover:text-zinc-100"
                        onClick={() => state.select(key)}
                      >
                        {key}
                      </button>
                      {editable && (
                        <button
                          type="button"
                          title="unlink"
                          className="cursor-pointer text-zinc-500 hover:text-zinc-100"
                          onClick={() => state.patch({ links: draft.links.filter((k) => k !== key) })}
                        >
                          <XIcon />
                        </button>
                      )}
                    </span>
                  ))}
                  {editable && (
                    <select
                      className={inputClass}
                      value=""
                      onChange={(e) => state.patch({ links: [...draft.links, e.currentTarget.value] })}
                    >
                      <option value="">+ link</option>
                      {Object.keys(entries)
                        .filter((key) => key !== draft.key && !draft.links.includes(key))
                        .map((key) => (
                          <option key={key}>{key}</option>
                        ))}
                    </select>
                  )}
                </div>
              </Field>
              <Field label="backstory">
                <textarea
                  className={cn(inputClass, "h-40 resize-y leading-relaxed")}
                  readOnly={!editable}
                  value={draft.backstory}
                  onChange={(e) => state.patch({ backstory: e.currentTarget.value })}
                />
              </Field>
              <Field label="voice">
                <textarea
                  className={cn(inputClass, "h-12 resize-y")}
                  readOnly={!editable}
                  value={draft.voice}
                  onChange={(e) => state.patch({ voice: e.currentTarget.value })}
                />
              </Field>
              <Field label="grammar">
                <GrammarEditor
                  value={state.grammarText}
                  invalid={state.grammarError !== null}
                  readOnly={!editable}
                  onChange={state.setGrammarText}
                />
                {state.grammarError !== null && <div className="text-red-400">{state.grammarError}</div>}
              </Field>
              {state.error !== null && <div className="text-red-400 break-all">{state.error}</div>}
            </div>

            {/* preview */}
            <div className="shrink-0 @3xl:w-72 @3xl:overflow-auto border-t @3xl:border-t-0 @3xl:border-l border-zinc-800 p-2 flex flex-col gap-2 scrollbar-thin">
              <div className="flex items-center gap-1">
                <select
                  className={cn(inputClass, "flex-1 min-w-0")}
                  value={rule ?? ""}
                  onChange={(e) => state.set({ rule: e.currentTarget.value })}
                >
                  {rules.map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
                <IconButton
                  title="resample"
                  icon={ArrowsClockwiseIcon}
                  onClick={() => state.set({ seed: state.seed + 1 })}
                />
              </div>
              {w !== undefined && (
                <label className="flex items-center gap-1 text-zinc-500">
                  says
                  <select
                    className={cn(inputClass, "flex-1 min-w-0")}
                    value={npcKey ?? ""}
                    onChange={(e) => state.set({ npcKey: e.currentTarget.value })}
                  >
                    {npcKey === null && <option value="">no npc</option>}
                    {npcKeys.map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </select>
                </label>
              )}
              {samples.map((line, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="flex-1 leading-relaxed">{line}</span>
                  {w !== undefined && npcKey !== null && (
                    <IconButton
                      title={`${npcKey} says it`}
                      icon={ChatCircleTextIcon}
                      onClick={() => w.speech.say(npcKey, line)}
                    />
                  )}
                </div>
              ))}
              {rule === undefined && <div className="text-zinc-500">no grammar rules yet</div>}
            </div>
          </>
        )}
      </div>
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

/** What an entry has in the World: a character's npc, skin and doors, and anyone's rooms on this map */
function WorldFields(props: {
  w: WorldState;
  draft: LoreEntry;
  onPatch(partial: Partial<LoreEntry>): void;
  onNpcKey(npcKey: string | undefined): void;
  onSkin(skin: string | undefined): void;
}) {
  const { w, draft, onPatch } = props;
  const here = draft.maps[w.mapKey] ?? { rooms: [], doors: [] };
  const patchHere = (partial: Partial<typeof here>) =>
    onPatch({ maps: { ...draft.maps, [w.mapKey]: { ...here, ...partial } } });

  const roomLabels = new Map(
    Object.values(w.decor?.byKey ?? {})
      .filter(helper.isRoomLabel)
      .map((d) => [d.meta.grKey as string, d.meta.label]),
  );
  const rooms = w.gms.flatMap((gm, gmId) =>
    gm.rooms.map((_, roomId) => {
      const grKey = helper.getGmRoomKey(gmId, roomId);
      return { key: grKey as string, label: roomLabels.has(grKey) ? `${grKey} ${roomLabels.get(grKey)}` : grKey };
    }),
  );
  // their rooms' doors first: those are the ones they would hold keys to
  const near = new Set(here.rooms.flatMap((grKey) => roomDoorKeys(w, grKey)));
  const doors = Object.keys(w.door?.byKey ?? {})
    .sort((a, b) => Number(near.has(b)) - Number(near.has(a)))
    .map((key) => ({ key, label: near.has(key) ? `${key} (of their rooms)` : key }));
  const isCharacter = draft.kind === "character";

  return (
    <>
      {isCharacter && (
        <div className="flex gap-2">
          <Field label="npc">
            <NpcKeyInput key={draft.key} value={draft.npcKey ?? ""} onCommit={(v) => props.onNpcKey(v || undefined)} />
          </Field>
          <Field label="skin">
            <select
              className={inputClass}
              disabled={!editable}
              value={draft.skin ?? ""}
              onChange={(e) => props.onSkin(e.currentTarget.value || undefined)}
            >
              <option value="">default</option>
              {(w.npc?.skin.entries ?? []).map(({ key }) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <Field label={`rooms on ${w.mapKey}`}>
        <Chips items={here.rooms} options={rooms} add="+ room" onChange={(rooms) => patchHere({ rooms })} />
      </Field>
      {isCharacter && (
        <Field label={`door keys on ${w.mapKey}`}>
          <Chips items={here.doors} options={doors} add="+ door" onChange={(doors) => patchHere({ doors })} />
        </Field>
      )}
    </>
  );
}

/** Committed on enter or blur, not per keystroke: a commit renames their npc in the World */
function NpcKeyInput({ value, onCommit }: { value: string; onCommit(value: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <input
      className={cn(inputClass, "w-28")}
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

function roomDoorKeys(w: WorldState, grKey: string): string[] {
  const node = w.gmRoomGraph?.getNode(grKey as Geomorph.GmRoomKey) ?? null;
  return node === null ? [] : w.gmRoomGraph.getSuccs(node).flatMap((succ) => (succ.type === "door" ? succ.gdKey : []));
}

/** Keys as removable chips, and a select to add one of `options` */
function Chips(props: {
  items: string[];
  options: { key: string; label: string }[];
  add: string;
  onChange(items: string[]): void;
}) {
  const labels = new Map(props.options.map((o) => [o.key, o.label]));
  return (
    <div className="flex flex-wrap gap-1">
      {props.items.map((key) => (
        <span
          key={key}
          title={labels.get(key) ?? "not on this map"}
          className={cn(
            "flex items-center gap-1 px-1 rounded border border-zinc-800",
            !labels.has(key) && "text-red-400",
          )}
        >
          {key}
          {editable && (
            <button
              type="button"
              title="remove"
              className="cursor-pointer text-zinc-500 hover:text-zinc-100"
              onClick={() => props.onChange(props.items.filter((k) => k !== key))}
            >
              <XIcon />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <select
          className={inputClass}
          value=""
          onChange={(e) => props.onChange([...props.items, e.currentTarget.value])}
        >
          <option value="">{props.add}</option>
          {props.options
            .filter((o) => !props.items.includes(o.key))
            .map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-zinc-500 text-[10px] uppercase">{label}</span>
      {children}
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
const inputClass = "px-1 py-0.5 rounded border border-zinc-800 bg-zinc-900 outline-none focus:border-zinc-600";
/** After the last edit, how long until it saves itself */
const autosaveMs = 800;
/** A short rule stays on one line */
const grammarLineLength = 96;
const zoomStep = 0.1;
const minZoom = 0.7;
const maxZoom = 2;
const sampleSeeds = [0, 1, 2, 3, 4, 5, 6, 7];
const emptyEntry = { title: "", summary: "", backstory: "", voice: "", maps: {}, facts: {}, links: [], grammar: {} };

type Props = {
  meta: DecoratorUiMeta;
  /** Absent, nothing can be said or located */
  w: WorldState | undefined;
  /** The entry shown, as edited — a copy each time, so it can be compared by identity */
  onEntry(entry: null | LoreEntry): void;
  /** Centre the map pane on a world point */
  onLocate(x: number, y: number): void;
};

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
