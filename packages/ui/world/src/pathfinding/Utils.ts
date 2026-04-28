/** biome-ignore-all lint/complexity/noStaticOnlyClass: faithful to source */
/** biome-ignore-all lint/correctness/noInnerDeclarations: faithful to source */
export class Utils {
  static roundNumber(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  static sample<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
  }

  static distanceToSquared(a: Geom.VectJson, b: Geom.VectJson) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  static isPointInPoly(poly: Geom.VectJson[], pt: Geom.VectJson) {
    for (var c = false, i = -1, l = poly.length, j = l - 1; ++i < l; j = i)
      ((poly[i].y <= pt.y && pt.y < poly[j].y) || (poly[j].y <= pt.y && pt.y < poly[i].y)) &&
        pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x &&
        (c = !c);
    return c;
  }

  static isVectorInPolygon(vector: Geom.VectJson, polygon: { vertexIds: number[] }, vertices: Geom.VectJson[]) {
    let lowestPoint = Infinity;
    let highestPoint = -Infinity;
    const polygonVertices: Geom.VectJson[] = [];

    polygon.vertexIds.forEach((vId) => {
      lowestPoint = Math.min(vertices[vId].y, lowestPoint);
      highestPoint = Math.max(vertices[vId].y, highestPoint);
      polygonVertices.push(vertices[vId]);
    });

    if (vector.y < highestPoint + 0.5 && vector.y > lowestPoint - 0.5 && Utils.isPointInPoly(polygonVertices, vector)) {
      return true;
    }
    return false;
  }

  static triarea2(a: Geom.VectJson, b: Geom.VectJson, c: Geom.VectJson) {
    var ax = b.x - a.x;
    var az = b.y - a.y;
    var bx = c.x - a.x;
    var bz = c.y - a.y;
    return -(bx * az - ax * bz);
  }

  static vequal(a: Geom.VectJson, b: Geom.VectJson) {
    return Utils.distanceToSquared(a, b) < 0.00001;
  }
}
