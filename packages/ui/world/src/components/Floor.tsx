import { useStateRef } from "@npc-cli/util";
import { Mat, Poly, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { attribute, instanceIndex, int, mix, texture, transformNormalToView, uniform, uv, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { emptyMapDef, MAX_GEOMORPH_INSTANCES, mapVeilMs } from "../const";
import { createTwoSidedXzQuad, embedXZMat4 } from "../service/geometry";
import { createLayoutInstance, isEdgeGm } from "../service/geomorph";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { drawFloorGrid, drawLightsIntoTexture, drawRoomOutlines, worldToCanvas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createTwoSidedXzQuad(),
      uvOffsets: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      drawnGmsHash: 0,
      drawnMapKey: null,

      fade: { texAmount: uniform(0), animId: 0, resolve: null }, // initially `fadeColor`

      addUvs(gms = w.gms) {
        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);

        for (const [gmId, gm] of gms.entries()) {
          // geomorph 301 pngRect height/width ~ 0.5 but not equal
          (uvDimensions.array as Float32Array)[gmId * 2 + 0] = 1;
          (uvDimensions.array as Float32Array)[gmId * 2 + 1] = isEdgeGm(gm.key)
            ? gm.bounds.height / gm.bounds.width
            : 1;
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
      },
      async draw() {
        w.setNextPending({ floor: true });

        // one texture per gmId = texId (nav tris can change near hull doors)
        for (const [gmId] of w.gms.entries()) {
          state.drawGm(gmId);
          w.texFloor.updateIndex(gmId);
          await pause();
        }

        if (w.assets !== null) {
          await w.view.dimBackground(false);
        }
        w.setNextPending({ floor: false });
      },
      drawGm(gmId) {
        const { ct } = w.texFloor;

        // - most aspects only depend on uninstantiated geomorph `layout`
        // - however lights depend on instantiated decor (with gmRoomId)
        const gm = w.gms[gmId];
        const layout = state.startGm(gmId);
        if (layout === null) return;

        const hullFloor = state.getHullFloor(layout);
        state.drawHullFloor(ct, hullFloor, layout);

        // wall bases
        drawPolygons(ct, layout.walls, { fillStyle: "#000", strokeStyle: null, lineWidth: 0.05 });

        // room outlines
        drawRoomOutlines(ct, layout, w.getTheme().floor);

        // fix curved walls aliasing 🚧 prefer meta.curved
        drawPolygons(
          ct,
          gm.walls.filter((x) => x.meta.broad),
          { fillStyle: null, strokeStyle: "#000", lineWidth: 0.1 },
        );

        // 🔔 draw nav mesh: gmId specific
        ct.lineJoin = "round";
        ct.lineWidth = 0.01;
        const fillStyle = "#fff1";
        const strokeStyle = w.getTheme().floor.navStroke;
        const triangle = new Poly([new Vect(), new Vect(), new Vect()]);
        (w.nav?.toNavTris[gmId] ?? []).forEach(([positions]) => {
          for (let i = 0; i < positions.length; i += 9) {
            triangle.outline[0].set(positions[i], positions[i + 2]);
            triangle.outline[1].set(positions[i + 3], positions[i + 5]);
            triangle.outline[2].set(positions[i + 6], positions[i + 8]);
            drawPolygons(ct, [triangle], { fillStyle, strokeStyle });
          }
        });

        // door shadow
        // 🔔 gaps in doorways should be fixed by adjusting door relative to wall
        for (const door of layout.doors.concat(layout.windows.filter((x) => x.meta.curved !== true))) {
          ct.lineWidth = door.meta.hull ? 0.225 : 0.125;
          tmpPoly.outline = door.seg;
          ct.lineJoin = "miter";
          drawPolygons(ct, tmpPoly, { fillStyle: null, strokeStyle: "#000c" });
        }

        // light circles
        drawLightsIntoTexture(ct, gm);

        // obstacle drop shadows
        drawPolygons(
          ct,
          Poly.union(
            layout.obstacles.flatMap((x) =>
              x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
            ),
          ),
          { fillStyle: "#0006", strokeStyle: null },
        );

        if (w.debug?.gridShown) {
          ct.save();
          drawPolygons(ct, hullFloor, { clip: true, fillStyle: "#fff0", strokeStyle: null });
          drawFloorGrid(ct, gm.bounds, gm.gridRect);
          ct.restore();
        }
      },
      drawHull(gmId, gms = w.gms) {
        const layout = state.startGm(gmId, gms);
        if (layout === null) return;
        state.drawHullFloor(w.texFloor.ct, state.getHullFloor(layout), layout);
      },
      drawHullFloor(ct, hullFloor, layout) {
        drawPolygons(ct, hullFloor, { fillStyle: w.getTheme().floor.hullFill, strokeStyle: null });

        // the stripes the page used to show through a transparent hull, drawn INTO the floor
        // instead: they now lie on it, so they slide with the world rather than with the screen,
        // and nothing behind the canvas has to be arranged to show through
        ct.save();
        drawPolygons(ct, hullFloor, { clip: true, fillStyle: "#fff0", strokeStyle: null });
        ct.beginPath();
        const { x, y, width, height } = layout.bounds;
        // 45°, so each line runs the height of the geomorph across; from `-height` so the ones
        // crossing its top-left corner are drawn too
        for (let d = -height; d < width; d += hullStripeGap) {
          ct.moveTo(x + d, y);
          ct.lineTo(x + d + height, y + height);
        }
        ct.lineWidth = hullStripeWidth;
        ct.strokeStyle = hullStripeColor;
        ct.stroke();
        ct.restore();
      },
      drawHulls(gms) {
        state.transformInstances(gms);
        state.addUvs(gms);
        for (const [gmId] of gms.entries()) {
          state.drawHull(gmId, gms);
          w.texFloor.updateIndex(gmId);
        }
        w.update();
      },
      async fadeOut() {
        // a map change is a fade through black — the world stays standing, so there is no fold
        // to play out and nothing to hold on screen whilst the next map loads
        await w.view.veilCanvas(true, mapVeilMs);
        // the background goes black unseen beneath it, ready for the gaps in the next map's floor
        void w.view.dimBackground(true, 0);
      },
      fadeTo(to, ms = floorFadeMs) {
        return new Promise<void>((resolve) => {
          const { fade } = state;
          // a fade replaced mid-flight still settles, else whoever awaited it — `draw`, and so
          // `pending.floor` and the whole map settling — would wait forever
          cancelAnimationFrame(fade.animId);
          fade.resolve?.();
          fade.resolve = resolve;

          const from = fade.texAmount.value;
          const startMs = performance.now();
          const step = () => {
            const t = ms > 0 ? Math.min(1, (performance.now() - startMs) / ms) : 1;
            fade.texAmount.value = from + (to - from) * t;
            w.r3f?.invalidate(); // self-driving, so it runs whilst the world is paused too
            if (t === 1) {
              fade.animId = 0;
              fade.resolve = null;
              return resolve();
            }
            fade.animId = requestAnimationFrame(step);
          };
          step();
        });
      },
      /** Layout instances for a map we have not loaded yet — enough to draw its hulls */
      getGmsOf(mapKey) {
        const mapDef = w.assets.map[mapKey] ?? emptyMapDef;
        return mapDef.gms.map(({ gmKey, transform }, gmId) =>
          createLayoutInstance(w.assets.layout[gmKey] as Geomorph.Layout, gmId, transform),
        );
      },
      /** Inset by half a hull doorway, to avoid adjacent doorway overlap */
      getHullFloor(layout) {
        return geomService.createInset(layout.hullPoly.map((x) => x.clone().removeHoles())[0], 0.08);
      },
      onNewMap() {
        if (state.drawnGmsHash === w.gmsHash) return;
        state.drawnGmsHash = w.gmsHash;
        if (state.drawnMapKey === w.mapKey) return;
        // only the FIRST map unfolds; a change fades through black with the world left standing
        const firstMap = state.drawnMapKey === null;
        state.drawnMapKey = w.mapKey;

        if (firstMap === true) {
          state.fade.texAmount.value = 0; // arrives flat, whatever it was
          w.setWorldFold(0); // with the rest of the world flat until the map has settled
        }
        state.drawHulls(w.gms);

        if (firstMap === true) {
          // only once a frame holding them has been rendered, so they arrive whole
          requestAnimationFrame(() => requestAnimationFrame(() => void w.view.veilCanvas(false)));
        }
      },
      /** Clear the shared canvas and put it in this geomorph's local coords */
      startGm(gmId, gms = w.gms) {
        const gmKey = gms[gmId]?.key;
        const layout = w.assets.layout[gmKey] ?? null;
        if (layout === null) return null;

        const { ct } = w.texFloor;
        ct.resetTransform();
        ct.globalCompositeOperation = "source-over";
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        // biome-ignore format: succinct
        ct.setTransform( worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);
        return layout;
      },
      transformInstances(gms = w.gms) {
        if (!state.inst) return;
        // else instances of a longer previous map linger, transformed and textured as it was
        state.inst.count = gms.length;
        for (const [gmId, gm] of gms.entries()) {
          const mat = new Mat({
            a: gm.bounds.width,
            b: 0,
            c: 0,
            d: gm.bounds.height,
            e: gm.bounds.x,
            f: gm.bounds.y,
          }).postMultiply(gm.matrix);
          state.inst.setMatrixAt(gmId, embedXZMat4(mat));
          // state.inst.setMatrixAt(gmId, embedXZMat4(mat, { yHeight: gmId * 1 }));
        }
        state.inst.instanceMatrix.needsUpdate = true;
        state.inst.computeBoundingSphere();
      },
    }),
  );

  w.floor = state;

  const material = useMemo(() => {
    const texArray = w.texFloor;
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    const texel = texNode.depth(instanceIndex);
    return {
      // fix InstancedMesh non-uniform scaling
      normalNode: transformNormalToView(vec3(0, 1, 0)),
      // - force alpha 1 to avoid object-pick having rgb scaled by alpha
      // - can pick texture alpha < 1 because floor can be partially transparent
      outputNode: w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.floor, 1),
      // `texAmount` takes the art to `fadeColor` whilst keeping the hull it lies in — a map
      // leaves as a flat shape, and the next arrives as one. See `draw`
      texNode: vec4(mix(fadeColor, texel.rgb, state.fade.texAmount), texel.a),
      uid: generateUUID(),
    };
  }, [w.texFloor.hash]);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.onNewMap(); // in the same tick as the transforms above, else they disagree
    // render initially or once decor has gmRoomIds
    (w.decor.ready || !w.isReady()) && state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData, w.decor.ready]);

  return (
    <instancedMesh
      name="floor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_GEOMORPH_INSTANCES]}
      renderOrder={-3}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        key={material.uid}
        side={THREE.FrontSide} // one draw call
        transparent
        alphaTest={0.01}
        colorNode={material.texNode}
        normalNode={material.normalNode}
        outputNode={material.outputNode}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  /** `w.gmsHash` the hulls were last put up for */
  drawnGmsHash: number;
  /** The map those hulls belonged to — only a change of map is a transition */
  drawnMapKey: null | string;
  fade: {
    /** `0` the floor renders black, `1` it renders its texture */
    texAmount: THREE.UniformNode<"float", number>;
    animId: number;
    resolve: null | (() => void);
  };
  addUvs(gms?: Geomorph.LayoutInstance[]): void;
  draw(): Promise<void>;
  drawGm(gmId: number): void;
  /** Just the hull, as a stand-in until `drawGm` lands */
  drawHull(gmId: number, gms?: Geomorph.LayoutInstance[]): void;
  /** Place, uv and hull-fill every geomorph of `gms` */
  drawHulls(gms: Geomorph.LayoutInstance[]): void;
  fadeTo(to: number, ms?: number): Promise<void>;
  fadeOut(nextMapKey: string): Promise<void>;
  getGmsOf(mapKey: string): Geomorph.LayoutInstance[];
  getHullFloor(layout: Geomorph.Layout): Geom.Poly[];
  /** The hull's own fill, plus the diagonal hatch that used to come from the page behind */
  drawHullFloor(ct: CanvasRenderingContext2D, hullFloor: Geom.Poly[], layout: Geomorph.Layout): void;
  /** Draw map hulls, ahead of `draw` */
  onNewMap(): void;
  startGm(gmId: number, gms?: Geomorph.LayoutInstance[]): null | Geomorph.Layout;
  transformInstances(gms?: Geomorph.LayoutInstance[]): void;
};

/** How long each stage of the floor's fade takes */
const floorFadeMs = 300;

/** What a map's floor fades to as it leaves, and arrives as — the page it sits on, so white */
/** The hatch drawn into the hull floor: spacing and width in METRES, so it lies on the world */
const hullStripeGap = 0.16;
const hullStripeWidth = 0.025;
const hullStripeColor = "#0000001a";

/** What a folded map shows in place of its art: the hull as a flat black shape */
const fadeColor = vec3(0, 0, 0);

const tmpMat1 = new Mat();
const tmpPoly = new Poly();
