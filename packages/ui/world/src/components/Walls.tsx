import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, mix, positionGeometry, step, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const.env";
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
      quad: createTwoSidedXyQuad(),

      decodeInstanceId(instanceId: number) {
        let id = instanceId;
        const gmId = w.gms.findIndex(({ key }) => {
          const { wallSegs, lintelSegs } = w.gmsData.byKey[key];
          const count = wallSegs.length + lintelSegs.length;
          return id < count || ((id -= count), false);
        });
        const { wallSegs, lintelSegs } = w.gmsData.byKey[w.gms[gmId].key];
        if (id < wallSegs.length) return { gmId, seg: wallSegs[id].seg, meta: wallSegs[id].meta };
        // each geomorph's lintels follow its walls
        const lintel = lintelSegs[id - wallSegs.length];
        return { gmId, seg: lintel.seg, meta: { ...lintel.meta, doorId: lintel.doorId } };
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
      positionInstances() {
        const { inst: ws } = state;
        if (!ws) return;
        const count = w.gmsData.count.wall + w.gmsData.count.lintel;
        const slots = ensureRoomSlots(state.quad, count);
        const heights = ensureWallHeights(state.quad, count);

        let instanceId = 0;
        const color = new THREE.Color(w.getTheme().walls.color);

        for (const [gmId, { key: gmKey, transform, determinant, doors }] of w.gms.entries()) {
          for (const wallSeg of w.gmsData.byKey[gmKey].wallSegs) {
            const { seg, meta } = wallSeg;
            state.setSegSlots(slots, instanceId, gmId, wallSeg);
            heights.setX(instanceId, typeof meta.h === "number" ? meta.h : wallHeight);
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

          for (const { seg, meta, doorId } of w.gmsData.byKey[gmKey].lintelSegs) {
            // shown with either of its door's rooms: a missing side never, else every hull lintel would show
            const [a, b] = doors[doorId].roomIds.map((id) =>
              typeof id === "number" ? slotOf(gmId, id) : neverShownSlot,
            );
            slots.setXY(instanceId, a, b);
            heights.setX(instanceId, meta.h);
            ws.setMatrixAt(instanceId, state.getWallMat(seg, transform, determinant, meta.h, meta.y));
            ws.setColorAt(instanceId++, color);
          }
        }

        slots.needsUpdate = heights.needsUpdate = true;
        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
        if (ws.instanceColor) ws.instanceColor.needsUpdate = true;
      },
    }),
  );

  w.wall = state;

  /** Walls, and the lintels over doors */
  const wallCount = w.gmsData.count.wall + w.gmsData.count.lintel;

  // before the materials below, which read `roomSlots`: an attribute a shader names has to be on
  // the geometry by the time it compiles, and `positionInstances` only fills it in an effect
  useMemo(() => {
    ensureRoomSlots(state.quad, wallCount);
    ensureWallHeights(state.quad, wallCount);
  }, [wallCount]);

  const mat = useMemo(() => {
    // 🔔 objectPick.value 0.5 ignores walls for easier picking
    const opacityUniform = uniform(0.5);
    const outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.wall);

    const baseColorUniform = uniform(new THREE.Color());

    // a wall belongs to the rooms on BOTH sides, and is shown at the fuller of the two — so a room
    // in view keeps every wall that encloses it, whatever stands on the far side of them
    const slots = attribute<"vec2">("roomSlots", "vec2");
    const fade = w.view.fadeRoomsFx.fadeAtPair(slots);
    // `sight` fades the ALPHA out; the other modes keep it solid and take its COLOUR to black
    const [alphaFade, colorFade] = fadeSplit(w.view.fadeRoomsFx.sightNode, fade);

    // darker along its foot and its top, in its own colour: walls of one colour blend alike in any order
    const height = attribute<"float">("wallHeight", "float");
    const inBand = step(positionGeometry.y.mul(height), wallBandHeight).max(
      step(positionGeometry.y.oneMinus().mul(height), wallBandHeight),
    );
    const bandOpacity = mix(float(1), float(wallBandDarken), inBand);

    const litOpacityNode = w.view.objectPick.notEqual(0).select(
      // objectPick 0.5 ignores walls for easier picking
      w.view.objectPick.notEqual(1).select(0, 1),
      opacityUniform.mul(alphaFade).mul(bandOpacity).min(1), // beauty render
    );

    return {
      opacityUniform,
      // faded via alpha in `sight` only, so the pick pass stays binary
      opacityNode: litOpacityNode,
      // NOT tinted by `service/player-light`: a wall is flat colour at half opacity, so the light
      // only ever muddied what was behind it — and this runs on every wall fragment in the world
      // out of the pick pass whilst hidden, so a click reaches the floor behind it
      colorNode: w.view.fadeRoomsFx.dropPickWhenHidden(
        w.view.fadeRoomsFx.fadeRgb(baseColorUniform.rgb, colorFade),
        fade,
        w.view.objectPick,
      ),
      outputNode,
      baseColorUniform,
      uuid: crypto.randomUUID(),
    };
  }, [wallCount, w.view.fadeRoomsFx.uid]);

  useEffect(() => {
    state.positionInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    mat.baseColorUniform.value.set(w.getTheme().walls.color);

    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.themeKey, w.decor.ready, mat.uuid]);

  return wallCount ? (
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
  ) : null;
}

/** `[alphaFade, colorFade]`: `sight` fades alpha out, the other modes fade colour to black */
function fadeSplit(focus: THREE.Node<"float">, fade: THREE.Node<"float">) {
  return [mix(float(1), fade, focus), mix(fade, float(1), focus)] as const;
}

/** Metres a wall's darker band reaches up from its foot, and down from its top */
const wallBandHeight = 0.2;
/** A band's opacity, as a multiple of the wall's */
const wallBandDarken = 2;

/** Each wall's height, which its bands are measured off */
function ensureWallHeights(geo: THREE.BufferGeometry, count: number) {
  const existing = geo.getAttribute("wallHeight") as undefined | THREE.InstancedBufferAttribute;
  if (existing !== undefined && existing.count >= count) return existing;
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(wallHeight), 1);
  geo.setAttribute("wallHeight", attr);
  return attr;
}

export type State = {
  inst: null | THREE.InstancedMesh;
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
  positionInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
