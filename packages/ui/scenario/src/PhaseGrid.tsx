import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";

/**
 * A scenario's phases across and roles down, each cell the lines its npcs run.
 * Whilst it runs, `phase` is marked, and each npc is a chip in the cell it is running
 */
export function PhaseGrid({ def, phase, chips }: Props) {
  const roles = Object.keys(def.cells);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="border-collapse text-left">
        <thead>
          <tr>
            <th />
            {def.phases.map((p) => (
              <th
                key={p.key}
                title={`until ${p.until}`}
                className={cn("px-2 py-1 font-normal", p.key === phase ? "text-zinc-100" : "text-zinc-500")}
              >
                {p.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role} className="border-t border-zinc-800 align-top">
              <th className="px-2 py-1 font-normal text-zinc-500">{role}</th>
              {def.phases.map((p) => (
                <td key={p.key} className={cn("px-2 py-1", p.key === phase && "bg-zinc-900")}>
                  {(def.cells[role]?.[p.key] ?? []).map((line, i) => (
                    <div key={i} className="font-mono whitespace-nowrap">
                      {line}
                    </div>
                  ))}
                  {(chips?.[role]?.[p.key] ?? []).map((npcKey) => (
                    <span key={npcKey} className="inline-block mt-1 mr-1 px-1 rounded bg-zinc-700 text-zinc-100">
                      {npcKey}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = {
  def: ScenarioDef;
  /** The phase an instance is in */
  phase?: string;
  /** By role, then phase: the npcs there */
  chips?: Record<string, Record<string, string[]>>;
};
