import * as THREE from "three/webgpu";
import type { DecorSheetEntry, SheetsType } from "../assets.schema";

/**
 * Where a decor image sits in `w.texDecor`, as `[offX, offY + sheetId, dimX, dimY]`.
 *
 * The integer part of `y` is the array layer and its fractional part the v offset, matching
 * how `Decor.tsx` packs its `uvData` attribute — so the same shader maths reads either.
 *
 * Normalised by `maxDecorSheetDim` rather than the sheet's own dims, since that is what the
 * texture array's layers are sized to and each sheet is drawn into its layer top-left.
 */
export function getDecorAtlasUv(sheets: SheetsType, key: string): THREE.Vector4 | null {
  const entry = sheets?.decor?.[key] as DecorSheetEntry | undefined;
  const dims = sheets?.maxDecorSheetDim;
  if (entry === undefined || dims === undefined || dims.width === 0 || dims.height === 0) {
    return null;
  }
  return new THREE.Vector4(
    entry.rect.x / dims.width,
    entry.rect.y / dims.height + entry.sheetId,
    entry.rect.width / dims.width,
    entry.rect.height / dims.height,
  );
}
