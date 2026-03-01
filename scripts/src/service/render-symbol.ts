import path from "node:path";
import type { MapEditSavedMap, MapEditSavedSymbol } from "@npc-cli/ui__map-edit";
import { traverseNodesAsync } from "@npc-cli/ui__map-edit/map-node-api";
import { Mat } from "@npc-cli/util/geom";
import { Canvas, loadImage } from "skia-canvas";
import { PROJECT_ROOT } from "../const.ts";

export async function createSavedSymbolPreviewPng(savedFile: MapEditSavedSymbol) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(width, height);
  const ct = canvas.getContext("2d");
  console.log("🚧 createSavedSymbolPreviewPng", { filename });

  await traverseNodesAsync(nodes, async (node) => {
    // console.log(node.type, node);

    // 🚧 draw into canvas

    switch (node.type) {
      case "image": {
        console.log({
          imageName: node.name,
          cssTransform: node.cssTransform,
          matrix: new Mat(node.cssTransform).toArray(),
        });

        const imagePath = path.resolve(
          PROJECT_ROOT,
          "packages/app/public/starship-symbol",
          `${node.imageKey}.png`,
        );
        const image = await loadImage(imagePath);

        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "rect": {
        console.log({
          rectName: node.name,
          cssTransform: node.cssTransform,
          matrix: new Mat(node.cssTransform).toArray(),
        });

        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.fillStyle = "red";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);

        break;
      }
    }
  });

  const dstPath = path.resolve(PROJECT_ROOT, "packages/app/public/test", `${filename}.thumb.png`);
  await canvas.toFile(dstPath);
}

export async function createSavedMapPreviewPng(savedFile: MapEditSavedMap) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(width, height);
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedMapPreviewPng", { filename });
}
