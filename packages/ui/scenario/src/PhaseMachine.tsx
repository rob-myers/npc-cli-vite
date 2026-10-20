import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn } from "@npc-cli/util";
import {
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type Viewport,
} from "@xyflow/react";
import { useContext, useMemo } from "react";

import "@xyflow/react/dist/style.css";

/**
 * A scenario as state machines: its phases top to bottom, each listing its roles' lines (Moore), joined by
 * their `until`; and beside them its roles, joined where a rule moves an npc from one to another
 */
export function PhaseMachine({ def, phase, zoom, height, viewport, onHeight, onViewport }: Props) {
  const { theme } = useContext(UiContext);
  const { nodes, edges } = useMemo(() => toGraph(def, phase), [def, phase]);

  return (
    // the panel's text zoom undone: CSS `zoom` skews react-flow's measures, and it has a zoom of its own
    <div
      className="w-full min-h-40 resize-y overflow-hidden rounded border border-zinc-800"
      style={{ zoom: 1 / zoom, height: height ?? flowHeight * zoom }}
      // a drag of its corner sets its height inline, and ends here
      onMouseUp={(e) => {
        const next = Math.round(Number.parseFloat(e.currentTarget.style.height));
        if (Number.isFinite(next) && next !== height) onHeight(next);
      }}
    >
      <ReactFlow
        // as last left, else centred on the start
        defaultViewport={viewport}
        fitView={viewport === undefined}
        fitViewOptions={{ nodes: [{ id: `phase:${def.phases[0]?.key}` }], minZoom: focusZoom, maxZoom: focusZoom }}
        onMoveEnd={(_, next) => onViewport(next)}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme === "light" ? "light" : "dark"}
        nodesConnectable={false}
        // the wheel scrolls the card, not the diagram: its buttons, or a pinch, zoom it
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function PhaseNode({ data }: NodeProps<PhaseNode>) {
  return (
    <div
      className={cn(
        "w-56 rounded border px-2 py-1 text-[10px] leading-snug bg-zinc-900 text-zinc-300",
        data.current ? "border-zinc-200" : "border-zinc-700",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className={cn("font-semibold uppercase tracking-wider", data.current ? "text-zinc-100" : "text-zinc-400")}>
        {data.label}
      </div>
      {data.cells.map(([role, lines]) => (
        <div key={role} className="font-mono">
          <span className="text-zinc-500">{role}</span> {lines.join("; ")}
        </div>
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function RoleNode({ data }: NodeProps<RoleNode>) {
  return (
    <div className="rounded-full border border-zinc-600 px-3 py-1 text-[10px] bg-zinc-900 text-zinc-100">
      <Handle type="target" position={Position.Top} />
      {data.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

/** An edge whose label is a small pill, the whole condition on hover */
function LabelEdge(props: EdgeProps<LabelEdge>) {
  const [path, x, y] = getSmoothStepPath(props);
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} />
      <EdgeLabelRenderer>
        <div
          title={props.data?.full}
          className="nodrag nopan absolute rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] text-zinc-300"
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: "all" }}
        >
          {props.data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { phase: PhaseNode, role: RoleNode };
const edgeTypes = { label: LabelEdge };

function toGraph(def: ScenarioDef, phase: undefined | string) {
  const roles = Object.keys(def.roles);
  // a rule's role above the role it moves npcs to, so its edge runs downwards
  const ruled = new Set(def.rules.map((rule) => rule.for));
  const roleColumn = [...roles].sort((u, v) => Number(ruled.has(v)) - Number(ruled.has(u)));
  const nodes: (PhaseNode | RoleNode)[] = [
    ...def.phases.map(
      (p, i): PhaseNode => ({
        id: `phase:${p.key}`,
        type: "phase",
        position: { x: 0, y: i * phaseGap },
        data: {
          label: p.key,
          cells: roles.map((role) => [role, def.cells[role]?.[p.key] ?? []] as const),
          current: p.key === phase,
        },
      }),
    ),
    ...roleColumn.map(
      (role, i): RoleNode => ({
        id: `role:${role}`,
        type: "role",
        position: { x: roleColumnX, y: i * roleGap },
        data: { label: role },
      }),
    ),
  ];
  const edges: LabelEdge[] = [
    ...def.phases.slice(1).map((p, i) => {
      const { key, until, label } = def.phases[i];
      return labelEdge(`until:${key}`, `phase:${key}`, `phase:${p.key}`, label ?? brief(until), until);
    }),
    // a rule whose change sets `n.role` moves its npcs to that role
    ...def.rules.flatMap((rule, i) => {
      const to = rule.apply?.match(/n\.role\s*=\s*["'](\w+)["']/)?.[1];
      if (to === undefined) return [];
      const full = `${rule.phases === undefined ? "" : `${rule.phases.join(",")}: `}${rule.when}`;
      return {
        ...labelEdge(`rule:${i}`, `role:${rule.for}`, `role:${to}`, rule.label ?? brief(rule.when), full),
        animated: true,
      };
    }),
  ];
  return { nodes, edges };
}

function labelEdge(id: string, source: string, target: string, label: string, full: string): LabelEdge {
  return { id, source, target, type: "label", data: { label, full }, markerEnd: { type: MarkerType.ArrowClosed } };
}

/** A condition's body, its arrow dropped and its length capped */
function brief(src: string) {
  const body = src.replace(/^\s*\([^)]*\)\s*=>\s*|^\s*\w+\s*=>\s*/, "");
  return body.length > briefMax ? `${body.slice(0, briefMax - 1)}…` : body;
}

/** Pixels high, unless resized, at the panel's zoom */
const flowHeight = 240;
/** The zoom the start is centred at */
const focusZoom = 1.2;
/** Pixels between successive phases, and between roles */
const phaseGap = 140;
const roleGap = 140;
/** Pixels from the phases to the roles */
const roleColumnX = 300;
const briefMax = 18;

type Props = {
  def: ScenarioDef;
  phase?: string;
  /** The panel's text zoom, undone here */
  zoom: number;
  /** Pixels on screen, as last resized */
  height: undefined | number;
  /** Its pan and zoom, as last left */
  viewport: undefined | Viewport;
  onHeight(height: number): void;
  onViewport(viewport: Viewport): void;
};

type PhaseNode = Node<{ label: string; cells: (readonly [string, string[]])[]; current: boolean }, "phase">;
type RoleNode = Node<{ label: string }, "role">;
type LabelEdge = Edge<{ label: string; full: string }, "label">;
