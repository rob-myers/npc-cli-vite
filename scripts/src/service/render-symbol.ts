import path from "node:path";
import type { MapEditSavedFile, MapEditSavedMap, MapEditSavedSymbol } from "@npc-cli/ui__map-edit";
import { traverseNodesAsync } from "@npc-cli/ui__map-edit/map-node-api";
import { Mat } from "@npc-cli/util/geom";
import { Canvas, loadImage } from "skia-canvas";
import { PROJECT_ROOT } from "../const.ts";

export async function createSavedFilePreview(savedFile: MapEditSavedFile) {
  if (savedFile.type === "symbol") {
    await createSavedSymbolPreviewPng(savedFile);
  }
  if (savedFile.type === "map") {
    await createSavedMapPreviewPng(savedFile);
  }
}

export async function createSavedSymbolPreviewPng(savedFile: MapEditSavedSymbol) {
  const { width, height, filename, nodes } = savedFile;
  // const scale = 200 / width;
  const scale = 1;
  const canvas = new Canvas(width * scale, height * scale);
  const ct = canvas.getContext("2d");

  await traverseNodesAsync(nodes, async (node) => {
    switch (node.type) {
      case "image": {
        const image = await loadImage(
          path.resolve(PROJECT_ROOT, "packages/app/public/starship-symbol", `${node.imageKey}.png`),
        );
        ct.setTransform(
          ...new Mat(node.cssTransform).postMultiply([scale, 0, 0, scale, scale, scale]).toArray(),
        );
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "rect": {
        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.scale(scale, scale);
        ct.fillStyle = "red";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
    }
  });

  const dstPath = path.resolve(
    PROJECT_ROOT,
    "packages/app/public/symbol",
    `${path.basename(filename, ".json")}.thumbnail.png`,
  );
  await canvas.toFile(dstPath);
}

export async function createSavedMapPreviewPng(savedFile: MapEditSavedMap) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(200, 200 * (height / width));
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedMapPreviewPng", { filename });
}
