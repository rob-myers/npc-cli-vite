import type { LoreEntry } from "@npc-cli/ui__manifest/lore-schema";
import type { WorldState } from "@npc-cli/ui__world";
import { helper } from "@npc-cli/ui__world/helper";

/** On the map, the rooms and doors the Manifest's entry has on this World's map */
export function ManifestLoreLayer({ w, entry }: { w: WorldState; entry: LoreEntry }) {
  const here = entry.maps[w.mapKey];
  if (here === undefined) return null;
  return (
    <g pointerEvents="none">
      {here.rooms.map((grKey) => {
        const { gmId, roomId } = helper.getGmRoomId(grKey as Geomorph.GmRoomKey);
        const gm = w.gms[gmId];
        const room = gm?.rooms[roomId];
        if (room === undefined) return null;
        const { a, b, c, d, e, f } = gm.transform;
        return (
          <path
            key={grKey}
            d={room.svgPath}
            transform={`matrix(${a},${b},${c},${d},${e},${f})`}
            fill={ink.room}
            stroke={ink.edge}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {here.doors.map((gdKey) => {
        const door = w.door?.byKey[gdKey as Geomorph.GmDoorKey];
        if (door === undefined) return null;
        return (
          <line
            key={gdKey}
            x1={door.src.x}
            y1={door.src.y}
            x2={door.dst.x}
            y2={door.dst.y}
            stroke={ink.edge}
            strokeWidth={6}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

const ink = { room: "var(--deco-manifest-lore-room)", edge: "var(--deco-manifest-lore-edge)" };
