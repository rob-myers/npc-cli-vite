import type { WorldState } from "@npc-cli/ui__world";
import { helper } from "@npc-cli/ui__world/helper";
import type { CharacterEntry } from "@npc-cli/ui__world/scenario.schema";

/** On the map, the rooms and doors the Scenario panel's character has on this World's map */
export function CharacterLayer({ w, entry }: { w: WorldState; entry: CharacterEntry }) {
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

const ink = { room: "var(--deco-character-room)", edge: "var(--deco-character-edge)" };
