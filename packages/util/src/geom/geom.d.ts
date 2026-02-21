declare namespace Geom {
  type Vect = import(".").Vect;
  type Rect = import(".").Rect;
  type Poly = import(".").Poly;
  type Ray = import(".").Ray;
  type Mat = import(".").Mat;
  type SpacialHash<T> = import(".").SpacialHash<T>;

  type Coord = [number, number];
  type Seg = { src: VectJson; dst: VectJson };
  type Circle = { radius: number; center: VectJson };

  interface GeoJsonPolygon {
    /** Identifier amongst GeoJSON formats. */
    type: "Polygon";
    /**
     * The 1st array defines the _outer polygon_,
     * the others define non-nested _holes_.
     */
    coordinates: Coord[][];
    meta: Record<string, string>;
  }

  interface VectJson {
    x: number;
    y: number;
  }

  interface RectJson {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface TriangulationGeneric<V extends Vect | VectJson> {
    vs: V[];
    tris: [number, number, number][];
  }

  type Triangulation = TriangulationGeneric<Vect>;
  type TriangulationJson = TriangulationGeneric<VectJson>;

  /** Rotated around `(baseRect.x, baseRect.y) */
  interface AngledRect<T> {
    /** The unrotated rectangle */
    baseRect: T;
    /** Radians */
    angle: number;
  }

  /** 'n' | 'e' | 's' | 'w' */
  type Direction = 0 | 1 | 2 | 3;

  type DirectionString = 'n' | 'e' | 's' | 'w';

  interface ClosestOnOutlineResult {
    point: Geom.VectJson;
    norm: Geom.VectJson;
    dist: number;
    edgeId: number;
  }

  type SixTuple = [number, number, number, number, number, number];

}
