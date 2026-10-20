import type { WorldState } from "@npc-cli/ui__world";
import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { useState } from "react";
import { sectionClass } from "./classes";
import { PhaseGrid } from "./PhaseGrid";
import { RoomPicker } from "./RoomPicker";

/** A scenario's definition: its map and rooms, roles, params, and its phases by roles — see `docs/scenarios.md` */
export function ScenarioCard({ w, def, container, editable, onSave }: Props) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="p-3 flex flex-col gap-3">
      <div>
        <div className="text-zinc-100">
          {def.title} <span className="text-zinc-500">({def.short})</span>
        </div>
        {def.summary !== "" && <div className="text-zinc-500">{def.summary}</div>}
      </div>

      <Section title="area">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-zinc-500">{def.map}</span>
          {def.rooms.map((grKey) => (
            <span key={grKey} className="px-1 rounded border border-zinc-700">
              {grKey}
            </span>
          ))}
          {editable && w !== undefined && (
            <button
              type="button"
              className="px-1 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-800"
              onClick={() => setPicking(true)}
            >
              pick rooms
            </button>
          )}
        </div>
      </Section>

      <Section title="roles">
        {Object.entries(def.roles).map(([role, { count, skin }]) => (
          <div key={role}>
            <span className="text-zinc-100">{role}</span> ×{count}
            {skin !== undefined && <span className="text-zinc-500"> as {skin}</span>}
            {(def.cast[role]?.length ?? 0) > 0 && <span className="text-zinc-500"> · {def.cast[role].join(" ")}</span>}
          </div>
        ))}
      </Section>

      <Section title="params">
        <div className="font-mono">
          {Object.entries(def.params).map(([k, v]) => (
            <div key={k}>
              {k}: {JSON.stringify(v)}
            </div>
          ))}
        </div>
      </Section>

      <Section title="phases">
        <PhaseGrid def={def} />
      </Section>

      {w !== undefined && (
        <RoomPicker
          w={w}
          container={container}
          open={picking}
          rooms={w.mapKey === def.map ? def.rooms : []}
          onOpenChange={setPicking}
          onDone={(rooms) => {
            setPicking(false);
            onSave({ ...def, map: w.mapKey, rooms });
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={sectionClass}>{title}</div>
      {children}
    </div>
  );
}

type Props = {
  w: WorldState | undefined;
  def: ScenarioDef;
  /** The panel's root, which its modals are drawn inside */
  container: null | HTMLElement;
  /** Its file is writable, through the DEV server */
  editable: boolean;
  onSave(def: ScenarioDef): void;
};
