import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";

/**
 * A scenario's phases across and roles down, each cell the lines its npcs run. Narrow, a block per phase.
 * Whilst it runs, `phase` is marked, and each npc is a chip in the cell it is running
 */
export function PhaseGrid({ def, phase, chips }: Props) {
  const roles = Object.keys(def.cells);
  const cell = (role: string, key: string) => (
    <>
      {(def.cells[role]?.[key] ?? []).map((line, i) => (
        <div key={i} className="font-mono wrap-break-word">
          {line}
        </div>
      ))}
      {(chips?.[role]?.[key] ?? []).map((npcKey) => (
        <span key={npcKey} className="inline-block mt-1 mr-1 px-1 rounded bg-zinc-700 text-zinc-100">
          {npcKey}
        </span>
      ))}
    </>
  );

  return (
    <div className="@container">
      {/* wide: the table, its lines wrapping rather than scrolling */}
      <table className="hidden @lg:table w-full table-fixed border-collapse text-left">
        <thead>
          <tr>
            <th className="w-16" />
            {def.phases.map((p) => (
              <th
                key={p.key}
                title={`until ${p.until}`}
                className={cn(phaseTitleClass, "px-1 py-1", p.key === phase ? "text-zinc-100" : "text-zinc-400")}
              >
                {p.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role} className="border-t border-zinc-800 align-top">
              <th className="px-1 py-1 font-normal text-zinc-500 wrap-break-word">{role}</th>
              {def.phases.map((p) => (
                <td key={p.key} className={cn("px-1 py-1", p.key === phase && "bg-zinc-900")}>
                  {cell(role, p.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* narrow: a block per phase, its roles beneath */}
      <div className="@lg:hidden flex flex-col gap-2">
        {def.phases.map((p) => (
          <div key={p.key} className={cn("px-1 pt-1 border-t border-zinc-700", p.key === phase && "bg-zinc-900")}>
            <div
              title={`until ${p.until}`}
              className={cn(phaseTitleClass, "mb-0.5", p.key === phase ? "text-zinc-100" : "text-zinc-400")}
            >
              {p.key}
            </div>
            {roles.map((role) => (
              <div key={role} className="grid grid-cols-[4rem_1fr] gap-x-2">
                <span className="text-zinc-500 truncate">{role}</span>
                <div className="min-w-0">{cell(role, p.key)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const phaseTitleClass = "font-semibold uppercase tracking-wider text-[10px]";

type Props = {
  def: ScenarioDef;
  /** The phase an instance is in */
  phase?: string;
  /** By role, then phase: the npcs there */
  chips?: Record<string, Record<string, string[]>>;
};
