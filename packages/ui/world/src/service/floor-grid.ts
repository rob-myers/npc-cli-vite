import { float, mix, positionWorld, select, smoothstep, step, texture, uniform, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

/**
 * The debug grid, drawn by a quad of its own over the whole map — see `Debug`. Its lines and
 * coordinates are the WORLD's, worked out from each fragment's world position.
 */
export function createFloorGrid(): FloorGrid {
  /** The map's bounds, as `(minX, minY, maxX, maxY)` */
  const bounds = uniform(new THREE.Vector4());
  const glyphs = createGlyphs();

  const toLine = positionWorld.xz.div(cellSize).sub(0.5).fract().sub(0.5).abs().mul(cellSize);
  // lines stop at the map's edge: the quad runs a cell past it, for the far edges' coordinates
  const p = positionWorld.xz;
  const inMap = step(bounds.x.sub(lineWidth), p.x)
    .mul(step(p.x, bounds.z.add(lineWidth)))
    .mul(step(bounds.y.sub(lineWidth), p.y))
    .mul(step(p.y, bounds.w.add(lineWidth)));
  const line = smoothstep(lineWidth / 2, lineWidth, toLine.x.min(toLine.y))
    .oneMinus()
    .mul(inMap);

  // each cell's world `(x, y)` at its corner, one glyph per slot
  const cell = positionWorld.xz.div(cellSize).floor();
  const inText = positionWorld.xz.sub(cell.mul(cellSize)).sub(textInset).div(vec2(charWidth, charHeight));
  const col = inText.x.floor();
  const blank = float(glyphChars.length);
  const glyphOf = (char: string) => float(glyphChars.indexOf(char));

  /** A coordinate as `[-]D.D` to `[-]DDD.D`: how many glyphs it takes, and the one at slot `at` */
  const numberOf = (coord: THREE.Node<"float">) => {
    /** In TENTHS, so its digits are whole numbers */
    const tenths = coord.abs().mul(10).round();
    const sign = step(coord, -0.01);
    const whole = float(1).add(step(100, tenths)).add(step(1000, tenths));
    const glyphAt = (at: THREE.Node<"float">) => {
      /** The slot counted from the first digit */
      const k = at.sub(sign);
      const fromPoint = whole.sub(k);
      const place = select(
        fromPoint.lessThan(1.5),
        float(10),
        select(fromPoint.lessThan(2.5), float(100), float(1000)),
      );
      return select(
        k.lessThan(-0.5),
        glyphOf("-"),
        select(
          k.lessThan(whole.sub(0.5)),
          tenths.div(place).floor().mod(10),
          select(k.lessThan(whole.add(0.5)), glyphOf("."), select(k.lessThan(whole.add(1.5)), tenths.mod(10), blank)),
        ),
      );
    };
    return { length: sign.add(whole).add(2), glyphAt };
  };
  const [x, y] = [numberOf(cell.x.mul(cellSize)), numberOf(cell.y.mul(cellSize))];
  /** Where `y` starts: past `(`, `x`, `,` and a space */
  const yFrom = x.length.add(3);
  const glyph = select(
    col.lessThan(0.5),
    glyphOf("("),
    select(
      col.lessThan(x.length.add(0.5)),
      x.glyphAt(col.sub(1)),
      select(
        col.lessThan(x.length.add(1.5)),
        glyphOf(","),
        select(
          col.lessThan(yFrom.sub(0.5)),
          blank,
          select(
            col.lessThan(yFrom.add(y.length).sub(0.5)),
            y.glyphAt(col.sub(yFrom)),
            select(col.lessThan(yFrom.add(y.length).add(0.5)), glyphOf(")"), blank),
          ),
        ),
      ),
    ),
  );
  const glyphUv = vec2(glyph.add(inText.x.fract()).div(glyphChars.length), inText.y.fract().oneMinus());
  const inSlots = step(0, col)
    .mul(step(0, inText.y))
    .mul(step(inText.y, 1))
    .mul(step(glyph, blank.sub(0.5)));
  const text = texture(glyphs, glyphUv).a.mul(inSlots);

  return {
    colorNode: mix(vec3(lineInk), vec3(...textRgb), step(0.01, text)) as THREE.Node<"vec3">,
    opacityNode: line.mul(lineAlpha).max(text.mul(textAlpha)) as THREE.Node<"float">,
    setBounds({ x, y, width, height }) {
      bounds.value.set(x, y, x + width, y + height);
      return { x, y, width: width + cellSize, height: height + cellSize };
    },
  };
}

export type FloorGrid = {
  colorNode: THREE.Node<"vec3">;
  opacityNode: THREE.Node<"float">;
  /** Says where the map is, and returns the rect the grid's quad must cover: a cell further */
  setBounds(rect: Geom.RectJson): Geom.RectJson;
};

/** A cell and its line, in METRES, and the line's ink */
const cellSize = 1.5;
const lineWidth = 0.03;
const lineInk = 0.86;
const lineAlpha = 0.25;
/** A cell's coordinates: where they start within it, and a glyph's size, in METRES */
const textInset = 0.05;
const charWidth = 0.07;
const charHeight = 0.12;
const textRgb = [0, 0.86, 0] as const;
const textAlpha = 0.85;
/** Each character the coordinates use, in the order `createGlyphs` draws them */
const glyphChars = "0123456789-.,()";

/** A row of white glyphs, one per `glyphChars`, for the shader to tint */
function createGlyphs() {
  const [width, height] = [40, 64];
  const canvas = document.createElement("canvas");
  canvas.width = width * glyphChars.length;
  canvas.height = height;
  const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
  ct.fillStyle = "#fff";
  ct.font = `bold ${height * 0.8}px monospace`;
  ct.textAlign = "center";
  ct.textBaseline = "middle";
  for (const [i, char] of [...glyphChars].entries()) ct.fillText(char, (i + 0.5) * width, height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  // no mipmaps: the uv jumps between glyphs, and a mip chosen off that jump smears them
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
