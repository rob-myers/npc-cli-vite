import { color, Fn, float, mix, pass, screenSize, screenUV, step, vec2, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { State as WorldType } from "../components/World";

/**
 * debug: thick red lines about the base of every room the player's light reaches —
 * `FadeRooms.rooms` — over the finished frame, whatever `mode` is showing, so in `"ship"` they say
 * which rooms the player could see.
 *
 * Standalone: it renders those bases itself, in a pass of its own over a scene holding nothing
 * else, and the lines are wherever that pass's coverage ends. So nothing in the world takes part —
 * no material writes a mark, and no wall, obstacle or npc gets in the way: the lines are drawn
 * over everything, and follow the room polygons exactly
 */
export function createRoomOutline(): RoomOutline {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  material.colorNode = vec4(1, 1, 1, 1);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    uid: crypto.randomUUID(),
    scene,

    sync(w) {
      const seen = new Set<string>();
      const vertices: number[] = [];
      const indices: number[] = [];

      for (const { gmId, roomId, grKey } of w.view.fadeRoomsFx.rooms) {
        if (seen.has(grKey) === true) continue; // lit rooms may repeat those in view
        seen.add(grKey);
        const gm = w.gms[gmId];
        const room = gm?.rooms[roomId];
        if (gm === undefined || room === undefined) continue;
        const { vs, tris } = room.clone().applyMatrix(gm.matrix).fastTriangulate();
        const offset = vertices.length / 3;
        for (const v of vs) vertices.push(v.x, 0, v.y);
        for (const tri of tris) indices.push(tri[0] + offset, tri[1] + offset, tri[2] + offset);
      }

      mesh.geometry.dispose();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
      geometry.setIndex(indices);
      mesh.geometry = geometry;
      w.r3f?.invalidate();
    },

    apply(frame, camera) {
      // the bases alone, as coverage: `1` where a room in view is, `0` everywhere else
      const bases = pass(scene, camera).getTextureNode("output");

      // wrapped in a `Fn` for the same reason `applyNpcOutline` is — a `var` assigned outside one
      // is dropped silently
      return Fn(() => {
        const onePx = vec2(1, 1).div(screenSize);
        const here = step(0.5, bases.a);
        // any tap on the other side of the edge from here — so the line is centred on it
        const edge = float(0).toVar();
        for (const [dx, dy] of taps) {
          const there = step(0.5, bases.sample(screenUV.add(onePx.mul(vec2(dx, dy)))).a);
          edge.assign(edge.max(there.sub(here).abs()));
        }
        return vec4(mix(frame.rgb, outlineColor, edge.mul(outlineAlpha)), frame.a);
      })();
    },
  };
}

export type RoomOutline = {
  /** Changes whenever this is rebuilt — the pipeline captured its nodes, so it must be rebuilt too */
  uid: string;
  /** Holds the bases and nothing else */
  scene: THREE.Scene;
  /** Rebuilds the bases from `w.view.fadeRoomsFx.rooms` — see `update-faded-rooms` */
  sync(w: WorldType): void;
  /**
   * `frame` with the lines over it. Renders the bases with `camera`, so this belongs in the
   * pipeline that renders the world with it
   */
  apply(frame: THREE.Node<"vec4">, camera: THREE.Camera): THREE.Node<"vec4">;
};

const outlineColor = /* @__PURE__ */ color("#ff3c3c");
const outlineAlpha = 1;
/** How far out the taps reach, in pixels — the line is twice this wide, centred on the edge */
const outlineWidthPx = 3;

/**
 * Two rings of eight, the diagonals shortened so the line keeps an even width, and the inner one
 * so a thin edge between two taps of the outer is not missed
 */
const diag = Math.SQRT1_2;
const ring = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [diag, diag],
  [diag, -diag],
  [-diag, diag],
  [-diag, -diag],
];
const taps = [
  ...ring.map(([x, y]) => [x * outlineWidthPx, y * outlineWidthPx]),
  ...ring.map(([x, y]) => [x * outlineWidthPx * 0.5, y * outlineWidthPx * 0.5]),
];
