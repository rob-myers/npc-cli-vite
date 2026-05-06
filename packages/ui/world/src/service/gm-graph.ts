import { BaseGraph, createBaseAstar } from "@npc-cli/graph";
import type { StarShipGeomorphKey, StarshipGeomorphNumber } from "@npc-cli/media/starship-symbol";
import { directionChars, geomService, Mat, Rect } from "@npc-cli/util/geom";
import { error } from "@npc-cli/util/legacy/generic";
import { AStar } from "../pathfinding/AStar";
import { createGmIdGrid, queryGmIdGrid } from "./grid";
import { helper } from "./helper";

export class GmGraph extends BaseGraph<Graph.GmGraphNode, Graph.GmGraphEdgeOpts> {
  gms: Geomorph.LayoutInstance[];
  gmNodeByGmId: { [gmId: number]: Graph.GmGraphNodeGm[] };
  doorNodeByGmId: { [gmId: number]: Graph.GmGraphNodeDoor[] };
  entry: Map<Graph.GmGraphNodeDoor, Geom.Vect>;
  adjRoomCtxt = new Map<`${number}-${number}`, Graph.GmAdjRoomCtxt | null>();
  gmIdGrid: Geomorph.GmIdGrid = {};

  constructor(gms: Geomorph.LayoutInstance[]) {
    super();
    this.gms = gms.slice();
    this.entry = new Map();
    this.gmNodeByGmId = gms.reduce((agg, _, gmId) => ({ ...agg, [gmId]: [] }), {});
    this.doorNodeByGmId = gms.reduce((agg, _, gmId) => ({ ...agg, [gmId]: [] }), {});
    this.gmIdGrid = createGmIdGrid(gms);
  }

  static computeHullDoorDirection(
    hullDoor: Geomorph.Connector,
    hullDoorId: number,
    transform: Geom.SixTuple,
    gmKey: StarShipGeomorphKey,
  ): null | Geom.DirectionString {
    const { edge: hullDir } = hullDoor.meta as Geomorph.HullDoorMeta;
    if (geomService.isDirectionChar(hullDir)) {
      const direction = directionChars.indexOf(hullDir) as Geom.Direction;
      const ime1 = { x: transform[0], y: transform[1] };
      const ime2 = { x: transform[2], y: transform[3] };

      if (ime1.x === 1) {
        if (ime2.y === 1) return hullDir;
        if (ime2.y === -1) return directionChars[geomService.getFlippedDirection(direction, "x")];
      } else if (ime1.y === 1) {
        if (ime2.x === 1)
          return directionChars[geomService.getFlippedDirection(geomService.getDeltaDirection(direction, 2), "y")];
        if (ime2.x === -1) return directionChars[geomService.getDeltaDirection(direction, 1)];
      } else if (ime1.x === -1) {
        if (ime2.y === 1) return directionChars[geomService.getFlippedDirection(direction, "y")];
        if (ime2.y === -1) return directionChars[geomService.getDeltaDirection(direction, 2)];
      } else if (ime1.y === -1) {
        if (ime2.x === 1) return directionChars[geomService.getDeltaDirection(direction, 3)];
        if (ime2.x === -1)
          return directionChars[geomService.getFlippedDirection(geomService.getDeltaDirection(direction, 3), "y")];
      }
      error(`${gmKey}: hull door ${hullDoorId}: ${hullDir}: failed to parse transform "${transform}"`);
    } else if (!hullDoor.meta.sealed) {
      error(`${gmKey}: unsealed hull door ${hullDoorId}: meta.hullDir "${hullDir}" must be in {n,e,s,w}`);
    }
    return null;
  }

  dispose() {
    super.dispose();
    this.gms.length = 0;
    this.entry.clear();
    this.adjRoomCtxt.clear();
    this.gmIdGrid = {};
  }

  findGmIdContaining(point: Geom.VectJson): number | null {
    return queryGmIdGrid(this.gmIdGrid, point);
  }

  findGmNodeIdContaining(
    point: Geom.VectJson,
    gmId: number | undefined = this.findGmIdContaining(point) ?? undefined,
  ): number | null {
    if (typeof gmId === "number") {
      return this.gmNodeByGmId[gmId].find((node) => node.rect.contains(point))?.index ?? null;
    }
    return null;
  }

  findPath(src: Geom.VectJson, dst: Geom.VectJson) {
    const srcGmNodeId = this.findGmNodeIdContaining(src);
    const dstGmNodeId = this.findGmNodeIdContaining(dst);
    if (srcGmNodeId === null || dstGmNodeId === null) {
      return null;
    }

    const srcNode = this.nodesArray[srcGmNodeId];
    const dstNode = this.nodesArray[dstGmNodeId];
    const { pathOrPrefix: gmPath } = AStar.search({
      graph: this,
      start: srcNode,
      end: dstNode,
      setNodeWeights: (nodes) => {
        nodes[srcNode.index].astar.centroid.copy(src);
        nodes[dstNode.index].astar.centroid.copy(dst);
      },
    });

    let pre: Graph.GmGraphNodeDoor;
    let post: Graph.GmGraphNodeDoor;
    const gmEdges: Graph.NavGmTransition[] = [];
    for (let i = 1; i < gmPath.length; i += 3) {
      pre = gmPath[i] as Graph.GmGraphNodeDoor;
      post = gmPath[i + 1] as Graph.GmGraphNodeDoor;
      gmEdges.push({
        srcGmId: pre.gmId,
        srcRoomId: this.gms[pre.gmId].doors[pre.doorId].roomIds.find((x) => x !== null) as number,
        srcDoorId: pre.doorId,
        srcHullDoorId: pre.hullDoorId,
        srcDoorEntry: this.entry.get(pre) as Geom.Vect,

        dstGmId: post.gmId,
        dstRoomId: this.gms[post.gmId].doors[post.doorId].roomIds.find((x) => x !== null) as number,
        dstDoorId: post.doorId,
        dstHullDoorId: post.hullDoorId,
        dstDoorEntry: this.entry.get(post) as Geom.Vect,
      });
    }

    return gmEdges;
  }

  getAdjacentDoor(node: Graph.GmGraphNode) {
    return this.getSuccs(node).find((x): x is Graph.GmGraphNodeDoor => x.type === "door") ?? null;
  }

  getAdjacentRoomCtxt(gmId: number, hullDoorId: number): Graph.GmAdjRoomCtxt | null {
    const cacheKey = `${gmId}-${hullDoorId}` as const;
    let cached = this.adjRoomCtxt.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const gm = this.gms[gmId];
    const doorNodeId = getGmDoorNodeId(gm.num, extractTransform(gm), hullDoorId);
    const doorNode = this.getNode(doorNodeId);
    if (!doorNode) {
      console.error(`${GmGraph.name}: failed to find hull door node: ${doorNodeId}`);
      return this.adjRoomCtxt.set(cacheKey, null), null;
    }
    const otherDoorNode = this.getSuccs(doorNode).find((x) => x.type === "door") as Graph.GmGraphNodeDoor | undefined;
    if (!otherDoorNode) {
      return this.adjRoomCtxt.set(cacheKey, null), null;
    }

    const { gmId: adjGmId, hullDoorId: dstHullDoorId, doorId: adjDoorId } = otherDoorNode;
    const { roomIds } = this.gms[adjGmId].hullDoors[dstHullDoorId];
    const adjRoomId = roomIds.find((x) => typeof x === "number") as number;
    const adjGmRoomKey = helper.getGmRoomKey(adjGmId, adjRoomId);

    cached = {
      adjGmId,
      adjRoomId,
      adjHullId: dstHullDoorId,
      adjDoorId,
      adjGmRoomKey,
      adjGdKey: `g${adjGmId}d${adjDoorId}`,
    };
    return this.adjRoomCtxt.set(cacheKey, cached), cached;
  }

  getConnectedDoorsBySide(gmId: number, sideDir: Geom.DirectionString) {
    return this.doorNodeByGmId[gmId].filter((x) => !x.sealed && x.direction === sideDir);
  }

  getOtherGmRoomId(door: Geomorph.DoorState, roomId: number): Geomorph.GmRoomId | null {
    if (door.hull === false) {
      const otherRoomId = door.connector.roomIds.find((x) => x !== roomId) ?? null;
      return otherRoomId === null ? null : helper.getGmRoomId(door.gmId, otherRoomId);
    } else {
      const adj = this.getAdjacentRoomCtxt(door.gmId, door.doorId);
      return adj === null ? null : helper.getGmRoomId(adj.adjGmId, adj.adjRoomId);
    }
  }

  getDoorNodeById(gmId: number, hullDoorId: number) {
    const gm = this.gms[gmId];
    const nodeId = getGmDoorNodeId(gm.num, extractTransform(gm), hullDoorId);
    return this.getNode(nodeId) as Graph.GmGraphNodeDoor;
  }

  isHullDoorSealed(gmId: number, hullDoorId: number) {
    const doorNode = this.getDoorNodeById(gmId, hullDoorId);
    if (doorNode === null) {
      console.warn(`hull door node not found: ${JSON.stringify({ gmId, hullDoorId })}`);
      return true;
    }
    return doorNode.sealed;
  }

  isOnOtherSide(door: Geomorph.DoorState, roomId: number, point: Geom.VectJson): boolean {
    const dp = (point.x - door.src.x) * door.normal.x + (point.y - door.src.y) * door.normal.y;
    if (door.hull === false) {
      const index = door.connector.roomIds.indexOf(roomId);
      return dp * (index === 0 ? 1 : -1) < 0;
    } else {
      return dp > 0;
    }
  }

  static fromGms(gms: Geomorph.LayoutInstance[], { permitErrors } = { permitErrors: false }) {
    const graph = new GmGraph(gms);
    let index = 0;

    const nodes: Graph.GmGraphNode[] = [
      ...gms.flatMap((gm, gmId) =>
        gm.navRects.map(
          (navRect, navRectId): Graph.GmGraphNodeGm => ({
            type: "gm",
            gmKey: gm.key,
            gmId,
            id: getGmNodeId(gm.num, extractTransform(gm), navRectId),
            transform: extractTransform(gm),
            navRectId,
            rect: navRect.clone().applyMatrix(gm.matrix),
            ...createBaseAstar({
              centroid: gm.matrix.transformPoint(gm.bounds.center),
            }),
            index: index++,
          }),
        ),
      ),

      ...gms.flatMap(({ key: gmKey, num: gmNum, hullDoors, matrix, transform, bounds, doors }, gmId) =>
        hullDoors.map((hullDoor, hullDoorId): Graph.GmGraphNodeDoor => {
          const alongNormal = hullDoor.center.clone().addScaled(hullDoor.normal, 20);
          const gmInFront = bounds.contains(alongNormal);
          const tf = extractTransform({ transform });
          const direction = GmGraph.computeHullDoorDirection(hullDoor, hullDoorId, tf, gmKey);
          return {
            type: "door",
            gmKey,
            gmId,
            id: getGmDoorNodeId(gmNum, tf, hullDoorId),
            doorId: doors.indexOf(hullDoor),
            hullDoorId,
            transform: tf,
            gmInFront,
            direction,
            sealed: true,
            ...createBaseAstar({
              centroid: matrix.transformPoint(hullDoor.center.clone()),
            }),
            index: index++,
          };
        }),
      ),
    ];

    graph.registerNodes(nodes);

    nodes.forEach((node) => {
      if (node.type === "door") {
        const { matrix, doors } = gms[node.gmId];
        const nonNullIndex = doors[node.doorId].roomIds.findIndex((x) => x !== null);
        const entry = doors[node.doorId].entries[nonNullIndex] as Geom.Vect | undefined;
        if (entry !== undefined) {
          graph.entry.set(node, matrix.transformPoint(entry.clone()));
        } else if (permitErrors === true) {
          error(`door ${node.doorId} lacks entry`);
        } else {
          throw Error(`${node.gmKey}: door ${node.doorId} lacks entry`);
        }
      }
    });

    graph.nodesArray.forEach((node) =>
      node.type === "gm" ? graph.gmNodeByGmId[node.gmId].push(node) : graph.doorNodeByGmId[node.gmId].push(node),
    );

    Object.values(graph.gmNodeByGmId).forEach((nodes) => nodes.sort((a, b) => (a.rect.area < b.rect.area ? -1 : 1)));

    const localEdges: Graph.GmGraphEdgeOpts[] = gms.flatMap(({ num: gmNum, hullDoors, transform }) => {
      const tf = extractTransform({ transform });
      return hullDoors.map(({ navRectId }, hullDoorId) => ({
        src: getGmNodeId(gmNum, tf, navRectId),
        dst: getGmDoorNodeId(gmNum, tf, hullDoorId),
      }));
    });

    const globalEdges = gms.flatMap((srcGm, gmId) => {
      const adjItems = gms.filter((dstGm, dstGmId) => dstGmId !== gmId && dstGm.gridRect.intersects(srcGm.gridRect));
      const [srcRect, dstRect] = [new Rect(), new Rect()];
      const [srcMatrix, dstMatrix] = [new Mat(), new Mat()];

      return srcGm.hullDoors.flatMap((srcDoor, hullDoorId) => {
        const srcDoorNodeId = getGmDoorNodeId(srcGm.num, extractTransform(srcGm), hullDoorId);
        srcMatrix.setMatrixValue(srcGm.transform);
        srcRect.copy(srcDoor.poly.rect.applyMatrix(srcMatrix));

        const gmDoorPairs = adjItems.flatMap((gm) => gm.hullDoors.map((door) => [gm, door] as const));
        const matching = gmDoorPairs.find(([{ transform }, { poly }]) =>
          srcRect.intersects(dstRect.copy(poly.rect.applyMatrix(dstMatrix.setMatrixValue(transform)))),
        );
        if (matching !== undefined) {
          const [dstGm, dstDoor] = matching;
          const dstHullDoorId = dstGm.hullDoors.indexOf(dstDoor);
          const dstDoorNodeId = getGmDoorNodeId(dstGm.num, extractTransform(dstGm), dstHullDoorId);
          (graph.getNode(srcDoorNodeId) as Graph.GmGraphNodeDoor).sealed = false;
          return { src: srcDoorNodeId, dst: dstDoorNodeId };
        } else {
          return [];
        }
      });
    });

    [...localEdges, ...globalEdges].forEach(({ src, dst }) => {
      if (src && dst) {
        graph.connect({ src, dst });
        graph.connect({ src: dst, dst: src });
      }
    });

    graph.edgesArray.forEach(({ src, dst }) => src.astar.neighbours.push(dst.index));

    return graph;
  }

  get ready() {
    return this.gms.length > 0;
  }
}

function extractTransform(gm: {
  transform: { a: number; b: number; c: number; d: number; e: number; f: number };
}): Geom.SixTuple {
  const { a, b, c, d, e, f } = gm.transform;
  return [a, b, c, d, e, f];
}

function getGmNodeId(gmNumber: StarshipGeomorphNumber, transform: Geom.SixTuple, navRectId: number) {
  return `gm-${gmNumber}-[${transform}]--${navRectId}`;
}

function getGmDoorNodeId(gmNumber: StarshipGeomorphNumber, transform: Geom.SixTuple, hullDoorId: number) {
  return `door-${gmNumber}-[${transform}]--${hullDoorId}`;
}
