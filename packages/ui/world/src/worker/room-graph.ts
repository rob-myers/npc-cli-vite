/**
 * Room reachability, answered off the main thread.
 *
 * The main thread sends `gmRoomGraph` as plain arrays (`getRoomGraphPayload`) and keeps this
 * module's idea of which doors are locked or open in step; in return it can ask whether an npc can
 * get from one room to another, and which door would stop them if not.
 *
 * 🔔 Imports nothing: a worker module which shares any `ui/world` module breaks after a couple of
 * hot reloads — the same reason the navmesh and physics take crafted payloads rather than geomorphs.
 */

/** `nodeType` values, matching `getRoomGraphPayload` */
const ROOM = 0;
const DOOR = 1;
const WINDOW = 2;

let graph: null | WW.RoomGraphForWorker = null;
/** Per NODE index, so a door's flags sit where the graph knows the door */
let lockedByIndex: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
let openByIndex: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
/**
 * Components over the doors ANYONE may pass, i.e. the unlocked ones. Built on demand and kept
 * until a door's lock changes — the npc-specific view is never worth keeping, since it moves with
 * the doors standing open
 */
let reachability: null | Components = null;

type Components = {
  componentOf(index: number): number;
  connected(a: number, b: number): boolean;
};

export function setRoomGraph(msg: WW.RequestRoomGraph): void {
  graph = msg.roomGraph;
  lockedByIndex = new Uint8Array(msg.roomGraph.nodeType.length);
  openByIndex = new Uint8Array(msg.roomGraph.nodeType.length);
  reachability = null;
}

/**
 * Every query carries the door state with it, so nothing has to be kept in step. The cached
 * components survive it unless a LOCK has changed — a door opening or closing cannot join or sever
 * rooms for everyone, only for whoever is asking
 */
function adoptDoorState(msg: WW.RequestUnreachable): void {
  if (lockedByIndex.length !== msg.locked.length || lockedByIndex.some((x, i) => x !== msg.locked[i])) {
    reachability = null;
  }
  lockedByIndex = msg.locked;
  openByIndex = msg.open;
}

/**
 * Mirrors the main thread's `testTargetUnreachable`, minus the geometry: given where the npc is and
 * which doors they hold keys to, either they can get there (`null`) or here is the door they would
 * walk up to and be stopped by, with the room on their own side of it.
 */
export function findUnreachableResult(msg: WW.RequestUnreachable): WW.UnreachableResult["blocked"] {
  if (graph === null) {
    return null; // no graph yet, so nothing is known to be blocked
  }

  adoptDoorState(msg);

  // Reachable via unlocked doors alone i.e. independent of npc's keys?
  reachability ??= connectedComponents(graph, (index) => canAnyoneUseNode(index, true));
  if (reachability.connected(msg.srcIndex, msg.dstIndex) === true) {
    return null;
  }

  // Reachable via npc's keys or currently open locked doors?
  const access = new Set(msg.accessDoorIndices);
  const canUseNode = (index: number) => canAnyoneUseNode(index, false) || access.has(index);
  const components = connectedComponents(graph, canUseNode);
  if (components.connected(msg.srcIndex, msg.dstIndex) === true) {
    return null;
  }

  return findBlockingDoor(graph, canUseNode, msg);
}

/**
 * Whether a node is a way through for anybody. Windows never are — light passes through glass, but
 * npcs do not. `unlockedOnly` asks the stricter question, ignoring the doors standing open, which
 * anyone may slip through whilst they last
 */
function canAnyoneUseNode(index: number, unlockedOnly: boolean): boolean {
  const type = (graph as WW.RoomGraphForWorker).nodeType[index];
  if (type !== DOOR) {
    return type === ROOM;
  }
  return lockedByIndex[index] === 0 || (unlockedOnly === false && openByIndex[index] === 1);
}

/**
 * The first door on the way there that this npc cannot pass — found by routing to the destination
 * as though every door were open, then walking that route until one stops them, along with the last
 * room they reach before it. Which door blocks them is a question about the ROUTE: standing beside
 * a locked door they were not heading for, the nearest door is not the one that stops them
 */
function findBlockingDoor(
  roomGraph: WW.RoomGraphForWorker,
  canUseNode: (index: number) => boolean,
  msg: WW.RequestUnreachable,
): WW.UnreachableResult["blocked"] {
  const { nodeType } = roomGraph;
  const route = findRoute(roomGraph, msg.srcIndex, msg.dstIndex);

  for (let i = 1; i < route.length; i++) {
    const index = route[i];
    if (nodeType[index] !== DOOR || canUseNode(index) === true) {
      continue;
    }

    // where they get to: the last room before it. Not simply `route[i - 1]`, since a hull door's
    // route runs room, door, door, room — the pair being the crossing between two geomorphs
    for (let j = i - 1; j >= 0; j--) {
      if (nodeType[route[j]] === ROOM) {
        return { doorIndex: index, roomIndex: route[j] };
      }
    }
    return null; // they are already in the doorway
  }

  return null;
}

/**
 * The shortest way from one node to another with every door open — windows excluded, since they are
 * not a way through for anyone. Dijkstra over centroid distances, which for a couple of hundred
 * rooms is quicker than the machinery a heap would add. `[]` when there is no way at all
 */
function findRoute(roomGraph: WW.RoomGraphForWorker, srcIndex: number, dstIndex: number): number[] {
  const { nodeType, centroid, adjOffset, adjNode } = roomGraph;

  const cost = new Float64Array(nodeType.length).fill(Infinity);
  const cameFrom = new Int32Array(nodeType.length).fill(-1);
  const done = new Uint8Array(nodeType.length);
  cost[srcIndex] = 0;

  for (;;) {
    let at = -1;
    for (let i = 0; i < nodeType.length; i++) {
      if (done[i] === 0 && cost[i] < (at === -1 ? Infinity : cost[at])) at = i;
    }
    if (at === -1) {
      return []; // nothing reachable is left, so the destination never was
    }
    if (at === dstIndex) {
      break;
    }
    done[at] = 1;

    for (let j = adjOffset[at]; j < adjOffset[at + 1]; j++) {
      const next = adjNode[j];
      if (done[next] === 1 || nodeType[next] === WINDOW) continue;
      const stepCost =
        cost[at] + distance(centroid[2 * at], centroid[2 * at + 1], centroid[2 * next], centroid[2 * next + 1]);
      if (stepCost < cost[next]) {
        cost[next] = stepCost;
        cameFrom[next] = at;
      }
    }
  }

  const route = [dstIndex];
  for (let at = cameFrom[dstIndex]; at !== -1; at = cameFrom[at]) route.unshift(at);
  return route;
}

/**
 * Connected component node-partition, permitting efficient connectivity testing.
 * @param canUseNode `false` nodes become isolated singletons.
 */
function connectedComponents(roomGraph: WW.RoomGraphForWorker, canUseNode: (index: number) => boolean): Components {
  const { nodeType, adjOffset, adjNode } = roomGraph;

  // every node begins as its own component, and unions collapse them together
  const parent = new Int32Array(nodeType.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const rank = new Uint8Array(nodeType.length);

  /** The component's representative, flattening the chain it walked on the way */
  function find(i: number) {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) [i, parent[i]] = [parent[i], root];
    return root;
  }

  function union(a: number, b: number) {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA === rootB) return;
    // by rank, so the tree stays shallow and `find` stays fast
    if (rank[rootA] < rank[rootB]) parent[rootA] = rootB;
    else if (rank[rootA] > rank[rootB]) parent[rootB] = rootA;
    else (parent[rootB] = rootA), rank[rootA]++;
  }

  for (let i = 0; i < nodeType.length; i++) {
    if (canUseNode(i) === false) continue;
    for (let j = adjOffset[i]; j < adjOffset[i + 1]; j++) {
      if (canUseNode(adjNode[j]) === true) union(i, adjNode[j]);
    }
  }

  return {
    componentOf: (index) => find(index),
    connected: (a, b) => find(a) === find(b),
  };
}

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}
