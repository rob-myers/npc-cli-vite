/**
 * A two dimensional coordinate.
 */
export class Vect {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x = 0, y = 0) {
    /** @type {number} */ this.x = x;
    /** @type {number} */ this.y = y;
  }

  /** Radians */
  get angle() {
    return Math.atan2(this.y, this.x);
  }

  /** @returns {Geom.Coord} */
  get coord() {
    return [this.x, this.y];
  }

  /** 2 decimal places */
  get degrees() {
    return Math.round(100 * (this.angle * (180 / Math.PI))) / 100;
  }

  /** @returns {Geom.VectJson} */
  get json() {
    return { x: this.x, y: this.y };
  }

  get length() {
    return Math.hypot(this.x, this.y);
  }

  get lengthSquared() {
    return this.x * this.x + this.y * this.y;
  }

  static get zero() {
    return new Vect(0, 0);
  }

  /** @param {Geom.VectJson} _ */
  add({ x, y }) {
    return this.translate(x, y);
  }

  /**
   * @param {Geom.VectJson} v
   * @param {number} s
   */
  addScaled(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  /**
   * Radians, clockwise from east.
   * @param {Geom.VectJson} p
   */
  angleTo(p) {
    return Math.atan2(p.y - this.y, p.x - this.x);
  }

  /** @param {Geom.VectJson[]} vectors */
  static average(vectors) {
    const sum = Vect.zero;
    vectors.forEach((v) => sum.add(v));
    vectors.length > 0 && sum.scale(1 / vectors.length);
    return sum;
  }

  clone() {
    return new Vect(this.x, this.y);
  }

  /** @param {Geom.VectJson} p */
  copy(p) {
    return this.set(p.x, p.y);
  }

  /**
   * @param {Geom.VectJson} p
   * @param {Geom.VectJson} q
   */
  static distanceBetween(p, q) {
    return Math.hypot(q.x - p.x, q.y - p.y);
  }

  /** @param {Geom.VectJson} p */
  distanceTo(p) {
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  distToCoords(x, y) {
    return Math.hypot(x - this.x, y - this.y);
  }

  /** @param {Geom.VectJson} p */
  distanceToSquared(p) {
    return (p.x - this.x) ** 2 + (p.y - this.y) ** 2;
  }

  /** @param {Geom.VectJson} other */
  dot(other) {
    return this.x * other.x + this.y * other.y;
  }

  /**
   * @param {number} ox
   * @param {number} oy
   */
  dotArgs(ox, oy) {
    return this.x * ox + this.y * oy;
  }

  /** @param {Geom.VectJson} _ */
  equals({ x, y }) {
    return this.x === x && this.y === y;
  }

  /** @param {Geom.VectJson} _ */
  equalsAlmost({ x, y }, error = Number.EPSILON) {
    return Math.abs(this.x - x) <= error && Math.abs(this.y - y) <= error;
  }

  /**
   * @param {Geom.VectJson | number} input
   * @param {number} [y]
   */
  static from(input, y) {
    return typeof input === "number" ? new Vect(input, y) : new Vect(input.x, input.y);
  }

  /**
   * @param {number[]} coords
   * @returns {Geom.Vect[]}
   */
  static fromCoords(coords) {
    return coords.reduce(
      (agg, z, i) => {
        if (i % 2 === 0) agg.push(new Vect(z, z));
        else agg[agg.length - 1].y = z;
        return agg;
      },
      /** @type {Geom.Vect[]} */ ([]),
    );
  }

  /**
   * @param {any} input
   * @returns {input is Geom.VectJson} input
   */
  static isJson(input) {
    return !!input && typeof input.x === "number" && typeof input.y === "number";
  }

  /**
   * @param {Geom.VectJson[]} vectors
   */
  static topLeft(...vectors) {
    return vectors.reduce(
      /** @param {Geom.Vect} agg */ (agg, v) =>
        v.y < agg.y || (v.y === agg.y && v.x < agg.x) ? agg.copy(v) : agg,
      new Vect(Infinity, Infinity),
    );
  }

  normalize(newLength = 1) {
    const length = this.length;
    if (length > 0) {
      return this.scale(newLength / length);
    } else {
      console.error(`Cannot normalize Vect '${this}' to length '${newLength}'`);
      return this;
    }
  }

  /**
   * @param {number} dp decimal places
   */
  precision(dp) {
    return this.set(Number(this.x.toFixed(dp)), Number(this.y.toFixed(dp)));
  }

  /** @param {number} radians */
  rotate(radians) {
    const [x, y] = [this.x, this.y];
    this.x = Math.cos(radians) * x - Math.sin(radians) * y;
    this.y = Math.sin(radians) * x + Math.cos(radians) * y;
    return this;
  }

  round() {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    return this;
  }

  /**
   * @param {number} sx
   * @param {number} [sy]
   */
  scale(sx, sy = sx) {
    this.x *= sx;
    this.y *= sy;
    return this;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  /** @param {Geom.VectJson} _ */
  sub({ x, y }) {
    return this.translate(-x, -y);
  }

  /**
   * @param {Geom.VectJson} p
   * @param {Geom.VectJson} q
   */
  subVectors(p, q) {
    this.x = p.x - q.x;
    this.y = p.y - q.y;
    return this;
  }

  toString() {
    return `${this.x},${this.y}`;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  translate(x, y) {
    this.x += x;
    this.y += y;
    return this;
  }
}
