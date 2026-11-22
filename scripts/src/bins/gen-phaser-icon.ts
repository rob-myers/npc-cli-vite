#!/usr/bin/env node

/**
 * Draws the hud's phaser icons (`service/phaser-icon.ts`) to a png: a row each, bare and with each attachment,
 * put away and armed.
 * ```sh
 * gen-phaser-icon --png /tmp/phaser-icon.png
 * ```
 */

import { parseArgs } from "node:util";
import { gunColors } from "@npc-cli/ui__world/phaser-gun";
import { phaserIconConfig, phaserIconKeys, phaserIcons } from "@npc-cli/ui__world/phaser-icon";
import { Canvas, Path2D } from "skia-canvas";

const { values: opts } = parseArgs({ options: { png: { type: "string" } } });
if (opts.png === undefined) throw Error("expected --png {file}");

const { size, edgeWidth, attachEdgeWidth } = phaserIconConfig;
const zoom = 8;
const canvas = new Canvas(2 * size * zoom, phaserIconKeys.length * size * zoom);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#1b1f26";
ctx.fillRect(0, 0, canvas.width, canvas.height);
for (const [row, key] of phaserIconKeys.entries())
  [false, true].forEach((armed, i) => {
    const { faces, beam } = phaserIcons[key];
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(i * size, row * size);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const face of faces) {
      ctx.fillStyle = "fill" in face ? face.fill : armed ? face.armed : face.off;
      ctx.fill(new Path2D(face.d));
      ctx.strokeStyle = face.attached ? gunColors.attachEdge : gunColors.iconEdge;
      ctx.lineWidth = face.attached ? attachEdgeWidth : edgeWidth;
      ctx.stroke(new Path2D(face.edges));
    }
    if (armed) {
      ctx.strokeStyle = gunColors.beam;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(beam.from.x, beam.from.y);
      ctx.lineTo(beam.to.x, beam.to.y);
      ctx.stroke();
    }
    ctx.restore();
  });
await canvas.toFile(opts.png);
console.log(`wrote ${opts.png}`);
