import { useStateRef } from "@npc-cli/util";
import type { Poly } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, cos, float, mix, positionGeometry, sin, step, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { alwaysShownSlot, ensureRoomSlots, slotOf } from "../service/room-slots";
import { varyingAs } from "../service/tsl";
import { WorldContext } from "./world-context";

/** A grey leafy plant on every `obstacle plant`, its pot. One draw call, each shaped by its `seed` */
export default function Plants() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      plants: [],

      collect() {
        state.plants = w.gms.flatMap((gm, gmId) =>
          gm.obstacles.flatMap((o, obstacleId) => {
            if (o.meta.plant !== true) return [];
            const { x, y } = o.center;
            const { a, b, c, d, e, f } = gm.transform;
            const potRadius = Math.min(o.origPoly.rect.width, o.origPoly.rect.height) / 2;
            const roomId = w.view.roomSlots.roomAt(gmId, o.center);
            const height = potRadius * heightPerPotRadius;
            return {
              gmId,
              obstacleId,
              x: a * x + c * y + e,
              z: b * x + d * y + f,
              top: o.height,
              height,
              reaches: reachesOf(gm, o.center, potRadius, roomId === null ? null : gm.rooms[roomId]).map(
                (r) => r / height,
              ),
              seed: typeof o.meta.seed === "number" ? o.meta.seed : obstacleId,
              slot: roomId === null ? alwaysShownSlot : slotOf(gmId, roomId),
            };
          }),
        );
      },
      positionInstances() {
        const { inst } = state;
        if (inst === null) return;
        const { geometry: geo } = inst;
        const slots = ensureRoomSlots(geo, state.plants.length);
        const [seeds, reachA, reachB] = ["plantSeed", "plantReachA", "plantReachB"].map(
          (name) => geo.getAttribute(name) as THREE.InstancedBufferAttribute,
        );
        for (const [i, { x, z, top, height, reaches: r, seed, slot }] of state.plants.entries()) {
          inst.setMatrixAt(i, tmpMat4.makeScale(height, height, height).setPosition(x, top, z));
          slots.setXY(i, slot, slot);
          seeds.setX(i, seed);
          reachA.setXYZW(i, r[0], r[1], r[2], r[3]);
          reachB.setXYZW(i, r[4], r[5], r[6], r[7]);
        }
        inst.instanceMatrix.needsUpdate = slots.needsUpdate = seeds.needsUpdate = true;
        reachA.needsUpdate = reachB.needsUpdate = true;
        inst.computeBoundingSphere();
      },
    }),
  );

  w.plants = state;

  const count = useMemo(() => (state.collect(), state.plants.length), [w.mapKey, w.hash]);

  const geometry = useMemo(() => {
    const geo = createPlantGeometry();
    // named by the material below, so on the geometry before it compiles
    ensureRoomSlots(geo, count);
    geo.setAttribute("plantSeed", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    geo.setAttribute("plantReachA", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    geo.setAttribute("plantReachB", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    return geo;
  }, [count]);

  const material = useMemo(() => {
    const [leaf, t, side] = [positionGeometry.x, positionGeometry.y, positionGeometry.z];
    const seed = attribute<"float">("plantSeed", "float");
    /** A `0`-`1` hash per leaf, the `k`th of several */
    const perLeaf = (k: number) => hash2(vec2(seed.add(k * 0.618), leaf.add(k * 7.31)));
    /** The same per plant */
    const perPlant = (k: number) => hash2(vec2(seed.add(k * 0.618), float(97 + k)));

    const [reachA, reachB] = [attribute<"vec4">("plantReachA", "vec4"), attribute<"vec4">("plantReachB", "vec4")];
    /** `1` at `k`, else `0` */
    const at = (j: THREE.Node<"float">, k: number) => step(j.sub(k).abs(), float(0.5));
    /** How far a leaf may reach along way `j` of `reachDirs` */
    const reachAt = (j: THREE.Node<"float">) =>
      reachA
        .dot(vec4(at(j, 0), at(j, 1), at(j, 2), at(j, 3)))
        .add(reachB.dot(vec4(at(j, 4), at(j, 5), at(j, 6), at(j, 7))));

    /** Inner leaves stand up, outer ones lean out */
    const outer = leaf.div(leafCount - 1);
    const kept = step(perLeaf(1), mix(float(0.6), float(1), perPlant(1)));
    const turn = leaf
      .mul(2.39996)
      .add(perPlant(4).mul(2 * Math.PI))
      .add(perLeaf(2).sub(0.5).mul(0.7));
    const tilt = mix(float(0.12), float(1.3), outer).add(perLeaf(3).sub(0.5).mul(0.3));
    const length = mix(float(0.55), float(1), perLeaf(4)).mul(kept);
    const width = mix(float(0.03), float(0.06), perLeaf(5)).mul(mix(float(0.8), float(1.3), perPlant(2)));
    const droop = mix(float(0.05), float(0.35), perLeaf(6)).mul(length).mul(outer.add(0.3));
    /** Its way round the pot, `0`-`reachDirs`, and how far it may go that way */
    const way = turn
      .div(2 * Math.PI)
      .fract()
      .mul(reachDirs);
    const [j0, frac] = [way.floor(), way.fract()];
    const room = mix(reachAt(j0), reachAt(j0.add(1).mod(reachDirs)), frac);
    /** Never past its `room`: clear of whoever walks by */
    const reach = sin(tilt).mul(length).mul(t).add(leafBaseOut).min(1).mul(room);
    /** Widest nearer its base, to a point */
    const breadth = width.mul(sin(t.pow(0.7).mul(Math.PI)));
    /** Its midrib raised, so its two halves fold apart */
    const rise = cos(tilt).mul(length).mul(t).sub(droop.mul(t).mul(t)).add(side.abs().oneMinus().mul(breadth).mul(0.6));
    const across = breadth.mul(side);
    const [along, aside] = [vec2(cos(turn), sin(turn)), vec2(sin(turn).negate(), cos(turn))];
    const positionNode = vec3(
      along.x.mul(reach).add(aside.x.mul(across)),
      rise,
      along.y.mul(reach).add(aside.y.mul(across)),
    );

    /** Grey, lighter towards its tip, one half lit more than the other, and darker down its midrib. Per vertex */
    const tone = varyingAs<"float">(
      mix(float(0.12), float(0.85), perLeaf(7))
        .mul(mix(float(0.6), float(1.3), perPlant(3)))
        .mul(mix(float(0.35), float(1), t))
        .mul(mix(float(0.7), float(1.05), side.mul(0.5).add(0.5)))
        .mul(mix(float(0.85), float(1), side.abs())),
      "plantTone",
    );
    const fade = w.view.fadeRoomsFx.getVisiblity(attribute<"vec2">("roomSlots", "vec2").x);
    const lit = vec4(w.view.playerLight.applyLight(vec3(tone)), 1);
    return {
      positionNode,
      colorNode: w.view.fadeRoomsFx.dropPickWhenHidden(
        w.view.fadeRoomsFx.applyFadeRgba(lit, fade),
        fade,
        w.view.objectPick,
      ),
      // never picked: a click passes through to its pot, or the floor
      maskNode: w.view.objectPick.equal(0),
      uid: crypto.randomUUID(),
    };
  }, [w.view.fadeRoomsFx.uid, w.view.playerLight.uid]);

  useEffect(() => {
    state.positionInstances();
    w.update();
  }, [w.mapKey, w.hash, geometry, material.uid]);

  return count > 0 ? (
    <instancedMesh
      key={`${count} ${material.uid}`}
      name="plants"
      ref={state.ref("inst")}
      args={[geometry, undefined, count]}
      frustumCulled={false}
    >
      <meshBasicNodeMaterial
        key={material.uid}
        side={THREE.DoubleSide}
        positionNode={material.positionNode}
        colorNode={material.colorNode}
        maskNode={material.maskNode}
      />
    </instancedMesh>
  ) : null;
}

/**
 * Every leaf as `leafRows` rows of three: its edges and its midrib. Its position is not where it is,
 * but which leaf, how far along it `0`-`1`, and which side `-1`, `0` or `1`: the material shapes it
 */
function createPlantGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let leaf = 0; leaf < leafCount; leaf++) {
    const base = positions.length / 3;
    for (let row = 0; row < leafRows; row++) {
      const t = row / (leafRows - 1);
      positions.push(leaf, t, -1, leaf, t, 0, leaf, t, 1);
      for (let col = 0; row > 0 && col < 2; col++) {
        const [a, c] = [base + 3 * (row - 1) + col, base + 3 * row + col];
        indices.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Metres a plant's leaves may reach each of `reachDirs` ways round its pot at `at`, from east clockwise.
 * Within its room, and `clearance` off the navmesh. At least `minReachPerPotRadius`
 */
function reachesOf(gm: Geomorph.LayoutInstance, at: Geom.VectJson, potRadius: number, room: null | Poly) {
  const max = potRadius * maxReachPerPotRadius;
  const far = max + clearance;
  const { vs, tris } = gm.navDecomp;
  /** The navmesh's triangles within reach */
  const near = tris.flatMap(([i, j, k]) => {
    const [p, q, r] = [vs[i], vs[j], vs[k]];
    const apart =
      Math.min(p.x, q.x, r.x) > at.x + far ||
      Math.max(p.x, q.x, r.x) < at.x - far ||
      Math.min(p.y, q.y, r.y) > at.y + far ||
      Math.max(p.y, q.y, r.y) < at.y - far;
    return apart ? [] : [[p, q, r] as const];
  });
  const clear = (p: Geom.VectJson) => near.every(([a, b, c]) => distToTri(p, a, b, c) >= clearance);
  return Array.from({ length: reachDirs }, (_, k) => {
    const angle = (2 * Math.PI * k) / reachDirs;
    // a way in the world, as the plant has no turn of its own, so in the geomorph turned back
    const way = gm.inverseMatrix.transformSansTranslate({ x: Math.cos(angle), y: Math.sin(angle) });
    let reach = potRadius * minReachPerPotRadius;
    for (let r = reach + reachStep; r <= max; r += reachStep) {
      const p = { x: at.x + way.x * r, y: at.y + way.y * r };
      if ((room !== null && room.contains(p) === false) || clear(p) === false) break;
      reach = r;
    }
    return reach;
  });
}

/** How far `p` is from triangle `a, b, c`: `0` inside it */
function distToTri(p: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson, c: Geom.VectJson) {
  const side = (u: Geom.VectJson, v: Geom.VectJson) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const [s, t, u] = [side(a, b), side(b, c), side(c, a)];
  if ((s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0)) return 0;
  return Math.min(distToSeg(p, a, b), distToSeg(p, b, c), distToSeg(p, c, a));
}

function distToSeg(p: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const lengthSq = dx * dx + dy * dy;
  const along = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
}

/** A `0`-`1` hash of `cell`, with no trig in it (Hoskins' `hash12`) */
function hash2(cell: THREE.Node<"vec2">) {
  const p = cell.xyx.mul(0.1031).fract();
  const q = p.add(p.dot(p.yzx.add(33.33)));
  return q.x.add(q.y).mul(q.z).fract() as THREE.Node<"float">;
}

/** Leaves per plant, some left out by its seed */
const leafCount = 24;
/** Rows of vertices along each leaf */
const leafRows = 7;
/** How far out from its pot's middle each leaf starts, as a multiple of `height` */
const leafBaseOut = 0.08;
/** A plant's height, as a multiple of its pot's radius */
const heightPerPotRadius = 2.8;
/** Ways round a pot a leaf's reach is worked out, in two `vec4`s */
const reachDirs = 8;
/** Furthest a leaf reaches, as a multiple of its pot's radius */
const maxReachPerPotRadius = 3;
/** Metres a leaf keeps off the navmesh: under a walker's radius, so it leans their way a little */
const clearance = 0.1;
/** Least a leaf reaches any way, as a multiple of its pot's radius */
const minReachPerPotRadius = 1.4;
/** Metres between the points tried along each way */
const reachStep = 0.02;

const tmpMat4 = new THREE.Matrix4();

export type Plant = {
  gmId: number;
  obstacleId: number;
  /** World position of its pot's middle */
  x: number;
  z: number;
  /** Its pot's top, which it grows from */
  top: number;
  /** Metres, from its pot's radius */
  height: number;
  /** How far its leaves may reach each of `reachDirs` ways, as a multiple of `height` */
  reaches: number[];
  seed: number;
  /** Its room's slot, which it fades with */
  slot: number;
};

export type State = {
  inst: null | THREE.InstancedMesh;
  plants: Plant[];
  /** Finds every plant's pot among the obstacles */
  collect(): void;
  positionInstances(): void;
};
