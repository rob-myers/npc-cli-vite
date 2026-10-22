import type { WorldState } from "@npc-cli/ui__world";
import type { SpotsFile } from "@npc-cli/ui__world/spot.schema";
import { CrosshairIcon, XIcon } from "@phosphor-icons/react";
import { Fragment } from "react";
import { inkOf, type SpotPick } from "./use-spots";

/** The chosen spot's fields, naming rooms, doors, decor and obstacles as the World does — see `docs/spots.md` */
export function SpotCard({ w, file, pick, onChoose, onLocate }: Props) {
  const spot = file.spots[pick.id];
  const gm = w.gms[pick.gmId];
  if (spot === undefined || gm === undefined) return null;

  const g = `g${pick.gmId}`;
  const { a, b, c, d, e, f } = gm.transform;
  const at = { x: a * spot.x + c * spot.y + e, y: b * spot.x + d * spot.y + f };
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
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin border-r border-zinc-800 p-2 text-xs">
      <div className="flex items-center gap-1 mb-1">
        <span className="size-2 rounded-full" style={{ background: inkOf[spot.kind] }} />
        <span className="font-mono flex-1" title="its key, as jsh takes it e.g. `spot g0s12`">
          {spot.kind} {g}s{spot.id}
        </span>
        <button type="button" className={iconButton} title="centre the map on it" onClick={() => onLocate(at)}>
          <CrosshairIcon />
        </button>
        <button type="button" className={iconButton} title="close" onClick={() => onChoose(null)}>
          <XIcon />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 [&>dt]:text-zinc-500">
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
        <dt className="col-span-2 mt-1 text-zinc-400">near</dt>
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
      {props.id}
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

const iconButton = "p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800";

type Props = {
  w: WorldState;
  file: SpotsFile;
  pick: SpotPick;
  onChoose(pick: null | SpotPick): void;
  onLocate(at: Geom.VectJson): void;
};
