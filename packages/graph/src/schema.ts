import { StarShipSymbolImageKeySchema } from "@npc-cli/media/starship-symbol";
import { SixTupleSchema } from "@npc-cli/util";
import z from "zod";
import { SymbolGraph } from "./symbol-graph";

const SymbolGraphNodeSchema = z.object({
  id: StarShipSymbolImageKeySchema,
});

export type SymbolGraphNode = z.infer<typeof SymbolGraphNodeSchema>;

const SymbolGraphEdgeOptsSchema = z.object({
  src: StarShipSymbolImageKeySchema,
  dst: StarShipSymbolImageKeySchema,
  transform: SixTupleSchema,
  meta: z.record(z.string(), z.unknown()),
});

export type SymbolGraphEdgeOpts = z.infer<typeof SymbolGraphEdgeOptsSchema>;

export const SymbolGraphJsonSchema = z.object({
  nodes: z.array(SymbolGraphNodeSchema),
  edges: z.array(SymbolGraphEdgeOptsSchema),
  /** e.g. `"20,20"` */
  size: z.string().optional(),
  /** e.g. `"LR"` */
  rankdir: z.string().optional(),
});

export type SymbolGraphJson = z.infer<typeof SymbolGraphJsonSchema>;

export const SymbolGraphSchema = z.instanceof(SymbolGraph);

export const symbolGraphCodec = z.codec(SymbolGraphJsonSchema, SymbolGraphSchema, {
  encode: (graph) => graph.json(),
  decode: (json) => SymbolGraph.from(json),
});
