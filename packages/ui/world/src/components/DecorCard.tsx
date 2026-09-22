import { Select } from "@base-ui/react/select";
import { cn } from "@npc-cli/util";
import {
  CaretDownIcon,
  CircleIcon,
  type Icon,
  MapPinIcon,
  MonitorIcon,
  PlusIcon,
  RectangleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { State as WorldState } from "./World";

/**
 * A runtime decor's editor, shown over it by `DecorInspector`: its own fields, its `meta`, and a
 * delete. Every commit is one `w.decor.create(def)`, which replaces the decor and is persisted.
 * Rendered through `w.html`, a React root of its own — hence `w` as a prop, not from context
 */
export function DecorCard({
  w,
  decorKey,
  onRenamed,
}: {
  w: WorldState;
  decorKey: string;
  onRenamed(next: string): void;
}) {
  const def = w.decor.runtime.defByKey[decorKey];
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (confirming === false) return;
    const timeoutId = window.setTimeout(() => setConfirming(false), confirmMs); // lest a much later press delete
    return () => window.clearTimeout(timeoutId);
  }, [confirming]);

  if (def === undefined) return null;

  const commit = (next: Geomorph.DecorDef) => void w.decor.create(next);
  const meta = def.meta ?? {};
  const setMeta = (next: Meta) => commit({ ...def, meta: next });
  const TypeIcon = typeIcon[def.type];

  return (
    <div
      className="pointer-events-auto flex max-h-[22rem] w-(--html-width,30rem) flex-col gap-3 overflow-auto rounded-2xl border-4 border-white/40 bg-black/75 px-5 py-4 text-[1.6rem] text-white/90"
      // the World reads keys off its root e.g. `f`, `1`: not whilst typing here. Escape goes on up
      // to the frame, which closes the card
      onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <TypeIcon className="size-9 shrink-0 text-white/80" weight="duotone" />
        <Field
          className="flex-1 font-medium"
          value={def.key}
          onCommit={(next) => w.decor.rename(def.key, next.trim()) && onRenamed(next.trim())}
        />
        <span className="text-white/40">{String(w.decor.runtime.byKey[decorKey]?.meta.grKey ?? "no room")}</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
        {def.type === "point" && (
          <>
            <NumberRow label="x" value={def.x} onCommit={(x) => commit({ ...def, x })} />
            <NumberRow label="y" value={def.y} onCommit={(y) => commit({ ...def, y })} />
            <NumberRow label="orient°" value={def.orient ?? 0} onCommit={(orient) => commit({ ...def, orient })} />
            <NumberRow label="y3d" value={def.y3d ?? 0} onCommit={(y3d) => commit({ ...def, y3d })} />
            <ImgRow w={w} value={def.img} optional onCommit={(img) => commit({ ...def, img })} />
          </>
        )}
        {def.type === "rect" && (
          <>
            <NumberRow label="x" value={def.x} onCommit={(x) => commit({ ...def, x })} />
            <NumberRow label="y" value={def.y} onCommit={(y) => commit({ ...def, y })} />
            <NumberRow label="width" value={def.width} onCommit={(width) => commit({ ...def, width })} />
            <NumberRow label="height" value={def.height} onCommit={(height) => commit({ ...def, height })} />
            <NumberRow
              label="angle°"
              value={((def.angle ?? 0) * 180) / Math.PI}
              onCommit={(degrees) => commit({ ...def, angle: (degrees * Math.PI) / 180 })}
            />
          </>
        )}
        {def.type === "circle" && (
          <>
            <NumberRow
              label="x"
              value={def.center.x}
              onCommit={(x) => commit({ ...def, center: { ...def.center, x } })}
            />
            <NumberRow
              label="y"
              value={def.center.y}
              onCommit={(y) => commit({ ...def, center: { ...def.center, y } })}
            />
            <NumberRow label="radius" value={def.radius} onCommit={(radius) => commit({ ...def, radius })} />
          </>
        )}
        {def.type === "quad" && (
          <>
            <ImgRow w={w} value={def.img} onCommit={(img) => img !== undefined && commit({ ...def, img })} />
            <NumberRow label="y3d" value={def.y3d ?? 0} onCommit={(y3d) => commit({ ...def, y3d })} />
            <Label>color</Label>
            <Field
              value={def.color ?? ""}
              onCommit={(color) => commit({ ...def, color: color === "" ? undefined : color })}
            />
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-white/20 pt-3">
        <div className="text-[1.3rem] text-white/50">meta</div>
        {Object.entries(meta)
          .filter(([k]) => hiddenMeta.has(k) === false)
          .map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-white/70">{k}</span>
              <Field className="flex-1" value={toText(v)} onCommit={(text) => setMeta({ ...meta, [k]: parse(text) })} />
              <IconButton icon={XIcon} title={`remove ${k}`} onClick={() => setMeta(omit(meta, k))} />
            </div>
          ))}
        <AddMeta taken={meta} onAdd={(k, v) => setMeta({ ...meta, [k]: v })} />
      </div>

      <button
        type="button"
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-1 cursor-pointer",
          confirming
            ? "border-red-400 bg-red-500/20 text-red-200"
            : "border-white/20 text-white/60 hover:border-red-400/70",
        )}
        onClick={() => (confirming ? w.decor.remove(decorKey) : setConfirming(true))}
      >
        <TrashIcon className="size-7" />
        {confirming ? "press again to delete" : "delete"}
      </button>
    </div>
  );
}

/** A text field which commits on Enter or blur, and gives up on Escape */
function Field({ value, onCommit, className }: { value: string; onCommit(next: string): void; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]); // the decor was edited elsewhere e.g. on the 2D map
  return (
    <input
      className={cn(
        "min-w-0 rounded-lg border-2 border-white/20 bg-black/50 px-2 py-0.5 outline-none focus:border-white/60",
        className,
      )}
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        // Escape gives up an edit; with none to give up it is the card's, and closes it
        if (e.key === "Escape" && text !== value) {
          e.stopPropagation();
          setText(value);
        }
      }}
    />
  );
}

function NumberRow({ label, value, onCommit }: { label: string; value: number; onCommit(next: number): void }) {
  return (
    <>
      <Label>{label}</Label>
      <Field
        value={String(Math.round(value * 1000) / 1000)}
        onCommit={(text) => Number.isFinite(Number(text)) && text.trim() !== "" && onCommit(Number(text))}
      />
    </>
  );
}

/**
 * One of the decor sheet's images, or — where the def allows — none. Base UI's select, since a
 * native one does not open inside `Html3d`; its popup is portalled to the World's root, clear of
 * the card's scaling, so it is sized as the World's own menus are
 */
function ImgRow(props: {
  w: WorldState;
  value?: string;
  optional?: boolean;
  onCommit(next: string | undefined): void;
}) {
  const imgKeys = Object.keys(props.w.sheets?.decor ?? {});
  return (
    <>
      <Label>img</Label>
      <Select.Root
        value={props.value ?? noImg}
        onValueChange={(next) => props.onCommit(next === noImg || next === null ? undefined : next)}
      >
        <Select.Trigger className="flex min-w-0 items-center gap-2 rounded-lg border-2 border-white/20 bg-black/50 px-2 py-0.5 text-left outline-none cursor-pointer focus:border-white/60">
          <Select.Value className="min-w-0 flex-1 truncate">
            {(value: string) => (value === noImg ? "none" : value)}
          </Select.Value>
          <CaretDownIcon className="size-5 shrink-0 text-white/60" />
        </Select.Trigger>
        <Select.Portal container={props.w.rootEl}>
          <Select.Positioner className="z-70" sideOffset={4} align="start" alignItemWithTrigger={false}>
            <Select.Popup className="max-h-60 overflow-auto rounded border border-slate-700 bg-slate-800 py-1 text-xs text-slate-300 shadow-lg scrollbar-thin">
              {(props.optional === true ? [noImg, ...imgKeys] : imgKeys).map((imgKey) => (
                <Select.Item
                  key={imgKey}
                  value={imgKey}
                  className="flex items-center gap-2 px-3 py-1 cursor-pointer data-highlighted:bg-slate-700"
                >
                  {imgKey === noImg ? (
                    <span className="size-5" />
                  ) : (
                    <img className="size-5 object-contain" src={`/decor/${imgKey}.thumbnail.png`} alt="" />
                  )}
                  <Select.ItemText>{imgKey === noImg ? "none" : imgKey}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </>
  );
}

function AddMeta({ taken, onAdd }: { taken: Meta; onAdd(key: string, value: unknown): void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("true");
  const add = () => {
    const k = key.trim();
    if (k === "" || k in taken) return;
    onAdd(k, parse(value));
    setKey("");
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className="w-32 shrink-0 rounded-lg border-2 border-white/20 bg-black/50 px-2 py-0.5 outline-none focus:border-white/60"
        placeholder="key"
        list={suggestionsId}
        value={key}
        onChange={(e) => setKey(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <input
        className="min-w-0 flex-1 rounded-lg border-2 border-white/20 bg-black/50 px-2 py-0.5 outline-none focus:border-white/60"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <IconButton icon={PlusIcon} title="add" onClick={add} />
      <datalist id={suggestionsId}>
        {knownMeta
          .filter((k) => !(k in taken))
          .map((k) => (
            <option key={k} value={k} />
          ))}
      </datalist>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-white/60">{children}</span>;
}

function IconButton(props: { icon: Icon; title: string; onClick(): void }) {
  return (
    <button
      type="button"
      title={props.title}
      className="grid size-9 shrink-0 place-items-center rounded-lg border-2 border-white/20 text-white/60 cursor-pointer hover:border-white/60 hover:text-white"
      onClick={props.onClick}
    >
      <props.icon className="size-6" />
    </button>
  );
}

/** JSON where it parses, so `true`, `3` and `{"a":1}` are themselves; else the text */
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const toText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function omit(meta: Meta, key: string): Meta {
  const { [key]: _, ...rest } = meta;
  return rest;
}

const typeIcon: Record<Geomorph.DecorDef["type"], Icon> = {
  point: MapPinIcon,
  rect: RectangleIcon,
  circle: CircleIcon,
  quad: MonitorIcon,
};

/** The keys the code gives a meaning to, offered when adding */
const knownMeta = ["shown", "collider", "do", "label", "tint", "color", "tilt", "h", "y", "inset", "noPersist"];
/** Set by `Decor` itself, and no business of whoever edits */
const hiddenMeta = new Set(["decor", "decorKey", "gmId", "roomId", "grKey", "point", "rect", "circle", "quad", "img"]);
/** Stands for "no image" in the select, whose values are strings */
const noImg = "";
const suggestionsId = "decor-card-meta-keys";
const confirmMs = 3000;
