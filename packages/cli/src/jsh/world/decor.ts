/**
 * Runtime decor from the shell — see `docs/decorator.md`. What is piped in says WHERE: picks, points,
 * or a query's answer. The World persists what is made, and the debug **Decorations** toggle edits it
 */

type DecorType = Geomorph.DecorDef["type"];

type AddOpts = {
  type?: DecorType;
  key?: string;
  to?: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
  img?: string;
  /** Degrees, for a point */
  orient?: number;
  y3d?: number;
  /** For a circle, or a rect made about ONE point */
  radius?: number;
  width?: number;
  height?: number;
  /** Radians, for a rect */
  angle?: number;
  color?: string;
  meta?: Meta;
};

/**
 * Make decor where it is pointed at, by `to:` or by what is piped in.
 * ```sh
 * pick 3 | decor_add type:point img:switch   # one at each pick
 * pick 1 | decor_add                         # an abstract point
 * pick 2 | decor_add type:rect               # each PAIR of picks is a rect's opposite corners
 * pick 1 | decor_add type:rect width:2 height:1
 * pick 1 | decor_add type:circle radius:1.5
 * pick 1 | decor_add type:quad img:screen-0
 * decor_add to:[3,4.5] key:lamp meta:'{ label: "lamp" }'
 * ```
 */
export async function* decor_add({ api, args, w }: JshCli.RunArg, opts: AddOpts = api.jsArg(args)) {
  const type = opts.type ?? "point";
  const points: Geom.VectJson[] = [];

  if (opts.img !== undefined && !(opts.img in w.sheets.decor)) {
    throw Error(`img: expected one of ${Object.keys(w.sheets.decor).join(", ")}`);
  }

  // a rect with no size of its own takes two points, as opposite corners
  const perDecor = type === "rect" && opts.width === undefined && opts.height === undefined ? 2 : 1;

  function* place(point: unknown) {
    if (!w.helper.isPointAnyFormat(point)) throw Error(`expected point: ${JSON.stringify(point)}`);
    const { x, y } = w.helper.parseGroundPoint(point); // sans any pick meta
    points.push({ x, y });
    if (points.length < perDecor) return;
    const key = opts.key !== undefined && !(opts.key in w.decor.byKey) ? opts.key : nextKey(w, type);
    w.decor.create(toDef(type, key, points.splice(0), opts));
    yield key;
  }

  const given = opts.to === undefined ? [] : isPoints(opts.to) ? opts.to : [opts.to];
  for (const point of given) yield* place(point);

  if (!api.isTtyAt(0)) {
    let datum: unknown;
    while ((datum = await api.read()) !== api.eof) yield* place(datum);
  }
  w.view.forceUpdate();
}

/**
 * ```sh
 * decor_rm point-3 point-4
 * decor_ls | map key | decor_rm
 * ```
 */
export async function decor_rm({ api, args, w }: JshCli.RunArg) {
  const keys = args.slice();
  if (!api.isTtyAt(0)) {
    let datum: unknown;
    // a key, or anything which names one e.g. a def, a pick on decor, a query's item
    while ((datum = await api.read()) !== api.eof) {
      const key = typeof datum === "string" ? datum : ((datum as Meta)?.key ?? (datum as Meta)?.meta?.decorKey);
      if (typeof key === "string") keys.push(key);
    }
  }
  w.decor.remove(...keys.filter((key) => key in w.decor.runtime.byKey));
  w.view.forceUpdate();
}

/** The map's runtime decor, as the defs which made it */
export function* decor_ls({ w }: JshCli.RunArg) {
  yield* Object.values(w.decor.runtime.defByKey);
}

function toDef(type: DecorType, key: string, [p, q]: Geom.VectJson[], opts: AddOpts): Geomorph.DecorDef {
  const meta = { shown: true, ...opts.meta }; // else it could not be seen where it was put
  switch (type) {
    case "point":
      return { type, key, x: p.x, y: p.y, img: opts.img, orient: opts.orient, y3d: opts.y3d, meta };
    case "circle":
      return { type, key, center: p, radius: opts.radius ?? defaultRadius, meta };
    case "quad":
      // the transform's origin is the image's corner
      return {
        type,
        key,
        img: opts.img ?? defaultQuadImg,
        color: opts.color,
        y3d: opts.y3d,
        transform: [1, 0, 0, 1, p.x, p.y],
        meta,
      };
    case "rect": {
      if (q !== undefined) {
        // biome-ignore format: succinct
        return { type, key, x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y), meta };
      }
      const [width, height] = [opts.width ?? opts.height ?? 1, opts.height ?? opts.width ?? 1];
      return { type, key, x: p.x - width / 2, y: p.y - height / 2, width, height, angle: opts.angle, meta };
    }
  }
}

/** The first of `point-1`, `point-2`… not taken by any decor, static or runtime */
function nextKey(w: JshCli.WorldState, type: DecorType) {
  for (let i = 1; ; i++) if (!(`${type}-${i}` in w.decor.byKey)) return `${type}-${i}`;
}

function isPoints(x: unknown): x is JshCli.PointAnyFormat[] {
  return Array.isArray(x) && typeof x[0] !== "number";
}

const defaultRadius = 1;
const defaultQuadImg = "screen-0";
