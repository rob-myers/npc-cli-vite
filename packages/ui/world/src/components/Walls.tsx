import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, lights, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createTwoSidedXyQuad } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { broadWallSlotOf, ensureRoomSlots, neverShownSlot, slotOf } from "../service/room-slots";
import { bootstrapInstanceColor } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      instTrim: null,
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
          for (const wallSeg of w.gmsData.byKey[gmKey].wallSegs) {
            const { seg, meta } = wallSeg;
            const wallH = typeof meta.h === "number" ? meta.h : wallHeight;
            const wallBase = typeof meta.y === "number" ? meta.y : 0;
            state.setSegSlots(slots, id, gmId, wallSeg);
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
      setSegSlots(slots, instanceId, gmId, { seg, meta, broadWallId }) {
        if (meta.hull === true) {
          // the hull is the ship's outside, which fade mode has nothing behind — and
          // `neverShownSlot` is 1 whilst the fade is off, so this costs nothing there
          slots.setXY(instanceId, neverShownSlot, neverShownSlot);
        } else if (broadWallId !== null) {
          // A BROAD wall goes on its own slot, whole: it is one piece of structure, and the ceiling
          // draws one lid over the lot on that same slot.
          const slot = broadWallSlotOf(gmId, broadWallId);
          slots.setXY(instanceId, slot, slot);
        } else {
          // otherwise at most one room whose outline this segment lies on, so
          // room show inner walls only; when no room exists use `neverShownSlot`
          const roomId = w.view.roomSlots.roomOfSeg(gmId, seg[0], seg[1]);
          const slot = roomId === null ? neverShownSlot : slotOf(gmId, roomId);
          slots.setXY(instanceId, slot, slot);
        }
      },
      setConnectorSlots(slots, instanceId, gmId, roomIds) {
        // a missing side is `neverShownSlot`, NOT `alwaysShownSlot`: the pair is read as a max, so
        // an always-shown side would win outright — which is what kept every HULL door showing,
        // its other side lying in the neighbouring geomorph and so reading as `null` here
        const [a, b] = roomIds.map((x) => (typeof x === "number" ? slotOf(gmId, x) : neverShownSlot));
        slots.setXY(instanceId, a, b);
      },
      positionInstances() {
        const { inst: ws } = state;
        if (!ws) return;
        const slots = ensureRoomSlots(state.quad, w.gmsData.count.wall);

        let instanceId = 0;
        const color = new THREE.Color(w.getTheme().walls.color);

        for (const [gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const wallSeg of w.gmsData.byKey[gmKey].wallSegs) {
            const { seg, meta } = wallSeg;
            state.setSegSlots(slots, instanceId, gmId, wallSeg);
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

    // a wall belongs to the rooms on BOTH sides, and is shown at the fuller of the two — so a room
    // in view keeps every wall that encloses it, whatever stands on the far side of them
    const slots = attribute<"vec2">("roomSlots", "vec2");
    const fade = w.view.fadeRoomsFx.fadeAtPair(slots);

    return {
      opacityUniform,
      opacityNode: litOpacityNode.mul(fade),
      // NOT tinted by `service/player-light`: a wall is flat colour at half opacity, so the light
      // only ever muddied what was behind it — and this runs on every wall fragment in the world
      colorNode: baseColorUniform.rgb,
      outputNode,
      baseColorUniform,
      uuid: crypto.randomUUID(),
    };
  }, [wallCount, w.view.fadeRoomsFx.uid]);

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
  }, [w.view.fadeRoomsFx.uid]);

  useEffect(() => {
    state.positionInstances();
    state.positionTrimInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    mat.baseColorUniform.value.set(w.getTheme().walls.color);

    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.decor.ready, mat.uuid]);

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
  instTrim: null | THREE.InstancedMesh;
  /** The trim's own geometry — see `trimQuad` in the state */
  trimQuad: THREE.BufferGeometry;
  quad: THREE.BufferGeometry;

  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; meta: Meta };
  getWallMat: (
    seg: [Geom.Vect, Geom.Vect],
    transform: Geom.AffineTransform,
    determinant: number,
    height?: number,
    baseHeight?: number,
  ) => THREE.Matrix4;
  /** Writes the rooms either side of a wall segment into its instance — or its BROAD wall's slot */
  setSegSlots: (
    slots: THREE.InstancedBufferAttribute,
    instanceId: number,
    gmId: number,
    wallSeg: Geomorph.GmData["wallSegs"][number],
  ) => void;
  /** The same for a door or window, which knows its rooms already */
  setConnectorSlots: (
    slots: THREE.InstancedBufferAttribute,
    instanceId: number,
    gmId: number,
    roomIds: (null | number)[],
  ) => void;
  positionInstances: () => void;
  positionTrimInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();

const ceilTrimHeight = 0.2;
const ceilDoorTrimHeight = 0.2;
