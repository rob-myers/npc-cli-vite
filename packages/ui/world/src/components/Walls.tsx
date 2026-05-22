import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import type MathNode from "three/src/nodes/math/MathNode.js";
import { Fn, float, If, instanceIndex, mix, positionWorld, uniform, uniformArray, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createXyQuad } from "../service/geometry";
import { PICK_TYPE } from "../service/pick";
import { getLightPositions, lightRadius } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      lightsShown: true,
      mat: {} as any,
      quad: createXyQuad(),

      toggleLights() {
        state.lightsShown = !state.lightsShown;
        mat.wallLightsNode.value = state.lightsShown ? 1 : 0;
        w.update();
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
          {
            a: len * Math.cos(rad),
            b: len * Math.sin(rad),
            c: -Math.sin(rad),
            d: Math.cos(rad),
            e: tmpVec1.x,
            f: tmpVec1.y,
          },
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
    const outputNode = w.view.withPickOutput(PICK_TYPE.wall);

    const baseColorUniform = uniform(new THREE.Color());
    // Per wall: up to 2 nearest light world positions (sentinel y=-1000 → contributes 0)
    const sentinel = new THREE.Vector3(0, -1000, 0);
    const light0Values = Array.from({ length: wallCount }, () => sentinel.clone());
    const light1Values = Array.from({ length: wallCount }, () => sentinel.clone());
    const lights0Node = uniformArray(light0Values, "vec3");
    const lights1Node = uniformArray(light1Values, "vec3");
    const lightR = float(lightRadius);
    const wallLightsNode = uniform(1);
    const factor = Fn(() => {
      const f = float(0).toVar();
      If(wallLightsNode.notEqual(0), () => {
        const dist0 = positionWorld.sub(lights0Node.element(instanceIndex)).length();
        const dist1 = positionWorld.sub(lights1Node.element(instanceIndex)).length();
        f.assign(lightR.sub(dist0).div(lightR).clamp(0, 1).add(lightR.sub(dist1).div(lightR).clamp(0, 1)).clamp(0, 1));
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

  state.mat = mat;

  useEffect(() => {
    state.positionInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    mat.baseColorUniform.value.set(w.getTheme().walls.color);

    // Collect all light world positions (xz plane)
    const lights: { x: number; z: number }[] = [];
    for (const gm of w.gms) {
      const layout = w.assets.layout[gm.key];
      if (!layout) continue;
      for (const p of getLightPositions(layout, gm.key)) {
        const wp = gm.matrix.transformPoint(p);
        lights.push({ x: wp.x, z: wp.y });
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
        mat.light0Values[instanceId].set(l0 ? l0.lp.x : 0, 0, l0 ? l0.lp.z : -1000);
        mat.light1Values[instanceId].set(l1 ? l1.lp.x : 0, 0, l1 ? l1.lp.z : -1000);
        instanceId++;
      }
    }

    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.gms.length, w.themeKey]);

  return wallCount ? (
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
  ) : null;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  lightsShown: boolean;
  mat: {
    opacityUniform: THREE.UniformNode<number>;
    opacityNode: THREE.Node;
    colorNode: MathNode;
    outputNode: THREE.Node;
    baseColorUniform: THREE.UniformNode<THREE.Color>;
    wallLightsNode: THREE.UniformNode<number>;
    light0Values: THREE.Vector3[];
    light1Values: THREE.Vector3[];
    uuid: `${string}-${string}-${string}-${string}-${string}`;
  };
  quad: THREE.BufferGeometry;

  toggleLights(): void;
  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; meta: Meta };
  getWallMat: (
    seg: [Geom.Vect, Geom.Vect],
    transform: Geom.AffineTransform,
    determinant: number,
    height?: number,
    baseHeight?: number,
  ) => THREE.Matrix4;
  positionInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
