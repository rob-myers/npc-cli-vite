import type { MapEditSavedMap, MapEditSavedSymbol } from "@npc-cli/ui__map-edit";
import { traverseNodes } from "@npc-cli/ui__map-edit/map-node-api";
import { Canvas } from "skia-canvas";

export async function createSavedSymbolPreviewPng(savedFile: MapEditSavedSymbol) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(width, height);
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedSymbolPreviewPng", { filename });

  traverseNodes(nodes, (node) => {
    // console.log(node.type, node);
    switch (node.type) {
      case "rect": {
        // 🚧 CSS transform text -> Matrix
        // ct.fillStyle = '#f00';
        // ct.transform(node.transform);
        // ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
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
