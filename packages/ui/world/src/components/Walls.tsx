import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { Fn, float, If, instanceIndex, mix, positionWorld, uniform, uniformArray, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createXyQuad } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { getLightMetas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      instTrim: null,
      lightsShown: true,
      light: {} as State["light"],
      quad: createXyQuad(),

      toggleLights(next = !state.lightsShown) {
        state.light.wallLightsNode.value = next ? 1 : 0;
        state.set({ lightsShown: next });
        w.view.forceUpdate();
      },
      getWallMat([u, v], transform, determinant, height, baseHeight) {
        tmpMat1.setMatrixValue(transform);
        if (determinant > 0) {
          // (v, u) so outer walls are shown
          [tmpVec1.copy(v), tmpVec2.copy(u)].forEach((x) => tmpMat1.transformPoint(x));
        } else {
          // (u, v) because transform flips
          [tmpVec1.copy(u), tmpVec2.copy(v)].forEach((x) => tmpMat1.transformPoint(x));
        }
        const rad = Math.atan2(tmpVec2.y - tmpVec1.y, tmpVec2.x - tmpVec1.x);
        const len = u.distanceTo(v);
        return geometry.embedXZMat4(
          // biome-ignore format: avoid newlines
          { a: len * Math.cos(rad), b: len * Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: tmpVec1.x, f: tmpVec1.y },
          { yScale: height ?? wallHeight, yHeight: baseHeight, mat4: tmpMatFour1 },
        );
      },
      decodeInstanceId(instanceId: number) {
        let id = instanceId;
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].wallSegs.length;
          return id < count || ((id -= count), false);
        });
        const wallSeg = w.gmsData.byKey[w.gms[gmId].key].wallSegs[id];
        return { gmId, seg: wallSeg.seg, meta: wallSeg.meta };
      },
      positionTrimInstances() {
        const { instTrim: ti } = state;
        if (!ti) return;
        const color = new THREE.Color(w.getTheme().walls.color);
        let id = 0;
        for (const [_gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            const wallH = typeof meta.h === "number" ? meta.h : wallHeight;
            const wallBase = typeof meta.y === "number" ? meta.y : 0;
            ti.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilTrimHeight, wallBase + wallH - ceilTrimHeight),
            );
            ti.setColorAt(id++, color);
          }
        }
        ti.computeBoundingSphere();
        ti.instanceMatrix.needsUpdate = true;
        if (ti.instanceColor) ti.instanceColor.needsUpdate = true;
      },
      positionInstances() {
        const { inst: ws } = state;
        if (!ws) return;

        let instanceId = 0;
        const color = new THREE.Color(w.getTheme().walls.color);

        for (const [_gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            ws.setMatrixAt(
              instanceId,
              state.getWallMat(
                seg,
                transform,
                determinant,
                typeof meta.h === "number" ? meta.h : undefined,
                typeof meta.y === "number" ? meta.y : undefined,
              ),
            );

            ws.setColorAt(instanceId++, color);
          }
        }

        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
        if (ws.instanceColor) ws.instanceColor.needsUpdate = true;
      },
    }),
  );

  w.wall = state;

  const wallCount = w.gmsData.count.wall;

  const mat = useMemo(() => {
    // 🔔 objectPick.value 0.5 ignores walls for easier picking
    const opacityUniform = uniform(0.5);
    const outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.wall);

    const baseColorUniform = uniform(new THREE.Color());
    // Per wall: up to 2 nearest light world positions (sentinel y=-1000 → contributes 0)
    // xyz = world position, w = radius (non-zero to avoid div-by-zero in shader)
    const sentinel = new THREE.Vector4(0, -1000, 0, 1);
    const light0Values = Array.from({ length: wallCount }, () => sentinel.clone());
    const light1Values = Array.from({ length: wallCount }, () => sentinel.clone());
    const lights0Node = uniformArray<"vec4">(light0Values, "vec4");
    const lights1Node = uniformArray<"vec4">(light1Values, "vec4");
    const wallLightsNode = uniform(1);
    const factor = Fn(() => {
      const f = float(0).toVar();
      If(wallLightsNode.notEqual(0), () => {
        const l0 = lights0Node.element(instanceIndex);
        const l1 = lights1Node.element(instanceIndex);
        const dist0 = positionWorld.sub(l0.xyz).length();
        const dist1 = positionWorld.sub(l1.xyz).length();
        const r0 = l0.w;
        const r1 = l1.w;
        f.assign(r0.sub(dist0).div(r0).clamp(0, 1).add(r1.sub(dist1).div(r1).clamp(0, 1)).clamp(0, 1));
      });
      return f;
    })();
    // reduce opacity where inside a sphere (more transparent = "lighter")
    const litOpacity = opacityUniform.mul(float(1).sub(factor.mul(1)));

    const litOpacityNode = w.view.objectPick.notEqual(0).select(
      // objectPick 0.5 ignores walls for easier picking
      w.view.objectPick.notEqual(1).select(0, 1),
      litOpacity, // beauty render
    );

    const colorNode = mix(baseColorUniform, vec3(1, 1, 0.6), factor.mul(0.1));

    return {
      opacityUniform,
      opacityNode: litOpacityNode,
      colorNode,
      outputNode,
      baseColorUniform,
      wallLightsNode,
      light0Values,
      light1Values,
      uuid: crypto.randomUUID(),
    };
  }, [wallCount]);

  state.light = mat;

  const trimMat = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    m.opacityNode = w.view.objectPick.equal(0).select(float(0.75), float(0));
    return m;
  }, []);

  useEffect(() => {
    state.positionInstances();
    state.positionTrimInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    mat.baseColorUniform.value.set(w.getTheme().walls.color);

    if (!w.decor.ready) {
      return;
    }

    // Collect all light world positions (xz plane) with per-light radius
    const lights: { x: number; z: number; radius: number }[] = [];
    for (const gm of w.gms) {
      for (const p of getLightMetas(gm)) {
        const wp = gm.matrix.transformPoint(p);
        lights.push({ x: wp.x, z: wp.y, radius: p.radius });
      }
    }

    // Per wall: find 2 nearest light world positions and store them
    let instanceId = 0;
    for (const { key: gmKey, transform } of w.gms) {
      tmpMat1.setMatrixValue(transform);
      for (const { seg } of w.gmsData.byKey[gmKey].wallSegs) {
        const mx = (seg[0].x + seg[1].x) / 2;
        const mz = (seg[0].y + seg[1].y) / 2;
        const wp = tmpMat1.transformPoint({ x: mx, y: mz });
        const sorted = lights
          .map((lp) => ({ lp, dist: Math.hypot(wp.x - lp.x, wp.y - lp.z) }))
          .sort((a, b) => a.dist - b.dist);
        const l0 = sorted[0];
        const l1 = sorted[1];
        mat.light0Values[instanceId].set(l0 ? l0.lp.x : 0, l0 ? 0 : -1000, l0 ? l0.lp.z : 0, l0 ? l0.lp.radius : 1);
        mat.light1Values[instanceId].set(l1 ? l1.lp.x : 0, l1 ? 0 : -1000, l1 ? l1.lp.z : 0, l1 ? l1.lp.radius : 1);
        instanceId++;
      }
    }

    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.themeKey, w.decor.ready]);

  return wallCount ? (
    <>
      <instancedMesh
        key={mat.uuid}
        name="walls"
        ref={state.ref("inst", (mesh) => {
          mesh && (mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3));
        })}
        args={[state.quad, undefined, wallCount]}
        renderOrder={4}
      >
        <meshStandardNodeMaterial
          key={mat.uuid}
          side={THREE.DoubleSide}
          transparent
          depthWrite={false}
          colorNode={mat.colorNode}
          opacityNode={mat.opacityNode}
          outputNode={mat.outputNode}
        />
      </instancedMesh>
      <instancedMesh
        key={`${mat.uuid}-trim`}
        name="wall-ceil-trim"
        ref={state.ref("instTrim", (mesh) => {
          mesh && (mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3));
        })}
        args={[state.quad, trimMat, wallCount]}
        renderOrder={4}
      />
    </>
  ) : null;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  instTrim: null | THREE.InstancedMesh;
  lightsShown: boolean;
  light: {
    opacityUniform: THREE.UniformNode<"float", number>;
    opacityNode: THREE.Node<"float">;
    colorNode: THREE.Node<"vec3">;
    outputNode: THREE.Node;
    baseColorUniform: THREE.UniformNode<"color", THREE.Color>;
    wallLightsNode: THREE.UniformNode<"float", number>;
    light0Values: THREE.Vector4[];
    light1Values: THREE.Vector4[];
    uuid: `${string}-${string}-${string}-${string}-${string}`;
  };
  quad: THREE.BufferGeometry;

  toggleLights(next?: boolean): void;
  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; meta: Meta };
  getWallMat: (
    seg: [Geom.Vect, Geom.Vect],
    transform: Geom.AffineTransform,
    determinant: number,
    height?: number,
    baseHeight?: number,
  ) => THREE.Matrix4;
  positionInstances: () => void;
  positionTrimInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
const ceilTrimHeight = 0.2;
