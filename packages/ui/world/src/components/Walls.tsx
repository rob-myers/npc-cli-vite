import { useStateRef } from "@npc-cli/util";
import { Mat, Poly, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { useContext, useEffect, useMemo } from "react";
import {
  attribute,
  color,
  Discard,
  Fn,
  float,
  frontFacing,
  fwidth,
  lights,
  mix,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createTwoSidedXyQuad, createXyQuad } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot, ensureRoomSlots, slotOf } from "../service/room-slots";
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
      // its own, not `quad` shared: `roomSlots` lives on the GEOMETRY, so two meshes sharing one
      // could not stand in different rooms
      trimQuad: createTwoSidedXyQuad(),

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
        const slots = ensureRoomSlots(
          state.trimQuad,
          w.gmsData.count.wall + w.gmsData.count.door + w.gmsData.count.window,
        );

        // const color = new THREE.Color(w.getTheme().walls.color);
        const color = new THREE.Color("#222");

        let id = 0;
        for (const [gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            const wallH = typeof meta.h === "number" ? meta.h : wallHeight;
            const wallBase = typeof meta.y === "number" ? meta.y : 0;
            state.setRoomSlots(slots, id, gmId, seg);
            instTrim.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilTrimHeight, wallBase + wallH - ceilTrimHeight),
            );
            instTrim.setColorAt(id++, color);
          }
          // a connector's own trim takes the connector's rooms, which it already knows. These two
          // walk exactly as `doorSegs` and `windowSegs` are built — one segment per door, but a
          // window's whole outline — since the instances are counted from those
          for (const { seg, roomIds } of w.gms[gmId].doors) {
            state.setConnectorSlots(slots, id, gmId, roomIds);
            instTrim.setMatrixAt(
              id,
              state.getWallMat(seg, transform, determinant, ceilDoorTrimHeight, wallHeight - ceilDoorTrimHeight),
            );
            instTrim.setColorAt(id++, color);
          }
          for (const { poly, roomIds } of w.gms[gmId].windows) {
            for (const seg of poly.lineSegs) {
              state.setConnectorSlots(slots, id, gmId, roomIds);
              instTrim.setMatrixAt(
                id,
                state.getWallMat(seg, transform, determinant, ceilDoorTrimHeight, wallHeight - ceilDoorTrimHeight),
              );
              instTrim.setColorAt(id++, color);
            }
          }
        }
        slots.needsUpdate = true;
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

        // every geomorph's hull walls at once, in WORLD space and merged: where two geomorphs
        // meet, the hull walls between them become interior to the union and drop out of its
        // outline, so no skin is drawn across a junction. Per geomorph they would each still
        // carry the wall they share, and the world would be striped through its own middle
        const merged = Poly.union(
          w.gms.flatMap(({ hullPoly, transform }) =>
            hullPoly.map((x) => x.clone().applyMatrix(tmpMat1.setMatrixValue(transform))),
          ),
        );
        // the outline alone, the holes being the geomorphs' own insides — an outset would grow
        // those inwards over the rooms
        const outer = merged.flatMap((x) => geomService.createOutset(new Poly(x.outline), hullOuterOutset));

        let instanceId = 0;
        for (const poly of outer) {
          for (const seg of poly.lineSegs) {
            // already world space, hence the identity transform. Its height is given rather than
            // left to `getWallMat`'s default, so the skin can be tucked under the ceiling — which
            // sits at `wallHeight`, whilst the skin stands `hullOuterOutset` outside its edge and
            // would otherwise show its top as a lip standing proud of the roofline
            ws.setMatrixAt(instanceId++, state.getWallMat(seg, identityTransform, 1, hullOuterHeight));
          }
        }

        ws.count = instanceId;
        state.hullOuterCount = instanceId;
        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
      },
      setRoomSlots(slots, instanceId, gmId, seg) {
        const beside = w.view.roomSlots.roomsBeside(gmId, seg[0], seg[1]);
        const [a, b] = beside === null ? [alwaysShownSlot, alwaysShownSlot] : beside.map((x) => slotOf(gmId, x));
        slots.setXY(instanceId, a, b);
      },
      setConnectorSlots(slots, instanceId, gmId, roomIds) {
        const [a, b] = roomIds.map((x) => (typeof x === "number" ? slotOf(gmId, x) : alwaysShownSlot));
        slots.setXY(instanceId, a, b);
      },
      positionInstances() {
        const { inst: ws } = state;
        if (!ws) return;
        const slots = ensureRoomSlots(state.quad, w.gmsData.count.wall);

        let instanceId = 0;
        const color = new THREE.Color(w.getTheme().walls.color);

        for (const [gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            state.setRoomSlots(slots, instanceId, gmId, seg);
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

        slots.needsUpdate = true;
        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
        if (ws.instanceColor) ws.instanceColor.needsUpdate = true;
      },
    }),
  );

  w.wall = state;

  const wallCount = w.gmsData.count.wall;
  const trimCount = wallCount + w.gmsData.count.door + w.gmsData.count.window;

  // before the materials below, which read `roomSlots`: an attribute a shader names has to be on
  // the geometry by the time it compiles, and `positionInstances` only fills it in an effect
  useMemo(() => {
    ensureRoomSlots(state.quad, wallCount);
    ensureRoomSlots(state.trimQuad, trimCount);
  }, [wallCount, trimCount]);

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

    // tinted by what the player can see from where they stand — see `service/player-light`
    const colorNode = w.view.playerLight.applyLight(baseColorUniform.rgb);

    // a wall belongs to the rooms on BOTH sides, and is shown at the fuller of the two — so a room
    // in view keeps every wall that encloses it, whatever stands on the far side of them
    const fade = w.view.fadeRoomsFx.fadeAtPair(attribute<"vec2">("roomSlots", "vec2"));

    return {
      opacityUniform,
      opacityNode: litOpacityNode.mul(fade),
      colorNode,
      outputNode,
      baseColorUniform,
      uuid: crypto.randomUUID(),
    };
  }, [wallCount, w.view.fadeRoomsFx.uid]);

  /**
   * The skin outside the hull: white with the grey hatch the hull floor carries — see `Floor`'s
   * `drawHullFloor`. Shaded rather than drawn, a wall having no texture: summing all three axes
   * runs the lines at 45° across any face however it points, and keeps them going around a
   * corner. A sine rather than `fract`, so `fwidth` can antialias it.
   */
  const hullOuterMaterial = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide, // seen from without, and from within through the hull's doorways
      // Dithered against the MSAA samples rather than blended, as the doors are: an instanced mesh
      // cannot be sorted back to front, which is what blending a skin wrapped around the whole
      // hull would need. It also gives the pick pass its discard for free — zero opacity covers no
      // samples at all, so the skin cannot stand in front of the walls it skins and swallow their
      // picks
      alphaToCoverage: true,
    });

    // height alone, so the lines run horizontally around the hull however a face is turned. A sine
    // rather than `fract`, whose discontinuity would defeat the `fwidth` antialiasing
    const wave = positionWorld.y.mul((2 * Math.PI) / hullOuterStripeGap).sin();
    const width = fwidth(wave).max(0.0001);
    // the line is the CREST of each wave rather than half of it: crossing at zero, as before, makes
    // the line and the gap the same width, which is as thick as a stripe can be
    const threshold = Math.cos(Math.PI * hullOuterStripeDuty);
    const stripes = smoothstep(width.negate().add(threshold), width.add(threshold), wave);
    // the skin is one quad seen from both sides, and `frontFacing` is the side its own normal
    // points at — which the outline's winding makes the INWARD one. So the world sees the dark
    // grey, and only the rooms see the white
    // `mix` off a 0/1 rather than `select` between the colours: selecting them directly makes a
    // union TypeScript cannot represent
    const inward = frontFacing.select(float(1), float(0));
    const base = mix(color(hullOuterOutsideColor), color(hullOuterColor), inward);
    const line = mix(color(hullOuterOutsideStripeColor), color(hullOuterStripeColor), inward);
    m.colorNode = Fn(() => {
      // never picked: it stands in front of the walls it skins and would otherwise swallow their
      // picks. A discard rather than a transparency, the pick target being single-sampled — the
      // coverage this is see-through by does nothing there
      Discard(w.view.objectPick.notEqual(0));
      return w.view.playerLight.applyLight(mix(base, line, stripes));
    })();
    // and the world's side of it is see-through, so a camera outside the hull looks in rather than
    // at a white wall. The rooms' side stays solid, which is what keeps them enclosed
    m.opacityNode = mix(float(hullOuterOutsideOpacity), float(1), inward);
    m.lightsNode = lights([new THREE.AmbientLight("#fff", 1)]); // flat, like the floor's own art
    return m;
  }, [w.view.playerLight.uid]);

  const trimMaterial = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      side: THREE.FrontSide, // 1 draw call
      transparent: true,
      depthWrite: false,
    });
    const fade = w.view.fadeRoomsFx.fadeAtPair(attribute<"vec2">("roomSlots", "vec2"));
    m.opacityNode = w.view.objectPick.equal(0).select(float(0.5), float(0)).mul(fade);
    m.lightsNode = lights([new THREE.AmbientLight("#fff", 0.5)]);
    return m;
  }, [w.view.playerLight.uid, w.view.fadeRoomsFx.uid]);

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
        args={[state.trimQuad, trimMaterial, trimCount]}
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
  /** The trim's own geometry — see `trimQuad` in the state */
  trimQuad: THREE.BufferGeometry;
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
  /** Writes the rooms either side of a wall segment into its instance */
  setRoomSlots: (
    slots: THREE.InstancedBufferAttribute,
    instanceId: number,
    gmId: number,
    seg: [Geom.Vect, Geom.Vect],
  ) => void;
  /** The same for a door or window, which knows its rooms already */
  setConnectorSlots: (
    slots: THREE.InstancedBufferAttribute,
    instanceId: number,
    gmId: number,
    roomIds: (null | number)[],
  ) => void;
  positionInstances: () => void;
  positionHullOuterInstances: () => void;
  positionTrimInstances: () => void;
};

const tmpMat1 = new Mat();
/** For segments already in world space — see `positionHullOuterInstances` */
const identityTransform: Geom.AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
/** The hull's outer skin: how far it stands off, how tall it stands, then what the ROOMS' side
 * of it looks like */
const hullOuterOutset = 0.06;
const hullOuterHeight = wallHeight - 0.05;
const hullOuterColor = "#c8c8c8";
const hullOuterStripeColor = "#a8a8a8";
const hullOuterStripeGap = 0.075;
/** What fraction of that spacing each line takes */
const hullOuterStripeDuty = 0.22;
/** What the world sees of it — black, against the light grey the rooms see — and how much of it
 * survives, looking in from out there */
const hullOuterOutsideColor = "#080808";
const hullOuterOutsideStripeColor = "#2e2e2e";
const hullOuterOutsideOpacity = 0.1;

const ceilTrimHeight = 0.2;
const ceilDoorTrimHeight = 0.2;
