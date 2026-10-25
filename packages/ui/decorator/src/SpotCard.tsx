import type { WorldState } from "@npc-cli/ui__world";
import { type SpotsFile, spotAliasesOf } from "@npc-cli/ui__world/spot.schema";
import { cn } from "@npc-cli/util";
import { CheckIcon, CopyIcon, CrosshairIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { Fragment, useState } from "react";
import { inkOf, parseSpotPick, type SpotPick, spotAlias, spotWorldPoint } from "./use-spots";

/** The chosen spot's fields, naming rooms, doors, decor and obstacles as the World does — see `docs/spots.md` */
export function SpotCard({ w, file, byGmKey, pick, onChoose, onLocate, onFind }: Props) {
  /** Whilst the header asks for another spot's key */
  const [searching, setSearching] = useState(false);
  const spot = file.spots[pick.id];
  const gm = w.gms[pick.gmId];
  if (spot === undefined || gm === undefined) return null;

  const g = `g${pick.gmId}`;
  const alias = spotAlias(file, pick);
  const at = spotWorldPoint(w, file, pick);
  const open = spot.depth.filter((r) => r >= file.radius).length;
  const chips = (ids: number[]) =>
    ids.length === 0 ? (
      <span className="text-zinc-600">none</span>
    ) : (
      <span className="flex flex-wrap gap-0.5">
        {ids.map((id) => (
          <SpotChip key={id} file={file} id={id} onClick={() => onChoose({ gmId: pick.gmId, id })} />
        ))}
      </span>
    );
  const list = (items: string[]) =>
    items.length === 0 ? <span className="text-zinc-600">none</span> : items.join(", ");
  const decorOf = (decorId: number) => describeDecor(gm.decor[decorId]);
  /** The decor it was made for, as the World and the shell name it */
  const decorKey = spot.ref?.decorId === undefined ? undefined : gm.decor[spot.ref.decorId]?.key;
  /** Hull doors its region may see the opening of, the door meeting each across, and the inner doors needed */
  const hullDoors = file.hull.flatMap(([doorId, seers]) => {
    const seer = seers.find(([id]) => id === spot.id);
    if (seer === undefined) return [];
    const inner = seer.slice(1).map((d) => `${g}d${d}`);
    const adj = w.gmGraph.getAdjacentRoomCtxt(pick.gmId, doorId);
    return [
      `${g}d${doorId}${adj === null ? "" : ` → ${adj.adjGdKey}`}${inner.length > 0 ? ` via ${inner.join(" ")}` : ""}`,
    ];
  });
  const obstacleOf = (obstacleId: number) => describeObstacle(gm.obstacles[obstacleId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin border-r border-zinc-800 p-3 text-xs flex flex-col gap-3">
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/70">
        <span className="size-2 rounded-full" style={{ background: inkOf[spot.kind] }} />
        {searching ? (
          <SpotKeyField
            w={w}
            byGmKey={byGmKey}
            autoFocus
            onFind={(next, nextAt) => {
              setSearching(false);
              onFind(next, nextAt);
            }}
            onCancel={() => setSearching(false)}
          />
        ) : (
          <span
            className="font-mono flex-1"
            title={`its key, as jsh takes it e.g. \`spot ${alias}\`, else ${g}s${spot.id}`}
          >
            <span className="font-semibold text-zinc-100">{alias}</span>{" "}
            <span className="text-zinc-400">{spot.kind}</span>
          </span>
        )}
        <button
          type="button"
          className={iconButton}
          title="go to another spot by key"
          onClick={() => setSearching(!searching)}
        >
          <MagnifyingGlassIcon />
        </button>
        <CopyButton text={alias} title="copy its key" />
        <button type="button" className={iconButton} title="centre the map on it" onClick={() => onLocate(at)}>
          <CrosshairIcon />
        </button>
        <button type="button" className={iconButton} title="close" onClick={() => onChoose(null)}>
          <XIcon />
        </button>
      </div>
      <dl className={sectionClass}>
        {decorKey !== undefined && (
          <>
            <dt>decor key</dt>
            <dd className="min-w-0 flex items-center gap-1">
              {/* long: it scrolls sideways rather than wrapping */}
              <span className="min-w-0 overflow-x-auto whitespace-nowrap scrollbar-thin font-mono select-all">
                {decorKey}
              </span>
              <CopyButton text={decorKey} title="copy the decor key" />
            </dd>
          </>
        )}
        <dt>room</dt>
        <dd className="font-mono">{spot.roomId === null ? "none" : `${g}r${spot.roomId}`}</dd>
        <dt>at</dt>
        <dd className="font-mono" title={`local ${spot.x}, ${spot.y}`}>
          {at.x.toFixed(2)}, {at.y.toFixed(2)}
        </dd>
        {spot.facing !== undefined && (
          <>
            <dt>facing</dt>
            <dd className="font-mono">{Math.round((spot.facing * 180) / Math.PI)}°</dd>
          </>
        )}
        {spot.ref !== undefined && (
          <>
            <dt>made for</dt>
            <dd>
              {list([
                ...(spot.ref.doorId === undefined ? [] : [`${g}d${spot.ref.doorId}`]),
                ...(spot.ref.decorId === undefined ? [] : [decorOf(spot.ref.decorId)]),
                ...(spot.ref.obstacleId === undefined ? [] : [obstacleOf(spot.ref.obstacleId)]),
              ])}
            </dd>
          </>
        )}
        <dt>depth</dt>
        <dd title={spot.depth.join(" ")}>
          {Math.min(...spot.depth)}–{Math.max(...spot.depth)}m, {open} of {file.angles} open
        </dd>
        <dt>always {spot.always.length}</dt>
        <dd>{chips(spot.always)}</dd>
        <dt>may {spot.sight.length}</dt>
        <dd>{chips(spot.sight)}</dd>
        {spot.via.map(([doorIds, ids]) => (
          <Fragment key={`${doorIds}`}>
            <dt className="font-mono">via {doorIds.map((doorId) => `${g}d${doorId}`).join(" ")}</dt>
            <dd>{chips(ids)}</dd>
          </Fragment>
        ))}
        {spot.kind === "doable" && (
          <>
            <dt title="seen by whoever sits or lies there, within its arc">from it {spot.doSight.length}</dt>
            <dd>{chips(spot.doSight)}</dd>
            {spot.doVia.map(([doorIds, ids]) => (
              <Fragment key={`do-${doorIds}`}>
                <dt className="font-mono">from it via {doorIds.map((doorId) => `${g}d${doorId}`).join(" ")}</dt>
                <dd>{chips(ids)}</dd>
              </Fragment>
            ))}
          </>
        )}
        {hullDoors.length > 0 && (
          <>
            <dt>hull doors</dt>
            <dd className="font-mono">{list(hullDoors)}</dd>
          </>
        )}
        <dt>doors seen</dt>
        <dd className="font-mono">{list(spot.seesDoors.map((doorId) => `${g}d${doorId}`))}</dd>
        {spot.kind === "cover" && (
          <>
            <dt>crouched, hidden from</dt>
            <dd>{chips(spot.crouchSafe)}</dd>
          </>
        )}
      </dl>
      <dl className={sectionClass}>
        <dt className="col-span-2 text-zinc-400">near</dt>
        <dt>doors</dt>
        <dd className="font-mono">{list(spot.near.doors.map((doorId) => `${g}d${doorId}`))}</dd>
        <dt>doables</dt>
        <dd>{list(spot.near.doables.map(decorOf))}</dd>
        <dt>decor</dt>
        <dd>{list(spot.near.decor.map(decorOf))}</dd>
        <dt>obstacles</dt>
        <dd>{list(spot.near.obstacles.map(obstacleOf))}</dd>
      </dl>
    </div>
  );
}

/** Copies `text`, ticked a moment once copied */
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={iconButton}
      title={title}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), copiedMs);
        })
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function SpotChip(props: { file: SpotsFile; id: number; suffix?: string; onClick(): void }) {
  const kind = props.file.spots[props.id]?.kind;
  return (
    <button
      type="button"
      className="px-1 rounded bg-zinc-800 hover:bg-zinc-700 font-mono border-l-2"
      style={{ borderColor: kind === undefined ? undefined : inkOf[kind] }}
      title={kind}
      onClick={props.onClick}
    >
      {spotAliasesOf(props.file)[props.id]}
      {props.suffix !== undefined && <span className="text-zinc-500"> {props.suffix}</span>}
    </button>
  );
}

/** A doable by what is done there, else a decor by its image */
function describeDecor(d: undefined | { type: string; meta: Meta }) {
  if (d === undefined) return "?";
  const img = typeof d.meta.img === "string" ? d.meta.img : d.type;
  return typeof d.meta.do === "string" ? `${d.meta.do} (${img})` : img;
}

/** By its symbol and its tags */
function describeObstacle(o: undefined | Geomorph.LayoutObstacle) {
  if (o === undefined) return "?";
  const tags = Object.keys(o.meta).filter((k) => o.meta[k] === true && k !== "obstacle");
  return `${o.symbolKey}${tags.length > 0 ? ` ${tags.join(" ")}` : ""} ${o.height}m`;
}

/** A field taking a spot's key, e.g. `g0r12-3` or `g0s455`: Enter chooses it, if this map has it */
export function SpotKeyField(props: {
  w: WorldState;
  byGmKey: undefined | Record<string, SpotsFile>;
  autoFocus?: boolean;
  onFind(pick: SpotPick, at: Geom.VectJson): void;
  onCancel?(): void;
}) {
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  return (
    <input
      autoFocus={props.autoFocus}
      className={cn(
        "min-w-0 flex-1 px-1.5 py-0.5 rounded border bg-zinc-950 font-mono outline-none",
        missing ? "border-red-500/70" : "border-zinc-700 focus:border-zinc-500",
      )}
      placeholder="spot key e.g. g0r12-3"
      value={text}
      onChange={(e) => {
        setText(e.currentTarget.value);
        setMissing(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // not the Editor's own keys
        if (e.key === "Escape") return props.onCancel?.();
        if (e.key !== "Enter") return;
        const pick = parseSpotPick(text, props.w, props.byGmKey);
        if (pick === null || props.byGmKey === undefined) return setMissing(true);
        props.onFind(pick, spotWorldPoint(props.w, props.byGmKey[props.w.gms[pick.gmId].key], pick));
      }}
    />
  );
}

const iconButton = "p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800";
/** How long the copy button shows its tick */
const copiedMs = 1200;
/** A section of the card: keys and values on a dark ground, each value scrolled on its own past 60px */
const sectionClass = cn(
  "shrink-0 grid grid-cols-[minmax(auto,5rem)_1fr] content-start gap-x-1.5 gap-y-1 [&>dt]:text-zinc-400 [&>*]:leading-tight",
  "[&>dd]:rounded [&>dt]:rounded [&>dd]:bg-zinc-900/70 [&>dt]:bg-zinc-900/70 [&>dd]:px-1.5 [&>dt]:px-1.5 [&>dd]:py-0.5 [&>dt]:py-0.5",
  "[&>dd]:max-h-[60px] [&>dd]:overflow-y-auto [&>dd]:scrollbar-thin",
  // each hugs its own text rather than filling its cell
  "[&>*]:self-start [&>*]:justify-self-start [&>dd]:max-w-full",
);

type Props = {
  w: WorldState;
  file: SpotsFile;
  /** Every geomorph's spots, for going to another by key */
  byGmKey: Record<string, SpotsFile>;
  pick: SpotPick;
  onChoose(pick: null | SpotPick): void;
  onLocate(at: Geom.VectJson): void;
  /** Chooses another spot, found by key, and centres on it */
  onFind(pick: SpotPick, at: Geom.VectJson): void;
};
