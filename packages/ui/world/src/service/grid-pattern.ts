function createGridPattern(dim: number, color: string) {
  const tmpCtxt = getContext2d("create-grid-pattern");
  tmpCtxt.canvas.width = tmpCtxt.canvas.height = dim;
  tmpCtxt.resetTransform();
  tmpCtxt.clearRect(0, 0, dim, dim);
  tmpCtxt.strokeStyle = color;
  tmpCtxt.lineWidth = 1;
  tmpCtxt.strokeRect(0, 0, dim, dim);
  tmpCtxt.resetTransform();
  return tmpCtxt.createPattern(tmpCtxt.canvas, "repeat") as CanvasPattern;
}

const patternLookup: Record<string, CanvasPattern> = {};

export function getGridPattern(dim: number, color: string) {
  const key = `grid-pattern-${dim}-${color}`;
  return (patternLookup[key] ??= createGridPattern(dim, color));
}

/** Browser only i.e. `document.createElement` */
export function getContext2d(
  key: string,
  opts?: CanvasRenderingContext2DSettings & { width?: number; height?: number },
) {
  const canvas = (canvasLookup[key] ??= document.createElement("canvas"));
  if (opts?.width) canvas.width = opts.width;
  if (opts?.height) canvas.height = opts.height;
  return canvas.getContext("2d", opts) as CanvasRenderingContext2D;
}

/** Cache to avoid re-creation on HMR */
const canvasLookup: Record<string, HTMLCanvasElement> = {};
