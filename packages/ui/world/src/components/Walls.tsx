import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { useContext, useEffect, useMemo } from "react";
import { color, float, frontFacing, fwidth, lights, mix, positionWorld, smoothstep, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createTwoSidedXyQuad, createXyQuad } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { bootstrapInstanceColor } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      instHullOuter: null,
      instTrim: null,
      hullOuterCount: 0,
      // ONE winding, unlike the walls' `quad`: this material is `DoubleSide`, so a two-sided
      // geometry would put a second face in the very same plane for it to fight with
      hullOuterQuad: createXyQuad(),
      quad: createTwoSidedXyQuad(),

      decodeInstanceId(instanceId: number) {
        let id = instanceId;
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].wallSegs.length;
          return id < count || ((id -= count), false);
        });
        const wallSeg = w.gmsData.byKey[w.gms[gmId].key].wallSegs[id];
        return { gmId, seg: wallSeg.seg, meta: wallSeg.meta };
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
      positionTrimInstances() {
        const { instTrim } = state;
        if (!instTrim) return;

        // const color = new THREE.Color(w.getTheme().walls.color);
        const color = new THREE.Color("#222");

        let id = 0;
        for (const [_gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            const wallH = typeof meta.h === "number" ? meta.h : wallHeight;
            const wallBase = typeof meta.y === "number" ? meta.y : 0;
            instTrim.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilTrimHeight, wallBase + wallH - ceilTrimHeight),
            );
            instTrim.setColorAt(id++, color);
          }
          for (const { seg } of w.gmsData.byKey[gmKey].doorSegs) {
            instTrim.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilDoorTrimHeight, wallHeight - ceilDoorTrimHeight),
            );
            instTrim.setColorAt(id++, color);
          }
          for (const { seg } of w.gmsData.byKey[gmKey].windowSegs) {
            instTrim.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilDoorTrimHeight, wallHeight - ceilDoorTrimHeight),
            );
            instTrim.setColorAt(id++, color);
          }
        }
        instTrim.computeBoundingSphere();
        instTrim.instanceMatrix.needsUpdate = true;
        if (instTrim.instanceColor) instTrim.instanceColor.needsUpdate = true;
      },
      /**
       * The hull's outer skin: `hullPoly` — the UNION of the hull walls — outset by
       * `hullOuterOutset` and its outline walked as wall segments. One polygon operation decides
       * both which faces are on the outside and where they stand, so there is no per-segment
       * normal to work out and nothing standing in a wall's own plane.
       */
      positionHullOuterInstances() {
        const { instHullOuter: ws } = state;
        if (!ws) return;

        let instanceId = 0;
        for (const [gmId, { transform, determinant }] of w.gms.entries()) {
          // holes removed first: the ring's inner boundary is the rooms' side, and an outset
          // would grow it inwards over them
          const outer = w.gms[gmId].hullPoly.flatMap((x) =>
            geomService.createOutset(x.clone().removeHoles(), hullOuterOutset),
          );
          for (const poly of outer) {
            for (const seg of poly.lineSegs) {
              ws.setMatrixAt(instanceId++, state.getWallMat(seg, transform, determinant));
            }
          }
        }

        ws.count = instanceId;
        state.hullOuterCount = instanceId;
        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
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
  const trimCount = wallCount + w.gmsData.count.door + w.gmsData.count.window;

  const mat = useMemo(() => {
    // 🔔 objectPick.value 0.5 ignores walls for easier picking
    const opacityUniform = uniform(0.5);
    const outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.wall);

    const baseColorUniform = uniform(new THREE.Color());
    const litOpacityNode = w.view.objectPick.notEqual(0).select(
      // objectPick 0.5 ignores walls for easier picking
      w.view.objectPick.notEqual(1).select(0, 1),
      opacityUniform, // beauty render
    );

    const colorNode = baseColorUniform;

    return {
      opacityUniform,
      opacityNode: litOpacityNode,
      colorNode,
      outputNode,
      baseColorUniform,
      uuid: crypto.randomUUID(),
    };
  }, [wallCount]);

  /**
   * The skin outside the hull: white with the grey hatch the hull floor carries — see `Floor`'s
   * `drawHullFloor`. Shaded rather than drawn, a wall having no texture: summing all three axes
   * runs the lines at 45° across any face however it points, and keeps them going around a
   * corner. A sine rather than `fract`, so `fwidth` can antialias it.
   */
  const hullOuterMaterial = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide, // seen from without, and from within through the hull's doorways
      // discarded whilst picking rather than merely unpickable: opaque, it would otherwise stand
      // in front of the walls it skins and swallow their picks
      alphaTest: 0.5,
    });
    m.opacityNode = w.view.objectPick.equal(0).select(float(1), float(0));

    const wave = positionWorld.x
      .add(positionWorld.y)
      .add(positionWorld.z)
      .mul((2 * Math.PI) / hullOuterStripeGap)
      .sin();
    const width = fwidth(wave).max(0.0001);
    const stripes = smoothstep(width.negate(), width, wave);
    // the skin is one quad seen from both sides, and `frontFacing` is the side its own normal
    // points at — which the outline's winding makes the INWARD one. So the world sees the dark
    // grey, and only the rooms see the white
    // `mix` off a 0/1 rather than `select` between the colours: selecting them directly makes a
    // union TypeScript cannot represent
    const inward = frontFacing.select(float(1), float(0));
    const base = mix(color(hullOuterOutsideColor), color(hullOuterColor), inward);
    const line = mix(color(hullOuterOutsideStripeColor), color(hullOuterStripeColor), inward);
    m.colorNode = mix(base, line, stripes);
    m.lightsNode = lights([new THREE.AmbientLight("#fff", 1)]); // flat, like the floor's own art
    return m;
  }, []);

  const trimMaterial = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      side: THREE.FrontSide, // 1 draw call
      transparent: true,
      depthWrite: false,
    });
    m.opacityNode = w.view.objectPick.equal(0).select(float(0.75), float(0));
    m.lightsNode = lights([new THREE.AmbientLight("#fff", 0.5)]);
    return m;
  }, []);

  useEffect(() => {
    state.positionInstances();
    state.positionHullOuterInstances();
    state.positionTrimInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    mat.baseColorUniform.value.set(w.getTheme().walls.color);

    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.decor.ready]);

  return wallCount ? (
    <>
      <instancedMesh
        key={mat.uuid}
        name="walls"
        ref={state.ref("inst", bootstrapInstanceColor)}
        args={[state.quad, undefined, wallCount]}
        renderOrder={4}
      >
        <meshStandardNodeMaterial
          key={mat.uuid}
          side={THREE.FrontSide} // 1 draw call
          transparent
          depthWrite={false}
          colorNode={mat.colorNode}
          opacityNode={mat.opacityNode}
          outputNode={mat.outputNode}
        />
      </instancedMesh>

      {/* stands just outside the hull walls — see `positionHullOuterInstances` */}
      <instancedMesh
        key={`${mat.uuid}-hull-outer`}
        name="hull-walls-outer"
        ref={state.ref("instHullOuter")}
        args={[state.hullOuterQuad, hullOuterMaterial, wallCount]}
        renderOrder={3}
      />

      <instancedMesh
        key={`${mat.uuid}-trim`}
        name="walls-along-ceiling"
        ref={state.ref("instTrim", bootstrapInstanceColor)}
        args={[state.quad, trimMaterial, trimCount]}
        renderOrder={4}
      />
    </>
  ) : null;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  /** The white, hatched skin standing just outside the hull walls */
  instHullOuter: null | THREE.InstancedMesh;
  /** Its geometry: a single-winding quad, the material being `DoubleSide` */
  hullOuterQuad: THREE.BufferGeometry;
  instTrim: null | THREE.InstancedMesh;
  /** How many of `instHullOuter`'s instances are in use */
  hullOuterCount: number;
  quad: THREE.BufferGeometry;

  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; meta: Meta };
  getWallMat: (
    seg: [Geom.Vect, Geom.Vect],
    transform: Geom.AffineTransform,
    determinant: number,
    height?: number,
    baseHeight?: number,
  ) => THREE.Matrix4;
  positionInstances: () => void;
  positionHullOuterInstances: () => void;
  positionTrimInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
/** The hull's outer skin: how far it stands off, how far out the inside test probes */
const hullOuterOutset = 0.06;
const hullOuterColor = "#ffffff";
const hullOuterStripeColor = "#cfcfcf";
const hullOuterStripeGap = 0.16;
/** What the world sees of it: flat white, with no hatch — only the rooms' side is striped */
const hullOuterOutsideColor = "#ffffff";
const hullOuterOutsideStripeColor = "#ffffff";

const ceilTrimHeight = 0.2;
const ceilDoorTrimHeight = 0.2;
