import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
import { attribute, cos, float, mix, positionGeometry, sin, step, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { alwaysShownSlot, ensureRoomSlots, slotOf } from "../service/room-slots";
import { WorldContext } from "./world-context";

/** A grey leafy plant on every `obstacle plant`, its pot. One draw call, each shaped by its `seed` */
export default function Plants() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      plants: [],

      collect() {
        state.plants = w.gms.flatMap(({ obstacles, transform: { a, b, c, d, e, f } }, gmId) =>
          obstacles.flatMap((o, obstacleId) => {
            if (o.meta.plant !== true) return [];
            const { x, y } = o.center;
            const { width, height } = o.origPoly.rect;
            const roomId = w.view.roomSlots.roomAt(gmId, o.center);
            return {
              gmId,
              obstacleId,
              x: a * x + c * y + e,
              z: b * x + d * y + f,
              top: o.height,
              size: (Math.min(width, height) / 2) * sizePerPotRadius,
              seed: typeof o.meta.seed === "number" ? o.meta.seed : obstacleId,
              slot: roomId === null ? alwaysShownSlot : slotOf(gmId, roomId),
            };
          }),
        );
      },
      positionInstances() {
        const { inst } = state;
        if (inst === null) return;
        const slots = ensureRoomSlots(inst.geometry, state.plants.length);
        const seeds = inst.geometry.getAttribute("plantSeed") as THREE.InstancedBufferAttribute;
        for (const [i, { x, z, top, size, seed, slot }] of state.plants.entries()) {
          tmpQuat.setFromAxisAngle(yAxis, seed * 2.39996);
          inst.setMatrixAt(i, tmpMat4.compose(tmpPos.set(x, top, z), tmpQuat, tmpScale.setScalar(size)));
          slots.setXY(i, slot, slot);
          seeds.setX(i, seed);
        }
        inst.instanceMatrix.needsUpdate = slots.needsUpdate = seeds.needsUpdate = true;
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
    return geo;
  }, [count]);

  const material = useMemo(() => {
    const [leaf, t, side] = [positionGeometry.x, positionGeometry.y, positionGeometry.z];
    const seed = attribute<"float">("plantSeed", "float");
    /** A `0`-`1` hash per leaf, the `k`th of several */
    const perLeaf = (k: number) => hash2(vec2(seed.add(k * 0.618), leaf.add(k * 7.31)));
    /** The same per plant */
    const perPlant = (k: number) => hash2(vec2(seed.add(k * 0.618), float(97 + k)));

    /** Inner leaves stand up, outer ones lean out */
    const outer = leaf.div(leafCount - 1);
    const kept = step(perLeaf(1), mix(float(0.55), float(1), perPlant(1)));
    const turn = leaf.mul(2.39996).add(perLeaf(2).sub(0.5).mul(0.7));
    const tilt = mix(float(0.15), float(1.25), outer).add(perLeaf(3).sub(0.5).mul(0.35));
    const length = mix(float(0.55), float(1), perLeaf(4)).mul(kept);
    const width = mix(float(0.06), float(0.12), perLeaf(5)).mul(mix(float(0.8), float(1.3), perPlant(2)));
    const droop = mix(float(0.05), float(0.45), perLeaf(6)).mul(length).mul(outer.add(0.3));
    const reach = sin(tilt).mul(length).mul(t);
    const rise = cos(tilt).mul(length).mul(t).sub(droop.mul(t).mul(t));
    /** Pointed at either end */
    const across = width.mul(sin(t.mul(Math.PI))).mul(side);
    const [along, aside] = [vec2(cos(turn), sin(turn)), vec2(sin(turn).negate(), cos(turn))];
    const positionNode = vec3(
      along.x.mul(reach).add(aside.x.mul(across)),
      rise,
      along.y.mul(reach).add(aside.y.mul(across)),
    );

    /** Grey, lighter towards each tip and darker down its middle */
    const tone = mix(float(0.12), float(0.9), perLeaf(7))
      .mul(mix(float(0.6), float(1.4), perPlant(3)))
      .mul(mix(float(0.45), float(1), t))
      .mul(mix(float(0.8), float(1), side.abs()));
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
 * Every leaf as a strip of `leafRows` pairs. Its position is not where it is, but which leaf,
 * how far along it `0`-`1`, and which side `±1`: the material shapes it
 */
function createPlantGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let leaf = 0; leaf < leafCount; leaf++) {
    const base = positions.length / 3;
    for (let row = 0; row < leafRows; row++) {
      const t = row / (leafRows - 1);
      positions.push(leaf, t, -1, leaf, t, 1);
      if (row > 0) {
        const [a, b, c, d] = [base + 2 * (row - 1), base + 2 * (row - 1) + 1, base + 2 * row, base + 2 * row + 1];
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/** A `0`-`1` hash of `cell`, with no trig in it (Hoskins' `hash12`) */
function hash2(cell: THREE.Node<"vec2">) {
  const p = cell.xyx.mul(0.1031).fract();
  const q = p.add(p.dot(p.yzx.add(33.33)));
  return q.x.add(q.y).mul(q.z).fract() as THREE.Node<"float">;
}

/** Leaves per plant, some left out by its seed */
const leafCount = 14;
/** Pairs of vertices along each leaf */
const leafRows = 6;
/** A plant's height, as a multiple of its pot's radius */
const sizePerPotRadius = 3.2;

const yAxis = new THREE.Vector3(0, 1, 0);
const tmpMat4 = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();

export type Plant = {
  gmId: number;
  obstacleId: number;
  /** World position of its pot's middle */
  x: number;
  z: number;
  /** Its pot's top, which it grows from */
  top: number;
  /** Metres, from its pot's radius */
  size: number;
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
