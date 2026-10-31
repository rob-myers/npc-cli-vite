import { useStateRef } from "@npc-cli/util";
import { useFrame } from "@react-three/fiber";
import { useContext, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  mix,
  positionGeometry,
  positionLocal,
  step,
  texture,
  uint,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const.env";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import { getWorldStore } from "../service/storage";
import { selectAs } from "../service/tsl";
import { WorldContext } from "./world-context";

/** The map's spots, an icon per kind coloured by sight, filled by jsh `spots show` */
export function SpotOverlay() {
  const w = useContext(WorldContext);

  /** Each spot's arrow: its colour, and its room's slot for the fade */
  const arrowsGeo = useMemo(() => {
    const geo = createOpenArrowGeo();
    geo.setAttribute("arrowInk", new THREE.InstancedBufferAttribute(new Float32Array(maxSpots * 4), 4));
    return geo;
  }, []);
  /** One interleaved buffer, a vertex buffer being scarce — see `spotStride` */
  const iconsGeo = useMemo(() => {
    const geo = createXzQuad();
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(maxSpots * spotStride), spotStride);
    geo.setAttribute("uvOffsets", new THREE.InterleavedBufferAttribute(buffer, 2, 0));
    geo.setAttribute("uvDimensions", new THREE.InterleavedBufferAttribute(buffer, 2, 2));
    geo.setAttribute("spotColor", new THREE.InterleavedBufferAttribute(buffer, 3, 4));
    geo.setAttribute("spotSlot", new THREE.InterleavedBufferAttribute(buffer, 1, 7));
    geo.setAttribute("uvTextureIds", new THREE.InterleavedBufferAttribute(buffer, 1, 8));
    geo.setAttribute("spotCentre", new THREE.InterleavedBufferAttribute(buffer, 4, 9));
    geo.setAttribute("spotShown", new THREE.InterleavedBufferAttribute(buffer, 1, 13));
    geo.setAttribute("spotSlotB", new THREE.InterleavedBufferAttribute(buffer, 1, 14));
    return Object.assign(geo, { spotBuffer: buffer });
  }, []);

  const state = useStateRef(
    (): State => ({
      arrowsInst: null as unknown as THREE.InstancedMesh,
      iconsInst: null as unknown as THREE.InstancedMesh,
      shown: getWorldStore(w.key).read().spotsShown,
      drawn: [],

      colour(colors) {
        if (!state.iconsInst) return;
        const buffer = iconsGeo.spotBuffer;
        const arrowInk = arrowsGeo.getAttribute("arrowInk");
        for (const [i, spot] of state.drawn.entries()) {
          tmpColor.set(colors?.[spot.key] ?? spot.color).toArray(buffer.array, i * spotStride + 4);
          tmpColor.toArray(arrowInk.array, i * 4);
          buffer.array[i * spotStride + 12] = spotIconSize;
        }
        buffer.needsUpdate = arrowInk.needsUpdate = true;
      },
      count() {
        const count = state.shown ? state.drawn.length : 0;
        for (const inst of [state.iconsInst, state.arrowsInst]) if (inst) inst.count = count;
      },
      draw(spots) {
        const dims = w.sheets?.maxDecorSheetDim;
        if (!state.iconsInst || !dims) return;
        const had = state.drawn.length > 0;
        state.drawn = spots.slice(0, maxSpots);
        if (had !== state.drawn.length > 0) w.menu?.update(); // it greys them out whilst there are none
        const data = iconsGeo.spotBuffer.array as Float32Array;
        const arrowInk = arrowsGeo.getAttribute("arrowInk").array as Float32Array;
        for (const [i, spot] of state.drawn.entries()) {
          const entry = w.sheets.decor[spot.img];
          const { x, y, width, height } = entry?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
          const room = spot.grKey === null ? null : w.helper.getGmRoomId(spot.grKey as Geomorph.GmRoomKey);
          const at = i * spotStride;
          data.set([x / dims.width, y / dims.height, width / dims.width, height / dims.height], at);
          const slot = room === null ? alwaysShownSlot : slotOf(room.gmId, room.roomId);
          const [slotA, slotB] = doorSlotsOf(w, spot) ?? [slot, slot];
          data[at + 7] = arrowInk[i * 4 + 3] = slotA;
          data[at + 14] = slotB;
          data[at + 8] = entry?.sheetId ?? 0;
          data.set(iconAt(spot), at + 9);
          data[at + 13] = spot.iconHidden === true ? 0 : 1;
          if (state.arrowsInst) writeSpotArrow(state.arrowsInst, i, spot);
        }
        if (state.arrowsInst) state.arrowsInst.instanceMatrix.needsUpdate = true;
        state.count();
        state.colour(null);
      },
      toggle() {
        const shown = !state.shown;
        state.set({ shown });
        state.count();
        getWorldStore(w.key).patch({ spotsShown: shown });
        w.events.next({ key: "spots-overlay", shown }); // jsh `spots show` fills it
        w.view.forceUpdate();
      },
    }),
  );

  w.spots = state;

  /** How opaque the icons and arrows are, set by theme each frame: nothing re-renders on a change of theme */
  const opacity = useMemo(() => ({ icon: uniform(spotInk.dark.icon), arrow: uniform(spotInk.dark.arrow) }), []);

  useFrame(() => {
    const ink = spotInk[w.themeKey === "light-theme" ? "light" : "dark"];
    [opacity.icon.value, opacity.arrow.value] = [ink.icon, ink.arrow];
  });

  /** How much of a spot shows, given its rooms' fade `shown`: only in sight mode does it fade with them */
  const spotSeen = (shown: THREE.Node<"float">) => shown.max(w.view.fadeRoomsFx.sightNode.oneMinus());

  const iconsMaterial = useMemo(() => {
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const texNode = texture(w.texDecor.tex, vec2(uv().x, uv().y.oneMinus()).mul(uvDims).add(uvOffs));
    texNode.depthNode = uint(attribute<"float">("uvTextureIds", "float"));
    const slots = vec2(attribute<"float">("spotSlot", "float"), attribute<"float">("spotSlotB", "float"));
    const seen = spotSeen(w.view.fadeRoomsFx.fadeAtPair(slots));
    // biome-ignore format: succint
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false, alphaTest: 0.05 });
    // a billboard `w` across, upright on screen: its arrow on the floor gives its facing
    const centre = attribute<"vec4">("spotCentre", "vec4");
    const picking = w.view.objectPick.notEqual(0);
    // the quad's own corner: `positionLocal` has the instance's matrix applied. Picked, it is larger
    const grow = selectAs<"float">(picking, float(spotPickScale), float(1));
    const corner = vec2(positionGeometry.x.sub(0.5), positionGeometry.z.sub(0.5)).mul(centre.w.mul(grow));
    const viewCentre = cameraViewMatrix.mul(vec4(centre.xyz, 1));
    // picked, the whole square counts, not only the icon's strokes, even one not shown
    const shown = attribute<"float">("spotShown", "float");
    // one showing nothing is a point, drawing no fragments. Picking, a hidden icon still counts
    const blank = seen
      .mul(w.view.foldNode)
      .mul(selectAs<"float">(picking, float(1), shown))
      .equal(0);
    mat.vertexNode = selectAs<"vec4">(
      blank,
      vec4(0, 0, 0, 1),
      cameraProjectionMatrix.mul(viewCentre.add(vec4(corner, 0, 0))),
    );
    // faded with the world's fold, so they come up as it unfolds on load
    // atop a wall, over nothing, it is solid but dim: the composite drops a faint pixel with nothing behind
    const atop = step(float(wallHeight), centre.y);
    const alpha = selectAs<"float">(
      picking,
      float(1),
      texNode.a
        .mul(seen)
        .mul(mix(opacity.icon, float(1), atop))
        .mul(shown)
        .mul(w.view.foldNode),
    );
    const dim = mix(float(1), opacity.icon, atop);
    mat.colorNode = vec4(texNode.rgb.mul(attribute<"vec3">("spotColor", "vec3")).mul(dim), alpha);
    // opaque when picking: a blended id would be another's
    mat.outputNode = w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.spot, 1);
    return { material: mat, uid: crypto.randomUUID() };
  }, [w.view.fadeRoomsFx.uid, w.texDecor.tex]);

  const arrowsMaterial = useMemo(() => {
    const ink = attribute<"vec4">("arrowInk", "vec4");
    const seen = spotSeen(w.view.fadeRoomsFx.getVisiblity(ink.w));
    // biome-ignore format: succint
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false });
    const alpha = seen.mul(opacity.arrow).mul(w.view.foldNode);
    // a point, drawing no fragments, whilst picking or showing nothing
    mat.positionNode = positionLocal.mul(w.view.objectPick.notEqual(0).or(alpha.equal(0)).select(0, 1));
    mat.colorNode = vec4(ink.rgb, alpha);
    return mat;
  }, [w.view.fadeRoomsFx.uid]);

  // hidden with no instances, not `visible`: their pipelines are then built at load, not on the first show
  return (
    <>
      <instancedMesh
        key={iconsMaterial.uid}
        ref={state.ref("iconsInst")}
        args={[iconsGeo, iconsMaterial.material, maxSpots]}
        count={state.shown ? state.drawn.length : 0} // as before, should a new material remount it
        frustumCulled={false}
        renderOrder={spotsRenderOrder}
      />
      <instancedMesh
        key={`${iconsMaterial.uid}-arrows`}
        ref={state.ref("arrowsInst")}
        args={[arrowsGeo, arrowsMaterial, maxSpots]}
        count={state.shown ? state.drawn.length : 0} // as before, should a new material remount it
        frustumCulled={false}
        renderOrder={spotsRenderOrder}
      />
    </>
  );
}

const maxSpots = 4096;
/** After the floor, which is transparent too: they write no depth to keep it out */
const spotsRenderOrder = 10;
/** Floats per spot: `uvOffsets` 2, `uvDimensions` 2, `spotColor` 3, `spotSlot` 1, `uvTextureIds` 1, `spotCentre` 4, `spotShown` 1, `spotSlotB` 1 */
const spotStride = 15;
/** Metres across a spot's icon */
const spotIconSize = 0.15;
/** Metres its centre stands off the floor */
const spotIconLift = 0.12;
/** Metres its arrow lies off the floor */
const spotArrowLift = 0.02;
/** Metres along a spot's arrow, from its point along its facing */
const spotArrowLen = 0.18;
/** How far along its arrow the middle of its head is — see `createOpenArrowGeo` */
const arrowheadAt = 0.82;
/** By theme: how opaque a spot's icon and arrow are, its room not faded. Their colours are jsh `spots show`'s */
const spotInk = { dark: { icon: 0.2, arrow: 0.2 }, light: { icon: 1, arrow: 0.7 } };
/** A spot's icon, this much larger when picking: easier to press */
const spotPickScale = 1.4;
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** A spot as the overlay draws it: `img` its icon's decor key, `color` its own when none is given */
export type SpotDraw = {
  key: string;
  x: number;
  y: number;
  facing?: number;
  grKey: null | string;
  img: string;
  color: THREE.ColorRepresentation;
  /** A doable's decor, which a press on it is as one on */
  decorKey?: null | string;
  kind?: string;
  /** A door or doorway spot's door */
  gdKey?: string;
  /** Metres it stands above the floor, e.g. a doable on a seat */
  lift?: number;
  /** Its icon is not drawn, e.g. a wall spot's arrow says enough. It can still be picked */
  iconHidden?: boolean;
};

/** A door spot's two rooms' slots, as it shows whilst either does */
function doorSlotsOf(w: React.ContextType<typeof WorldContext>, spot: SpotDraw): null | [number, number] {
  const door = spot.kind === "door" ? w.door.byKey[spot.gdKey as Geomorph.GmDoorKey] : undefined;
  if (door === undefined) return null;
  const [a, b] = door.connector.roomIds.map((roomId) =>
    roomId === null ? alwaysShownSlot : slotOf(door.gmId, roomId),
  );
  return [a, b];
}

/** Where a spot's icon stands. One not shown covers its arrowhead instead, so pressing that picks it */
function iconAt(spot: SpotDraw): [number, number, number] {
  const lift = spot.lift ?? 0;
  if (spot.iconHidden !== true || spot.facing === undefined) return [spot.x, spotIconLift + lift, spot.y];
  const along = arrowheadAt * spotArrowLen;
  return [spot.x + Math.cos(spot.facing) * along, lift + spotArrowLift, spot.y + Math.sin(spot.facing) * along];
}

/** A spot's arrow on the floor along its facing, else none */
function writeSpotArrow(inst: THREE.InstancedMesh, i: number, spot: SpotDraw) {
  const [c, s] = spot.facing === undefined ? [0, 0] : [Math.cos(spot.facing), Math.sin(spot.facing)];
  const len = spotArrowLen;
  embedXZMat4(
    { a: c * len, b: s * len, c: -s * len, d: c * len, e: spot.x, f: spot.y },
    { yHeight: spotArrowLift + (spot.lift ?? 0), mat4: tmpMat4 },
  );
  inst.setMatrixAt(i, tmpMat4);
}

/** An open arrowhead on the XZ plane pointing along `+x`, its tip at `(1, 0, 0)`: two barbs, each a thin quad */
function createOpenArrowGeo() {
  const strokes: [number, number, number, number][] = [
    [1, 0, 0.65, -0.3],
    [1, 0, 0.65, 0.3],
  ];
  const t = 0.04;
  const positions = strokes.flatMap(([x1, z1, x2, z2]) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const [nx, nz] = [(-(z2 - z1) / len) * t, ((x2 - x1) / len) * t];
    return [x1 - nx, 0, z1 - nz, x2 - nx, 0, z2 - nz, x2 + nx, 0, z2 + nz, x1 + nx, 0, z1 + nz];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(strokes.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((k) => 4 * i + k)));
  return geo;
}

export type State = {
  /** Each spot's arrow, along its facing. `null` until mounted, despite the type */
  arrowsInst: THREE.InstancedMesh;
  /** Each spot's icon. `null` until mounted, despite the type */
  iconsInst: THREE.InstancedMesh;
  /** Whether the map's spots are drawn — see jsh `spots show` */
  shown: boolean;
  /** The spots drawn, by instance id */
  drawn: SpotDraw[];
  /** Colours the spots drawn by key, the rest their own, with `null` all their own */
  colour(colors: null | Record<string, THREE.ColorRepresentation>): void;
  /** Draws every spot whilst shown, else none */
  count(): void;
  /** Draws these spots, each in its own colour */
  draw(spots: SpotDraw[]): void;
  /** Shows the overlay, else hides it, and remembers which */
  toggle(): void;
};
