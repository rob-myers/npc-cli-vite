import { Dialog } from "@base-ui/react/dialog";
import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import { Rect } from "@npc-cli/util/geom/rect";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/**
 * The World's rooms from above, each pressed to toggle it: its map and rooms become a scenario's play area.
 * Shown inside the panel (`container`), not over the whole page
 */
export function RoomPicker({ w, container, open, rooms, onOpenChange, onDone }: Props) {
  const [picked, setPicked] = useState(rooms);
  useEffect(() => void (open && setPicked(rooms)), [open]);

  const bounds = Rect.fromRects(...w.gms.map((gm) => gm.gridRect));
  const toggle = (grKey: string) =>
    setPicked((prev) => (prev.includes(grKey) ? prev.filter((k) => k !== grKey) : [...prev, grKey]));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-20 bg-black/60" />
        <Dialog.Popup className="absolute inset-2 z-20 flex flex-col rounded-lg overflow-hidden border border-zinc-700 bg-zinc-950 text-zinc-300 text-xs">
          <div className="flex items-center gap-2 pl-4 pr-2 py-2 border-b border-zinc-800">
            <Dialog.Title className="mr-auto text-zinc-100">
              Rooms on {w.mapKey}: {picked.length === 0 ? "none" : picked.join(" ")}
            </Dialog.Title>
            <button
              type="button"
              className="px-2 py-1 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-800"
              onClick={() => onDone(picked)}
            >
              done
            </button>
            <Dialog.Close className="grid place-items-center size-7 rounded cursor-pointer hover:bg-zinc-800">
              <XIcon />
            </Dialog.Close>
          </div>
          <svg className="flex-1 min-h-0" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
            {w.gms.map((gm, gmId) => {
              const { a, b, c, d, e, f } = gm.transform;
              return (
                <g key={gmId} transform={`matrix(${a},${b},${c},${d},${e},${f})`}>
                  <path d={gm.hullPoly.map((p) => p.svgPath).join(" ")} className="fill-zinc-900" fillRule="evenodd" />
                  {gm.rooms.map((room, roomId) => {
                    const grKey = `g${gmId}r${roomId}`;
                    return (
                      <path
                        key={grKey}
                        d={room.svgPath}
                        className={cn(
                          "cursor-pointer stroke-zinc-600",
                          picked.includes(grKey) ? "fill-amber-300/60" : "fill-zinc-800 hover:fill-zinc-700",
                        )}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        onClick={() => toggle(grKey)}
                      >
                        <title>{grKey}</title>
                      </path>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Props = {
  w: WorldState;
  /** The panel's root, which it is drawn inside */
  container: null | HTMLElement;
  open: boolean;
  rooms: string[];
  onOpenChange(open: boolean): void;
  onDone(rooms: string[]): void;
};
