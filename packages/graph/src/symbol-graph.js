import { keys } from "@npc-cli/util/legacy/generic";
import { BaseGraph } from "./base-graph";
import "@npc-cli/ui__world/geomorph.d.ts";

/**
 * - Node id is respective `SymbolKey`.
 * @extends {BaseGraph<Graph.SymbolGraphNode, Graph.SymbolGraphEdgeOpts>}
 */
export class SymbolGraphClass extends BaseGraph {
  /** @param {Graph.SymbolGraphJson | Geomorph.AssetsType['symbol']} input  */
  static from(input) {
    if ("nodes" in input) {
      return new SymbolGraphClass().plainFrom(input);
    } else {
      const symbols = input;
      const graph = new SymbolGraphClass();

      for (const symbolKey of keys(symbols)) {
        graph.registerNode({ id: symbolKey });
      }

      for (const symbol of Object.values(input)) {
        const { key: symbolKey, symbols: subSymbols } = symbol;
        for (const {
          symbolKey: subSymbolKey,
          transform: { a, b, c, d, e, f },
          meta,
        } of subSymbols) {
          graph.registerEdge({ src: symbolKey, dst: subSymbolKey, transform: [a, b, c, d, e, f], meta });
        }
      }
      return graph;
    }
  }

  /**
   * @returns {Graph.SymbolGraphJson}
   */
  json() {
    return {
      size: "20,20",
      rankdir: "LR",
      nodes: this.nodesArray.slice(),
      edges: this.edgesArray.map(({ src, dst, transform, meta }) => ({
        src: src.id,
        dst: dst.id,
        transform,
        meta,
      })),
    };
  }
}
