declare namespace Geomorph {
  type SymbolKey = import("@npc-cli/ui__map-edit/map-node-api").SymbolKey;
  type GeomorphKey = import("@npc-cli/ui__map-edit/map-node-api").GeomorphKey;

  // 🚧 derived from schema
  type Symbol = {
    key: SymbolKey;
    isHull: boolean;
    width: number;
    height: number;
    // 🚧
  };

  // 🚧 derived from schema
  type MapDef = {
    /** e.g. `demo-map-1` */
    key: string;
    gms: { gmKey: GeomorphKey; transform: Geom.AffineTransform }[];
  };
}
