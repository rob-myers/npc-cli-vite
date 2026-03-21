import { geomService } from "@npc-cli/util";
import { Poly, Vect } from "@npc-cli/util/geom";
import { connectorEntranceHalfDepth, doorDepth, hullDoorDepth, precision, wallOutset } from "./geomorph";

export class Connector {
  poly: Geom.Poly;
  center: Geom.Vect;
  meta: Meta;
  baseRect: Geom.Rect;
  /** radians */
  angle: number;
  /** segment through middle of door */
  seg: [Geom.Vect, Geom.Vect];
  normal: Geom.Vect;
  /**
   * Aligned to roomIds i.e. `[infront, behind]`
   * where a room is infront if normal is pointing towards it.
   */
  entries: [Geom.Vect, Geom.Vect];
  /**
   * `[id of room infront, id of room behind]`
   * - a room is *infront* if `normal` is pointing towards it.
   * - hull doors have form `[null, roomId]` because their normal points outwards
   */
  roomIds: [null | number, null | number];
  /** overridden later */
  navRectId: number;

  /**
   * Usually a rotated rectangle, but could be a curved window,
   * in which case we'll view it as its AABB.
   */
  constructor(poly: Geom.Poly) {
    // 🔔 orientation MUST be clockwise w.r.t y-downwards
    poly.fixOrientationConvex();

    this.poly = poly;
    this.center = poly.center;
    this.meta = poly.meta || {};

    const { angle, baseRect } = geomService.polyToAngledRect(poly);

    this.baseRect = baseRect;
    this.angle = angle;

    const {
      seg: [u, v],
      normal,
    } = geomService.getAngledRectSeg({ angle, baseRect });

    this.seg = [u, v];
    this.normal = normal;

    // 🔔 hull door normals should point outwards
    if (this.meta.hull === true) {
      const edge = (this.meta as Meta<{ edge: "n" | "e" | "s" | "w" }>).edge;
      if (
        (edge === "n" && this.normal.y > 0) ||
        (edge === "e" && this.normal.x < 0) ||
        (edge === "s" && this.normal.y < 0) ||
        (edge === "w" && this.normal.x > 0)
      ) {
        this.normal.scale(-1);
        this.seg = [v, u];
      }
    }

    /**
     * 🔔 every unsealed hull door is auto
     * 🔔 unsealed non-hull locked doors default to auto
     */
    if (
      this.meta.sealed !== true &&
      (this.meta.hull === true || (this.meta.manual !== true && this.meta.locked === true))
    ) {
      this.meta.auto = true;
    }

    // 🚧 offset needed?
    const doorEntryDelta = 0.5 * baseRect.height + 0.05;
    const inFront = poly.center.addScaled(normal, doorEntryDelta).precision(precision);
    const behind = poly.center.addScaled(normal, -doorEntryDelta).precision(precision);

    this.entries = [inFront, behind];
    this.roomIds = [null, null];
    this.navRectId = -1;
  }

  get json(): Geomorph.ConnectorJson {
    return {
      poly: Object.assign(this.poly.geoJson, { meta: this.meta }),
      navRectId: this.navRectId,
      roomIds: [this.roomIds[0], this.roomIds[1]],
    };
  }

  static from(json: Geomorph.ConnectorJson) {
    const connector = new Connector(Object.assign(Poly.from(json.poly), { meta: json.poly.meta }));
    connector.navRectId = json.navRectId;
    connector.roomIds = json.roomIds;
    return connector;
  }

  /**
   * Doorways are the navigable entries/exits of a door.
   * - They are not as wide as the door by `2 * wallOutset`.
   * - They are deeper then the door by
   *   (a) `wallOutset` for hull doors.
   *   (b) `2 * wallOutset` for non-hull doors.
   */
  computeDoorway(extrudeDoorDepth = wallOutset, halfWidth?: number): Geom.Poly {
    const doorHalfDepth = 0.5 * (this.meta.hull ? hullDoorDepth : doorDepth);
    const inwardsExtrude = extrudeDoorDepth;
    /**
     * For hull doors, normals point outwards from geomorphs,
     * and we exclude "outer part" of doorway to fix doorway normalization.
     */
    const outwardsExtrude = this.meta.hull === true ? 0 : extrudeDoorDepth;

    const normal = this.normal;
    const delta = tmpVect1.copy(this.seg[1]).sub(this.seg[0]);
    const length = delta.length;

    halfWidth ??= length / 2 - wallOutset;
    const offset = halfWidth / length;

    return new Poly([
      new Vect(
        this.center.x + delta.x * offset + normal.x * (doorHalfDepth + outwardsExtrude),
        this.center.y + delta.y * offset + normal.y * (doorHalfDepth + outwardsExtrude),
      ),
      new Vect(
        this.center.x - delta.x * offset + normal.x * (doorHalfDepth + outwardsExtrude),
        this.center.y - delta.y * offset + normal.y * (doorHalfDepth + outwardsExtrude),
      ),
      new Vect(
        this.center.x - delta.x * offset - normal.x * (doorHalfDepth + inwardsExtrude),
        this.center.y - delta.y * offset - normal.y * (doorHalfDepth + inwardsExtrude),
      ),
      new Vect(
        this.center.x + delta.x * offset - normal.x * (doorHalfDepth + inwardsExtrude),
        this.center.y + delta.y * offset - normal.y * (doorHalfDepth + inwardsExtrude),
      ),
    ]).fixOrientationConvex();
  }

  /**
   * Cannot re-use `computeDoorway` because it accounts for "outer hull door".
   * The first segment is pointed to by `normal`.
   */
  computeEntrances(): [Geom.Vect, Geom.Vect, Geom.Vect, Geom.Vect] {
    const entranceHalfDepth =
      this.meta.hull === true ? connectorEntranceHalfDepth.hull : connectorEntranceHalfDepth.nonHull;
    const normal = this.normal;
    const delta = tmpVect1.copy(this.seg[1]).sub(this.seg[0]);
    const length = delta.length;
    const halfWidth = length / 2 - wallOutset;
    const offset = halfWidth / length;

    return [
      new Vect(
        this.center.x + delta.x * offset + normal.x * entranceHalfDepth,
        this.center.y + delta.y * offset + normal.y * entranceHalfDepth,
      ),
      new Vect(
        this.center.x - delta.x * offset + normal.x * entranceHalfDepth,
        this.center.y - delta.y * offset + normal.y * entranceHalfDepth,
      ),
      new Vect(
        this.center.x - delta.x * offset - normal.x * entranceHalfDepth,
        this.center.y - delta.y * offset - normal.y * entranceHalfDepth,
      ),
      new Vect(
        this.center.x + delta.x * offset - normal.x * entranceHalfDepth,
        this.center.y + delta.y * offset - normal.y * entranceHalfDepth,
      ),
    ];
  }

  /**
   * The thin polygon is the connector polygon with its depth restricted,
   * so it doesn't jut out from its surrounding walls.
   */
  computeThinPoly(extraDepth = 0): Geom.Poly {
    const height = (this.meta.hull ? hullDoorDepth : doorDepth) + extraDepth;
    const hNormal = this.normal;
    const topLeft = this.seg[0].clone().addScaled(hNormal, -height / 2);
    const botLeft = topLeft.clone().addScaled(hNormal, height);
    const botRight = this.seg[1].clone().addScaled(hNormal, height / 2);
    const topRight = botRight.clone().addScaled(hNormal, -height);
    return new Poly([topLeft, botLeft, botRight, topRight], undefined, this.meta).fixOrientation();
  }
}

const tmpVect1 = new Vect();
