import type { MapEditSavedMap, MapEditSavedSymbol } from "@npc-cli/ui__map-edit";
import { traverseNodes } from "@npc-cli/ui__map-edit/map-node-api";
import { Mat } from "@npc-cli/util/geom";
import { Canvas } from "skia-canvas";

export async function createSavedSymbolPreviewPng(savedFile: MapEditSavedSymbol) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(width, height);
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedSymbolPreviewPng", { filename });

  traverseNodes(nodes, (node) => {
    // console.log(node.type, node);

    // 🚧 draw into canvas

    switch (node.type) {
      case "image": {
        console.log({
          imageName: node.name,
          cssTransform: node.cssTransform,
          matrix: new Mat(node.cssTransform).toArray(),
        });
        break;
      }
      case "rect": {
        console.log({
          rectName: node.name,
          cssTransform: node.cssTransform,
          matrix: new Mat(node.cssTransform).toArray(),
        });
        break;
      }
    }
  });
}

export async function createSavedMapPreviewPng(savedFile: MapEditSavedMap) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(width, height);
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedMapPreviewPng", { filename });
}
