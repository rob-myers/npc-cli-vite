/**
 * A (2 row) * (3 col) affine 2d transformation matrix.
 * - Based on https://github.com/thednp/DOMMatrix/blob/master/src/index.js
 * - String format `matrix(a, b, c, d, e, f)`.
 */
export class Mat {
  /** @param  {string | Geom.SixTuple} [args] */
  constructor(args) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    if (Array.isArray(args)) {
      this.setMatrixValue(/** @type {Geom.SixTuple} */ (args));
    } else {
      this.setMatrixValue(/** @type {undefined | string} */ (args));
    }
  }

  /**
   * The determinant of 2x2 part of affine matrix.
   * @returns {number}
   */
  get determinant() {
    return this.a * this.d - this.b * this.c;
  }

  /** @param {Geom.SixTuple} _ */
  feedFromArray([a, b, c, d, e, f]) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  /**
   * Get an inverse matrix of current matrix. The method returns a new
   * matrix with values you need to use to get to an identity matrix.
   * Context from parent matrix is not applied to the returned matrix.
   * > https://github.com/deoxxa/transformation-matrix-js/blob/5d0391a169e938c31da6c09f5d4e7dc836fd0ec2/src/matrix.js#L329
   * @returns {Mat}
   */
  getInverseMatrix() {
    if (this.isIdentity) {
      return new Mat();
    } else if (!this.isInvertible) {
      throw Error("Matrix is not invertible.");
    } else {
      const a = this.a,
        b = this.b,
        c = this.c,
        d = this.d,
        e = this.e,
        f = this.f,
        m = new Mat(),
        dt = a * d - b * c; // determinant(), skip DRY here...

      m.a = d / dt;
      m.b = -b / dt;
      m.c = -c / dt;
      m.d = a / dt;
      m.e = (c * f - d * e) / dt;
      m.f = -(a * f - b * e) / dt;

      return m;
    }
  }

  get isIdentity() {
    return (
      this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
    );
  }

  get isInvertible() {
    return Math.abs(this.determinant) >= 1e-14;
  }

  /**
   * @param {number} dp decimal places
   */
  precision(dp) {
    this.feedFromArray([
      Number(this.a.toFixed(dp)),
      Number(this.b.toFixed(dp)),
      Number(this.c.toFixed(dp)),
      Number(this.d.toFixed(dp)),
      Number(this.e.toFixed(dp)),
      Number(this.f.toFixed(dp)),
    ]);
    return this;
  }

  /**
   * Compute `param matrix` * `this matrix`.
   * @param {Geom.Mat | Geom.SixTuple} input
   */
  postMultiply(input) {
    const [a, b, c, d, e, f] = Array.isArray(input) ? input : input.toArray();
    const ma = a * this.a + c * this.b + e * 0;
    const mb = b * this.a + d * this.b + f * 0;
    const mc = a * this.c + c * this.d + e * 0;
    const md = b * this.c + d * this.d + f * 0;
    const me = a * this.e + c * this.f + e * 1;
    const mf = b * this.e + d * this.f + f * 1;
    return this.feedFromArray([ma, mb, mc, md, me, mf]);
  }

  /**
   * Compute `this matrix` * `param matrix`.
   * @param {Geom.Mat | Geom.SixTuple} input
   */
  preMultiply(input) {
    const [a, b, c, d, e, f] = Array.isArray(input) ? input : input.toArray();
    const ma = this.a * a + this.c * b + this.e * 0;
    const mb = this.b * a + this.d * b + this.f * 0;
    const mc = this.a * c + this.c * d + this.e * 0;
    const md = this.b * c + this.d * d + this.f * 0;
    const me = this.a * e + this.c * f + this.e * 1;
    const mf = this.b * e + this.d * f + this.f * 1;
    return this.feedFromArray([ma, mb, mc, md, me, mf]);
  }

  setIdentity() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    return this;
  }

  /** @param  {undefined | string | Geom.SixTuple | MatrixJson} source */
  setMatrixValue(source) {
    if (typeof source === "string") {
      const transform = source // 🔔 assume comma separator
        .slice("matrix(".length, -")".length)
        .split(",")
        .map(Number);
      return this.feedFromArray(/** @type {Geom.SixTuple} */ (transform));
    } else if (!source) {
      return this;
    } else if (Array.isArray(source)) {
      return this.feedFromArray(source);
    } else {
      return this.feedFromArray([source.a, source.b, source.c, source.d, source.e, source.f]);
    }
  }

  /** @param {number} radians angle */
  setRotation(radians) {
    return this.feedFromArray([
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      0,
      0,
    ]);
  }

  /**
   * 🚧 simplify
   * @param {number} radians
   * @param {Geom.VectJson} point
   */
  setRotationAbout(radians, point) {
    this.feedFromArray([1, 0, 0, 1, -point.x, -point.y]);
    this.postMultiply([
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      0,
      0,
    ]);
    this.e += point.x;
    this.f += point.y;
    return this;
  }

  /** @returns {Geom.SixTuple} */
  toArray() {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  /**
   * Compute action of `this` on unit direction vector with angle
   * @see {radians} , then convert the latter back into an angle in [-π,π].
   * @param {number} radians
   */
  transformAngle(radians) {
    const unit = { x: Math.cos(radians), y: Math.sin(radians) };
    this.transformSansTranslate(unit);
    return Math.atan2(unit.y, unit.x);
  }

  /**
   * Compute action of `this` on unit direction vector with angle
   * @see {degrees} , then convert the latter back into an angle in [0, 360].
   * @param {number} degrees
   */
  transformDegrees(degrees) {
    const newDegrees = (180 / Math.PI) * this.transformAngle(degrees * (Math.PI / 180));
    return Math.round(newDegrees < 0 ? 360 + newDegrees : newDegrees);
  }

  /**
   * Transform point, mutating it.
   * @template {Geom.VectJson} T
   * @param {T} v
   * @returns {T}
   */
  transformPoint(v) {
    const x = this.a * v.x + this.c * v.y + this.e;
    const y = this.b * v.x + this.d * v.y + this.f;
    v.x = x;
    v.y = y;
    return v;
  }

  /**
   * Transform point, mutating it and ignoring translation.
   * @template {Geom.VectJson} T
   * @param {T} v
   * @returns {T}
   */
  transformSansTranslate(v) {
    const x = this.a * v.x + this.c * v.y;
    const y = this.b * v.x + this.d * v.y;
    v.x = x;
    v.y = y;
    return v;
  }

  /**
   * @param {number} offsetX
   * @param {number} offsetY
   */
  translate(offsetX, offsetY) {
    this.e += offsetX;
    this.f += offsetY;
    return this;
  }
}

/** @typedef {{ a: number; b: number; c: number; d: number; e: number; f: number }} MatrixJson */
