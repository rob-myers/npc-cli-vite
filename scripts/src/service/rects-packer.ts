import { warn } from "@npc-cli/util/legacy/generic";
import { MaxRectsPacker, Rectangle } from "maxrects-packer";

/**
 * Output width is maximum over all sheet widths.
 * Output height is maximum over all sheet heights.
 */
export default function packRectangles<T>(
  rectsToPack: PrePackedRect<T>[],
  opts: {
    logPrefix: string;
    packedPadding: number;
    maxWidth?: number;
    maxHeight?: number;
  },
) {
  const { maxWidth = 4096, maxHeight = 4096 } = opts;
  const packer = new MaxRectsPacker(maxWidth, maxHeight, opts.packedPadding, {
    pot: false,
    border: opts.packedPadding,
    // smart: false,
  });

  // 🔔 can provide rect.{x,y} but maxrects-packer doesn't necessarily respect it
  packer.addArray(
    rectsToPack.map((x) => {
      const rect = new Rectangle(x.width, x.height);
      rect.data = x.data;
      return rect;
    }),
  );

  const { bins } = packer;
  const numRectsPacked = bins.reduce((sum, bin) => sum + bin.rects.length, 0);

  if (bins.length === 0) {
    warn(`${opts.logPrefix}: no rectangles to pack`);
    return { bins: [{ width: 0, height: 0, rects: [] as Rectangle[] }], width: 0, height: 0 };
  } else if (numRectsPacked !== rectsToPack.length) {
    throw Error(`${opts.logPrefix}: expected every image to be packed: ${numRectsPacked} of ${rectsToPack.length}`);
  }

  return { bins, width: Math.max(...bins.map((x) => x.width)), height: Math.max(...bins.map((x) => x.height)) };
}

export interface PrePackedRect<T> {
  width: number;
  height: number;
  data: T;
}
