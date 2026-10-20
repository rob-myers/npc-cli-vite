import { instanceStatus, type ScInstance } from "@npc-cli/cli/sc";
import type { WorldState } from "@npc-cli/ui__world";
import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { sectionClass } from "./classes";
import { PhaseGrid } from "./PhaseGrid";
import { PhaseMachine } from "./PhaseMachine";
import { RoomPicker } from "./RoomPicker";
import { chipsOf, runInTty, useRuns } from "./runs";
import type { CardPrefs } from "./schema";

/**
 * A scenario: run from its header, its phases by roles foremost, and its runs, area, roles and params folded away
 * — see `docs/scenarios.md`
 */
export function ScenarioCard(props: Props) {
  const { w, def, container, editable, sessionKey, zoom, prefs, onPrefs, onSave } = props;
  const view = prefs.phasesView ?? "grid"; // meta saved before it existed
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const runs = useRuns(w, def.key, sessionKey);
  /** The latest still running, shown in the header, and whose phase and npcs the grid shows */
  const shown = runs.filter((run) => instanceStatus(run) !== "ended").at(-1);
  const send = (src: string) => sessionKey !== undefined && runInTty(sessionKey, src);
  // on another map, it asks before switching
  const start = () => (w !== undefined && w.mapKey !== def.map ? setConfirming(true) : send(`sc run ${def.short}`));

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-zinc-100 text-sm" title={def.summary}>
            {def.title}
          </span>
          <span className="text-zinc-500">{def.short}</span>
          <button
            type="button"
            className={`${buttonClass} ml-auto`}
            title={sessionKey === undefined ? "no tty" : `sc run ${def.short} in ${sessionKey}`}
            disabled={sessionKey === undefined || w === undefined}
            onClick={start}
          >
            run
          </button>
        </div>
        {shown !== undefined && <RunRow run={shown} send={send} />}
      </div>

      <div className="flex flex-col gap-1">
        {/* one choice of two: the chosen one filled */}
        <div className="flex self-start rounded border border-zinc-700 overflow-hidden" role="radiogroup">
          {(["grid", "machine"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === view}
              className={cn(
                "px-2 py-0.5",
                v === view ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 cursor-pointer hover:bg-zinc-800",
              )}
              onClick={() => onPrefs({ phasesView: v })}
            >
              {v}
            </button>
          ))}
        </div>
        {view === "grid" ? (
          <PhaseGrid def={def} phase={shown?.phase} chips={shown === undefined ? undefined : chipsOf(shown)} />
        ) : (
          <PhaseMachine
            def={def}
            phase={shown?.phase}
            zoom={zoom}
            height={prefs.machineHeight}
            viewport={prefs.machineViewport}
            onHeight={(machineHeight) => onPrefs({ machineHeight })}
            onViewport={(machineViewport) => onPrefs({ machineViewport })}
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Fold title="runs" hint={runs.length === 0 ? "none" : String(runs.length)}>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} send={send} />
          ))}
        </Fold>

        <Fold title="area" hint={`${def.map} · ${def.rooms.length} rooms`}>
          <div className="flex flex-wrap items-center gap-1">
            {def.rooms.map((grKey) => (
              <span key={grKey} className="px-1 rounded border border-zinc-700">
                {grKey}
              </span>
            ))}
            {editable && w !== undefined && (
              <button type="button" className={buttonClass} onClick={() => setPicking(true)}>
                pick rooms
              </button>
            )}
          </div>
        </Fold>

        <Fold
          title="roles"
          hint={Object.entries(def.roles)
            .map(([role, r]) => `${role} ×${r.count}`)
            .join(", ")}
        >
          {Object.entries(def.roles).map(([role, { count, skin }]) => (
            <div key={role}>
              <span className="text-zinc-100">{role}</span> ×{count}
              {skin !== undefined && <span className="text-zinc-500"> as {skin}</span>}
              {(def.cast[role]?.length ?? 0) > 0 && (
                <span className="text-zinc-500"> · {def.cast[role].join(" ")}</span>
              )}
            </div>
          ))}
        </Fold>

        <Fold title="params" hint={String(Object.keys(def.params).length)}>
          <div className="font-mono">
            {Object.entries(def.params).map(([k, v]) => (
              <div key={k}>
                {k}: {JSON.stringify(v)}
              </div>
            ))}
          </div>
        </Fold>
      </div>

      <ConfirmDialog
        container={container}
        open={confirming}
        text={`Switch the World from ${w?.mapKey} to ${def.map}?`}
        yes="switch and run"
        onOpenChange={setConfirming}
        onYes={() => {
          setConfirming(false);
          send(`sc run ${def.short} --switch`);
        }}
      />

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

/** A run's id, phase and status, and what can be done to it, each a `sc` command in its tty */
function RunRow({ run, send }: { run: ScInstance; send(src: string): void }) {
  const status = instanceStatus(run);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="font-mono text-zinc-100">{run.id}</span>
      <span className="text-zinc-500 mr-1">
        {run.phase} · {status}
      </span>
      {status === "running" && (
        <button type="button" className={buttonClass} onClick={() => send(`sc pause id:${run.id}`)}>
          pause
        </button>
      )}
      {status.endsWith("paused") && (
        <button type="button" className={buttonClass} onClick={() => send(`sc resume id:${run.id}`)}>
          resume
        </button>
      )}
      <button type="button" className={buttonClass} onClick={() => send(`sc kill id:${run.id}`)}>
        {status === "ended" ? "clear" : "kill"}
      </button>
    </div>
  );
}

/** A section folded away until opened, its `hint` beside its title */
function Fold({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1 cursor-pointer list-none select-none">
        <CaretRightIcon className="size-2.5 text-zinc-500 transition-transform group-open:rotate-90" />
        <span className={sectionClass}>{title}</span>
        <span className="text-zinc-600 truncate">{hint}</span>
      </summary>
      <div className="pl-3.5 pt-1">{children}</div>
    </details>
  );
}

const buttonClass =
  "px-1 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default";

type Props = {
  w: WorldState | undefined;
  def: ScenarioDef;
  /** The panel's root, which its modals are drawn inside */
  container: null | HTMLElement;
  /** Its file is writable, through the DEV server */
  editable: boolean;
  /** The tty its runs are started in */
  sessionKey: undefined | string;
  /** The panel's text zoom */
  zoom: number;
  /** What it keeps in the panel's meta, e.g. grid or machine */
  prefs: CardPrefs;
  onPrefs(patch: Partial<CardPrefs>): void;
  onSave(def: ScenarioDef): void;
};
