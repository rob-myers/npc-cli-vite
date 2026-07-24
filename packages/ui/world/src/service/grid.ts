import { Rect, Vect } from "@npc-cli/util/geom";
import { warn } from "@npc-cli/util/legacy/generic";
import { decorGridSize, gmIdGridDim } from "../const";

//#region decor grid

export function addToDecorGrid(item: Geomorph.Decor, grid: Geomorph.DecorGrid) {
  const rect = item.bounds;
  const [mx, my] = coordToDecorGrid(rect.x, rect.y);
  const [Mx, My] = coordToDecorGrid(rect.x + rect.width, rect.y + rect.height);
  const isApplyReach = item.meta["apply-reach"] === true;

  item.meta.gridMin = [mx, my];
  item.meta.gridMax = [Mx, My];

  for (let i = mx; i <= Mx; i++)
    for (let j = my; j <= My; j++) {
      const tile = (grid[`${i},${j}`] ??= new Set());

      if (item.type === "point" || item.type === "quad") {
        const parent = findApplyReachContaining(item, tile);
        if (parent !== null) {
          applyReach(item, parent, grid);
          return;
        }
      } else if (isApplyReach === true) {
        const queryRect = tmpRect.copy(rect);
        for (const other of tile) {
          if (
            (other.type === "point" && queryRect.contains(other) === true) ||
            (other.type === "quad" && queryRect.contains(other.center) === true)
          ) {
            applyReach(other, item, grid);
          }
        }
      }

      tile.add(item);
    }
}

/**
 * Given `parent` of `item` with `meta["apply-reach"] === true`,
 * extend the grid coverage of `item` to `parent`'s
 *
 * Also update `reachRect` which allows a refined reachability test.
 */
function applyReach(item: Geomorph.DecorPoint | Geomorph.DecorQuad, parent: Geomorph.Decor, grid: Geomorph.DecorGrid) {
  const [omx, omy] = parent.meta.gridMin as [number, number];
  const [oMx, oMy] = parent.meta.gridMax as [number, number];
  for (let x = omx; x <= oMx; x++) for (let y = omy; y <= oMy; y++) (grid[`${x},${y}`] ??= new Set()).add(item);

  item.meta.gridMin = [omx, omy];
  item.meta.gridMax = [oMx, oMy];
  item.meta.reachRect = tmpRect.copy(parent.bounds).precision(2).tuple;
}

export function coordToDecorGrid(x: number, y: number): [x: number, y: number] {
  return [Math.floor(x / decorGridSize), Math.floor(y / decorGridSize)];
}

/**
 * Find decor in `tile` where `meta["apply-reach"] === true`
 * whose bounds contain the center of `item`.
 * > e.g. a decor quad representing a table where `item` is on that table.
 */
function findApplyReachContaining(
  item: Geomorph.DecorPoint | Geomorph.DecorQuad,
  tile: Set<Geomorph.Decor>,
): Geomorph.Decor | null {
  const point = item.type === "point" ? item : item.center;
  for (const other of tile) {
    if (other.meta["apply-reach"] === true && tmpRect.copy(other.bounds).contains(point) === true) {
      return other;
    }
  }
  return null;
}

export function queryDecorGridLine(p: Geom.Vect, q: Geom.Vect, grid: Geomorph.DecorGrid): Geomorph.Decor[] {
  const tau = tmpVect.copy(q).sub(p);
  const dx = Math.sign(tau.x);
  const dy = Math.sign(tau.y);
  const [gpx, gpy] = coordToDecorGrid(p.x, p.y);

  tmpFoundDecor.clear();
  grid[`${gpx},${gpy}`]?.forEach((d) => tmpFoundDecor.add(d));

  if (dx !== 0 || dy !== 0) {
    let lambdaV =
      tau.x === 0
        ? Infinity
        : tau.x > 0
          ? (decorGridSize * Math.ceil(p.x / decorGridSize) - p.x) / tau.x
          : (-decorGridSize * Math.ceil(-p.x / decorGridSize) - p.x) / tau.x;
    let lambdaH =
      tau.y === 0
        ? Infinity
        : tau.y > 0
          ? (decorGridSize * Math.ceil(p.y / decorGridSize) - p.y) / tau.y
          : (-decorGridSize * Math.ceil(-p.y / decorGridSize) - p.y) / tau.y;

    let cx = gpx,
      cy = gpy;

    do {
      if (lambdaV <= lambdaH) {
        cx += dx;
        lambdaV += (decorGridSize * dx) / tau.x;
      } else {
        cy += dy;
        lambdaH += (decorGridSize * dy) / tau.y;
      }
      grid[`${cx},${cy}`]?.forEach((d) => tmpFoundDecor.add(d));
    } while (Math.min(lambdaH, lambdaV) <= 1);
  }

  return Array.from(tmpFoundDecor);
}

export function queryDecorGridRect(
  grid: Geomorph.DecorGrid,
  rect: Geom.RectJson,
  { grKey, reachRect }: Geomorph.DecorGridQueryOpts = {},
): Geomorph.Decor[] {
  const decor: Record<string, Geomorph.Decor> = {};
  const [mx, my] = coordToDecorGrid(rect.x, rect.y);
  const [Mx, My] = coordToDecorGrid(rect.x + rect.width, rect.y + rect.height);
  const queryRect = tmpRect.copy(rect);

  for (let i = mx; i <= Mx; i++) {
    for (let j = my; j <= My; j++) {
      grid[`${i},${j}`]?.forEach((d) => {
        if (
          reachRect === true && Array.isArray(d.meta.reachRect)
            ? queryRect.intersectsArgs(...(d.meta.reachRect as [number, number, number, number]))
            : queryRect.intersects(d.bounds)
        ) {
          decor[d.key] = d;
        }
      });
    }
  }

  return grKey === undefined ? Object.values(decor) : Object.values(decor).filter(({ meta }) => meta.grKey === grKey);
}

export function removeFromDecorGrid(d: Geomorph.Decor, grid: Geomorph.DecorGrid) {
  if (!d.meta.gridMin) return;
  const [mx, my] = d.meta.gridMin as [number, number];
  const [Mx, My] = d.meta.gridMax as [number, number];
  for (let i = mx; i <= Mx; i++) for (let j = my; j <= My; j++) grid[`${i},${j}`]?.delete(d);
}

//#endregion

//#region gmId grid

export function createGmIdGrid(gms: Geomorph.LayoutInstance[]): Geomorph.GmIdGrid {
  const gmIdGrid = {} as Geomorph.GmIdGrid;

  for (const [
    gmId,
    {
      key: gmKey,
      gridRect: { x: gx, y: gy, right, bottom },
    },
  ] of gms.entries()) {
    if (gx % gmIdGridDim !== 0 || gy % gmIdGridDim !== 0) {
      warn(`${"createGmIdGrid"}: ${gmKey} gridRect should be aligned to ${gmIdGridDim}x${gmIdGridDim} grid`);
    }

    for (let x = Math.floor(gx / gmIdGridDim); x < Math.floor(right / gmIdGridDim); x++)
      for (let y = Math.floor(gy / gmIdGridDim); y < Math.floor(bottom / gmIdGridDim); y++)
        gmIdGrid[`${x},${y}`] = gmId;
  }

  return gmIdGrid;
}

export function queryGmIdGrid(grid: Geomorph.GmIdGrid, point: Geom.VectJson): number | null {
  return grid[`${Math.floor(point.x / gmIdGridDim)},${Math.floor(point.y / gmIdGridDim)}`] ?? null;
}

/**
 * Same rasterization as `createGmIdGrid`, but written into a dense RGBA buffer (R = gmId + 1, 0 =
 * no instance) instead of a sparse object — for uploading as a GPU texture so a post-processing
 * fragment shader can look up "which gm instance is here" in O(1), no per-instance search.
 */
export function createGmIdGridTexture(gms: Geomorph.LayoutInstance[]) {
  if (gms.length === 0) {
    return { data: new Uint8Array(4), width: 1, height: 1, originX: 0, originY: 0 };
  }

  const cellRanges = gms.map(({ gridRect: { x, y, right, bottom } }) => ({
    x0: Math.floor(x / gmIdGridDim),
    x1: Math.floor(right / gmIdGridDim),
    y0: Math.floor(y / gmIdGridDim),
    y1: Math.floor(bottom / gmIdGridDim),
  }));

  const originX = Math.min(...cellRanges.map((r) => r.x0));
  const originY = Math.min(...cellRanges.map((r) => r.y0));
  const width = Math.max(...cellRanges.map((r) => r.x1)) - originX;
  const height = Math.max(...cellRanges.map((r) => r.y1)) - originY;

  const data = new Uint8Array(width * height * 4);
  for (const [gmId, { x0, x1, y0, y1 }] of cellRanges.entries()) {
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        const idx = ((y - originY) * width + (x - originX)) * 4;
        data[idx] = gmId + 1;
        data[idx + 3] = 255;
      }
    }
  }

  return { data, width, height, originX, originY };
}

//#endregion

const tmpRect = new Rect();
const tmpVect = new Vect();
const tmpFoundDecor = new Set<Geomorph.Decor>();
