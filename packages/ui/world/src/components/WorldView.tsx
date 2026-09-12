import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Vect } from "@npc-cli/util/geom";
import { getRelativePointer, isRMB } from "@npc-cli/util/legacy/dom";
import { pause, testNever } from "@npc-cli/util/legacy/generic";
import { PersonSimpleCircleIcon, PlayIcon } from "@phosphor-icons/react";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState, useFrame } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import debounce from "debounce";
import { deltaAngle } from "maath/misc";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import useMeasure from "react-use-measure";
import { float, instanceIndex, output, pass, select, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  cameraFov,
  cameraRefAspect,
  canonicalBirdseyePolar,
  canonicalFlattenFrom,
  canonicalPeekPolar,
  canonicalSnapArm,
  canonicalSnapCancel,
  canonicalZoomInRate,
  crosshairY,
  defaultCameraFollow,
  defaultCameraMaxDistance,
  defaultCameraMinDistance,
  defaultCameraMode,
  frontierMargin,
  frontierNearest,
  frontierNearFrac,
  frontierPanFrac,
  frontierRate,
  npcConfig,
  roomLabelFadeBy,
  roomLabelNearAlpha,
  rotateSpeedDesktop,
  rotateSpeedMobile,
  zoomSpeedDesktop,
  zoomSpeedMobile,
} from "../const";
import {
  type CameraControls as BaseCameraControls,
  defaultZoomSettleRate,
  zoomCommitIn,
} from "../service/camera-controls";
import {
  createFadeRooms,
  type FadeRooms,
  type FadeRoomsMode,
  fadeRoomsModeByKey,
  nextFadeRoomsMode,
  parseFadeRoomsMode,
} from "../service/fade-rooms";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import {
  applyNpcOutline,
  createNpcMaskMrt,
  type NpcMaskMrt,
  npcOutlineUid,
  syncNpcOutlineWidth,
} from "../service/npc-outline";
import { decodePick } from "../service/pick";
import { createPlayerFrontier, type PlayerFrontier } from "../service/player-frontier";
import { createPlayerLight, type PlayerLight } from "../service/player-light";
import { createPostProcessing, type PostProcessing as PostProcessingType } from "../service/post-processing";
import { createRgbShift, type RgbShiftFx } from "../service/rgb-shift";
import { createRoomSlots, type RoomSlots } from "../service/room-slots";
import { getWorldStore, type PersistedCamera } from "../service/storage";
import type { SelectAnyType } from "../service/texture";
import { getWorldFlag, setWorldFlag } from "../service/world-flags";
import { CameraControls, type CameraModeType } from "./CameraControls";
import CrossHair from "./CrossHair";
import LightSweep from "./LightSweep";
import NpcBubbles from "./NpcBubbles";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  /** Every setting we persist — see `service/storage.ts`. Memoised per `worldKey` */
  const store = getWorldStore(w.key);
  const saved = store.read();

  const state = useStateRef(
    (): State => ({
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      canvas: null as any,
      // `follow` used to be a mode of its own: one stored from before becomes `free` with the
      // follow option ON, which is what it meant
      cameraMode: (saved.cameraMode as string) === "canonical" ? "canonical" : defaultCameraMode,
      cameraFollow: (saved.cameraMode as string) === "follow" ? true : (saved.cameraFollow ?? defaultCameraFollow),
      canonicalPolar: (saved.cameraInitial ?? defaultInitialCamera()).polar,
      canonicalTheta: nearestCompass((saved.cameraInitial ?? defaultInitialCamera()).azimuthal),
      canonicalDragging: false,
      canonicalPeak: 0,
      canonicalTilting: false,
      zoomPan: null,
      zoomCrossEl: null,
      zoomCrossFadeMs: 0,
      zoomInSlow: false,
      centreHint: false,
      fHeld: false,
      clickIds: [],
      controls: null as any,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: 0,
        maxPolarAngle: Math.PI / 2 - Math.PI / 8,
        minDistance: defaultCameraMinDistance,
        maxDistance: defaultCameraMaxDistance,
        panSpeed: 2,
        // touch gestures have far less travel than a mouse drag/wheel, so they need more per-pixel
        rotateSpeed: w.touchDevice ? rotateSpeedMobile : rotateSpeedDesktop,
        zoomSpeed: w.touchDevice ? zoomSpeedMobile : zoomSpeedDesktop,
      },
      initial: saved.cameraInitial ?? defaultInitialCamera(),
      lookAtAnimId: 0,
      lastPointer: {
        epochMs: 0,
        longPressTimer: 0,
        longPress: false,
        move: new Vect(),
        down: new Vect(),
        rightPress: false,
      },
      foldNode: uniform(1),
      labelReveal: uniform(1),
      labelRevealAnimId: 0,
      labelZoomFade: uniform(1),
      objectPick: uniform(0),
      playerLight: createPlayerLight(),
      // by getter: an hmr of the light rebuilds it — see `reset` — and this must follow. A reading
      // asks for a frame, so the camera adapts to a door opening ahead of a player standing still
      playerFrontier: createPlayerFrontier(
        () => state.playerLight,
        () => w.r3f?.invalidate(),
      ),
      frontierMs: 0,
      frontierHold: false,
      keysDown: new Set(),
      postFx: createPostProcessing(),
      rgbShiftFx: createRgbShift(),
      fadeRoomsFx: createFadeRooms(parseFadeRoomsMode(saved.fadeRoomsMode)),
      roomSlots: createRoomSlots(),
      pickDoors: uniform(saved.pickDoors === false ? 0 : 1),
      objectPickScale: 0.5, // don't pick walls by default
      pickRT: createPickRT(1),
      npcMaskMrt: null,
      busy: null,
      postProcessing: saved.postProcessing,
      npcOutline: saved.npcOutline,
      rgbShift: saved.rgbShift,
      fadeRoomsMode: parseFadeRoomsMode(saved.fadeRoomsMode),
      litNpcsEnabled: uniform(saved.litNpcsEnabled === false ? 0 : 1),
      // each is 0..1, driving a `mix` so 0 is exactly identity
      raycaster: new THREE.Raycaster(),

      computePixelUv(e) {
        // handle fractional device pixel ratio e.g. 2.625 on Pixel
        const glPixelRatio = w.r3f.gl.getPixelRatio();
        const { left, top } = (e.target as HTMLElement).getBoundingClientRect();
        const u = ((e.clientX - left) * glPixelRatio) / state.canvas.width;
        const v = ((e.clientY - top) * glPixelRatio) / state.canvas.height;
        return { u, v };
      },
      async createRenderer(props) {
        const canvas = props.canvas as HTMLCanvasElement;

        // three seeds its *logical* size from `canvas.width` (see `CanvasTarget`),
        // which otherwise defaults to 300x150. It must not be scaled by the pixel
        // ratio, which `setPixelRatio` applies below i.e. `canvas.width = w * ratio`.
        canvas.width = state.bounds.width;
        canvas.height = state.bounds.height;

        const renderer = new THREE.WebGPURenderer({
          canvas,
          alpha: true,
          antialias: true,
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
        });
        renderer.onDeviceLost = (event) => {
          console.warn("WebGPU device lost", event);
        };

        // before `init`, so attachments are created at the drawing buffer size,
        // rather than at 1x whilst the canvas is already scaled. Matches the `dpr`
        // given to `<Canvas>`, so r3f's own `setPixelRatio` is a no-op.
        renderer.setPixelRatio(getPixelRatio());

        await renderer.init();
        return renderer;
      },
      forceUpdate(delta = 0) {
        w.npc?.onTick(delta);
        w.r3f?.invalidate();
        w.update();
      },
      forwardWheel(e) {
        // overlays are siblings of the canvas, so their wheel events never reach the controls
        e.stopPropagation();
        state.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
      },
      async runBusy(text, task) {
        const shownAt = Date.now();
        state.busy = text;
        state.update();
        await awaitPaint(); // the overlay is on screen before the work blocks the thread
        try {
          task();
        } finally {
          // the work itself is usually a shader compile, which lands in the NEXT frame — so ask for
          // one and wait until it has been painted
          w.r3f?.invalidate();
          await awaitPaint();
          // a quick task would otherwise flicker the overlay, so it stays up a while regardless
          await pause(Math.max(0, busyMinMs - (Date.now() - shownAt)));
          state.busy = null;
          state.update();
        }
      },
      getPickedFromPixel([r, g, b, _a]) {
        // console.log(`pixel`, { r, g, b, a: _a });
        const pick = decodePick(r, g, b);

        if (pick === null) {
          return null;
        }

        switch (pick.type) {
          case "floor": {
            const gmId = pick.instanceId;
            const gm = w.gms[gmId];
            if (!gm) return null;
            return { ...pick, gmId, gmKey: gm.key, floor: true };
          }
          case "ceiling": {
            const gmId = pick.instanceId;
            const gm = w.gms[gmId];
            if (!gm) return null;
            return { ...pick, gmId, gmKey: gm.key, ceiling: true };
          }
          case "wall": {
            const decoded = w.wall.decodeInstanceId(pick.instanceId);
            return { ...pick, wall: true, ...decoded };
          }
          case "obstacle": {
            const decoded = w.obs.decodeInstanceId(pick.instanceId);
            return { ...pick, obstacle: true, ...decoded };
          }
          case "door": {
            const decoded = w.door.decodeInstanceId(pick.instanceId);
            return { ...pick, door: true, ...decoded };
          }
          case "decor": {
            const decoded = w.decor.decodeStaticInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, decor: true, ...decoded, decorKey: decoded.decorKey };
          }
          case "runtimeDecor": {
            const decoded = w.decor.decodeRuntimeInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, type: "decor", decor: true, runtime: true, ...decoded, decorKey: decoded.decorKey };
          }
          case "debugPoint": {
            const decoded = w.debug.decodeDebugPointInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, debugPoint: true, ...decoded };
          }
          case "npc": {
            const npc = w.npc.byPickId[pick.instanceId];
            if (npc) return { ...pick, npcKey: npc.key, npc: true, ...w.e.npcToRoom.get(npc.key) };
            return null;
          }
          default:
            throw new ExhaustiveError(pick);
        }
      },
      getRaycastIntersection(e, picked) {
        let mesh: THREE.Mesh;

        const uv = state.computePixelUv(e);
        const normalizedDeviceCoords = new THREE.Vector2(-1 + 2 * uv.u, +1 - 2 * uv.v);
        w.view.raycaster.setFromCamera(normalizedDeviceCoords, state.controls?.object ?? w.r3f.camera);

        switch (picked.type) {
          case "floor":
            mesh = getTempInstanceMesh(w.floor.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "wall":
            mesh = getTempInstanceMesh(w.wall.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "npc":
            mesh = w.npc.npc[picked.npcKey].skinnedMesh;
            break;
          case "door":
            mesh = getTempInstanceMesh(w.door.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "obstacle":
            mesh = getTempInstanceMesh(w.obs.inst, picked.instanceId);
            // a skirt carries its OBSTACLE's pick id, so the ray may have gone through one of those
            // and miss the top — fall back to the top's centre, the obstacle being what was picked
            // either way. `center` is in the geomorph's space, hence the matrix
            if (state.raycaster.intersectObject(mesh).length === 0) {
              const gm = w.gms[picked.gmId];
              const { center, height } = gm.obstacles[picked.obstacleId];
              const at = gm.matrix.transformPoint({ x: center.x, y: center.y });
              const point = new THREE.Vector3(at.x, height, at.y);
              return { distance: point.distanceTo(state.raycaster.ray.origin), point, object: mesh, normal: up };
            }
            break;
          case "ceiling":
            mesh = getTempInstanceMesh(w.ceil.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "decor":
            if (picked.runtime) {
              mesh = getTempInstanceMesh(w.decor.instRuntime as THREE.InstancedMesh, picked.instanceId);
            } else {
              mesh = getTempInstanceMesh(w.decor.inst as THREE.InstancedMesh, picked.instanceId);
            }
            break;
          case "debugPoint":
            mesh = getTempInstanceMesh(w.debug.debugPointsInst as THREE.InstancedMesh, picked.instanceId);
            break;
          default:
            throw testNever(picked);
        }

        const [intersection] = state.raycaster.intersectObject(mesh);
        if (!intersection) return null;

        intersection.normal = computeIntersectionNormal(mesh, intersection);
        return intersection;
      },
      isPointDiffDrag(pointA, pointB) {
        return tmpVect.copy(pointA).distanceTo(pointB) > (w.touchDevice === true ? 20 : 5);
      },
      onCameraStart() {
        state.frontierHold = false; // the view is theirs again
      },
      onCameraEnd() {
        const cameraInitial: PersistedCamera = {
          azimuthal: state.controls.spherical.theta,
          polar: state.controls.spherical.phi,
          position: { x: state.controls.target.x, y: state.controls.spherical.radius, z: state.controls.target.z },
        };
        store.patch({ cameraInitial });
        // a drag released without momentum dispatches no further change: `canonical`'s detent
        // needs a frame to see the release at all — see `onCameraFrame`
        w.r3f?.invalidate();
      },
      onZoomWheel(e) {
        if (state.cameraMode !== "canonical") return;
        const { controls } = state;
        if (controls === null || state.canvas === null) return;

        // a zoom-in aims at the cursor's ground point and pans onto it, ending up CENTRED rather
        // than merely held still as `zoomToCursor` does. Aimed once the zoom has COMMITTED:
        // re-aiming then would raycast from the already-panned camera. Before that the camera has
        // barely moved, and the cursor may well have — so a wheel elsewhere re-aims at once, rather
        // than waiting on the settle back out and the crosshair's fade. Only the destination
        // moves, so the pan keeps its progress. It rides the zoom, so it also needs zoom left
        if (e.deltaY >= 0) return;
        if (state.zoomPan !== null && controls.zoomProgress > zoomCommitIn) return;
        if (1 - controls.zoomProgress < zoomPanMinSpan) return;

        if (state.getFollowGoal(tmpGoal) === true) {
          // following, the zoom is theirs: it heads for them wherever the cursor is
          tmpGroundHit.set(tmpGoal.x, 0, tmpGoal.z);
        } else {
          const rect = state.canvas.getBoundingClientRect();
          tmpNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
          state.raycaster.setFromCamera(tmpNdc, controls.object as THREE.PerspectiveCamera);
          if (state.raycaster.ray.intersectPlane(groundPlane, tmpGroundHit) === null) return;

          // a shallow ray meets the ground hundreds of metres out — keep the aim to what is in view
          const maxPan = state.ctrlOpts.maxDistance ?? 20;
          if (tmpGroundHit.distanceTo(controls.target) > maxPan) {
            tmpGroundHit.sub(controls.target).setLength(maxPan).add(controls.target);
          }
        }

        if (state.zoomPan !== null) {
          state.zoomPan.to.copy(tmpGroundHit); // re-aimed, see above
        } else {
          state.zoomPan = {
            from: controls.target.clone(),
            to: tmpGroundHit.clone(),
            lastTarget: controls.target.clone(),
            lastTheta: controls.spherical.theta,
            lastBeta: 0,
            fromProgress: controls.zoomProgress,
            fromPolar: controls.spherical.phi,
            toPolar: state.canonicalPolar, // the tilt we were last at close in, restored by the way in
          };
        }
        state.zoomInSlow = true; // until the ZOOM finishes, not just the pan
        state.setCrosshair(tmpGroundHit);
        w.r3f?.invalidate();
      },
      getFollowedPlayer() {
        const player = w.n[w.player?.key ?? ""];
        return state.cameraFollow === true || state.frontierHold === true ? player : undefined;
      },
      getFollowGoal(out) {
        const player = state.getFollowedPlayer();
        if (player === undefined) return false;
        out.x = player.position.x;
        out.z = player.position.z;
        // in `canonical` the view is held part way towards the frontier, so what is ahead is in
        // view too — at every zoom, the inner stop being drawn in to suit as the outer is
        if (state.cameraMode === "canonical" && state.playerFrontier.ahead(tmpAhead) === true) {
          let offsetX = tmpAhead.x * frontierPanFrac;
          let offsetZ = tmpAhead.z * frontierPanFrac;
          // but never so far that the PLAYER leaves the frame: the fit is clamped by the persisted
          // stops, and where the zoom cannot open up to suit, the offset gives way instead. They
          // are PROJECTED as they would sit once the target is at the goal — the rig moves with
          // the target, so only their offset from it matters, and the camera's current matrices
          // answer for any tilt: the near side of a tilted view is foreshortened, which no planar
          // estimate gets right. Perspective makes it a few refinements rather than one scale
          const { controls } = state;
          const camera = controls.object as THREE.PerspectiveCamera;
          const limit = 1 / frontierMargin; // of the half-screen, the same margin the fit is given
          for (let i = 0; i < 4; i++) {
            // their feet AND their head: on a tilted view the head projects further, and a player
            // standing at the bottom edge with only their feet in shot is what this is for
            tmpProjected.set(controls.target.x - offsetX, 0, controls.target.z - offsetZ).project(camera);
            const feet = Math.max(Math.abs(tmpProjected.x), Math.abs(tmpProjected.y));
            tmpProjected
              .set(controls.target.x - offsetX, npcConfig.dist.height, controls.target.z - offsetZ)
              .project(camera);
            const head = Math.max(Math.abs(tmpProjected.x), Math.abs(tmpProjected.y));
            const over = Math.max(feet, head) / limit;
            if (over <= 1) break;
            offsetX /= over;
            offsetZ /= over;
          }
          out.x += offsetX;
          out.z += offsetZ;
        }
        return true;
      },
      getCrosshairPivot() {
        const el = state.zoomCrossEl;
        // not whilst following: the target is the player's, and a slide of it would only be undone
        return state.getFollowedPlayer() === undefined && el !== null && el.visible === true ? el.position : null;
      },
      setCrosshair(at) {
        const el = state.zoomCrossEl;
        if (el === null) return;
        el.position.set(at.x, crosshairY, at.z);
        el.visible = true;
        (el.material as THREE.MeshBasicMaterial).opacity = 1;
        state.zoomCrossFadeMs = 0; // a fresh aim cancels any fade underway
      },
      /**
       * Rebuild the camera about `target` at `phi` and re-aim it. `update` has already aimed at
       * the target it had BEFORE our writes, so without this each frame renders a new position
       * through the last one's orientation — seen as jitter
       */
      placeCamera(spherical, phi) {
        const { controls } = state;
        tmpLookAtOffset.setFromSphericalCoords(spherical.radius, phi, spherical.theta);
        controls.object.position.copy(controls.target).add(tmpLookAtOffset);
        controls.object.lookAt(controls.target);
        controls.object.updateMatrixWorld();
      },
      onCameraFrame(spherical) {
        // outside the mode check, so a fade underway still finishes if the mode changes beneath it
        state.fadeCrosshair();

        const { controls } = state;
        // the LIVE stops rather than the persisted ones: `easeFrontier` draws both in, and the
        // view is no less zoomed out, or in, for standing at a wall
        const min = controls.minDistance;
        const max = controls.maxDistance;
        /** `0` at the inner zoom stop, `1` at the outer one */
        const t = clamp01((spherical.radius - min) / (max - min));

        // a room label thins out as the view comes in: close in the room speaks for itself and its
        // name is mostly in the way. Its SIZE is left alone — being fixed in metres it grows with
        // the room, which is what keeps it attached to the floor rather than floating over it.
        // Measured off the radius rather than `zoomProgress`, which a free (touch) zoom does not
        // keep. Every mode, unlike what follows
        const u = clamp01(t / roomLabelFadeBy);
        const eased = u * u * (3 - 2 * u); // eased, so it neither snaps out nor lingers
        state.labelZoomFade.value = roomLabelNearAlpha + (1 - roomLabelNearAlpha) * eased;

        if (state.cameraMode !== "canonical") return;

        // the aimed zoom-in eases slower, a pan and a tilt riding on it — held until the ZOOM
        // ends rather than the pan, since speeding up for its last few percent is felt as a jolt
        if (state.zoomInSlow === true && controls.zoomProgress >= 1 - zoomOutStopEpsilon) {
          state.zoomInSlow = false;
        }
        controls.zoomSettleRate = state.zoomInSlow === true ? canonicalZoomInRate : defaultZoomSettleRate;
        state.easeFrontier();

        // steerable at every zoom: the azimuth is the detented dial below throughout, and the polar
        // is the user's own close in, and a spring-back peek zoomed out — see `shapeCanonicalPolar`
        controls.enableRotate = true;
        // a drag locks to the axis it set off along only whilst ZOOMED OUT, where the peek and the
        // dial share it and the lock keeps them apart. Once a zoom-in is under way the polar is
        // pinned, and a turn begun a little up or down would lock vertical and do nothing at all —
        // and close in the polar is the user's own, so a diagonal drag may simply do both
        controls.lockRotateAxis = t > canonicalFlattenFrom && state.zoomPan === null;

        // whilst a zoom-in's pan runs it owns the polar; otherwise the zoom shapes it
        state.zoomPan !== null ? state.advanceZoomPan(spherical) : state.shapeCanonicalPolar(spherical, t);
        state.detentCanonicalAzimuth(spherical);
      },
      /**
       * Room labels in or out, over `ms`. Only the first boot uses it: the world is REVEALED there
       * — shown whole, then faded down to the room the player is in as it rises (see
       * `onBootstrapMap`) — and a name that appears with the ship only to go out again a moment
       * later reads as a fault. So they are held back and brought in once that has settled
       */
      revealRoomLabels(to, ms = 0, delayMs = 0) {
        cancelAnimationFrame(state.labelRevealAnimId);
        const from = state.labelReveal.value;
        const startMs = performance.now() + delayMs;
        const step = () => {
          const elapsed = performance.now() - startMs;
          if (elapsed < 0) {
            state.labelRevealAnimId = requestAnimationFrame(step);
            return; // still waiting for the fade it follows
          }
          const t = ms > 0 ? Math.min(1, elapsed / ms) : 1;
          state.labelReveal.value = from + (to - from) * t;
          state.labelRevealAnimId = t < 1 ? requestAnimationFrame(step) : 0;
          w.r3f?.invalidate();
        };
        step();
      },
      /** The crosshair's fade-out, once whatever raised it has arrived */
      fadeCrosshair() {
        if (state.zoomCrossFadeMs === 0 || state.zoomCrossEl === null) return;
        const ratio = (performance.now() - state.zoomCrossFadeMs) / crosshairFadeMs;
        if (ratio >= 1) {
          state.zoomCrossFadeMs = 0;
          state.zoomCrossEl.visible = false;
          return;
        }
        (state.zoomCrossEl.material as THREE.MeshBasicMaterial).opacity = 1 - ratio;
        w.r3f?.invalidate();
      },
      /**
       * A `canonical` zoom-in's pan, tilt and height are FUNCTIONS of the zoom's progress, so they
       * arrive exactly when it does and a reversal walks them back. Measured against
       * `zoomPanDoneAlpha`, where we let go, so none of them is left a few percent short
       */
      advanceZoomPan(spherical) {
        const { controls, zoomPan } = state;
        if (zoomPan === null) return;
        const alpha = clamp01((controls.zoomProgress - zoomPan.fromProgress) / (1 - zoomPan.fromProgress));
        const beta = Math.min(1, alpha / zoomPanDoneAlpha);

        const rest = 1 - zoomPan.lastBeta;
        if (state.getFollowGoal(tmpGoal) === true) {
          // following, the aim IS the player, so it goes where they go — and the follow's own move
          // of the target this tick is neither a turn nor a pan, and is simply overwritten below
          zoomPan.to.set(tmpGoal.x, 0, tmpGoal.z);
          state.setCrosshair(zoomPan.to);
        } else if (spherical.theta !== zoomPan.lastTheta) {
          // a TURN slid the rig about its pivot — the crosshair, usually — but `to` is a point on
          // the ground and stays put, so the path is redrawn from wherever the turn left the target
          // as of the progress it had made: the remaining way still ends on the crosshair. Arrived,
          // `from` no longer matters
          if (rest > 1e-3) {
            zoomPan.from.copy(controls.target).addScaledVector(zoomPan.to, -zoomPan.lastBeta).divideScalar(rest);
          }
        } else {
          // whatever else moved the target is the user panning: carried into both ends, so a
          // drag mid-flight steers where the zoom is going rather than being overwritten
          tmpDrift.copy(controls.target).sub(zoomPan.lastTarget);
          if (tmpDrift.lengthSq() > 0) {
            zoomPan.from.add(tmpDrift);
            zoomPan.to.add(tmpDrift);
            state.setCrosshair(zoomPan.to);
          }
        }
        zoomPan.lastTheta = spherical.theta;
        zoomPan.lastBeta = beta;

        controls.target.copy(zoomPan.from).lerp(zoomPan.to, beta);
        // pinned, so the zoom's own flattening cannot fight the tilt whilst the pan owns it
        const phi = zoomPan.fromPolar + (zoomPan.toPolar - zoomPan.fromPolar) * beta;
        state.pinPolar(phi);
        state.placeCamera(spherical, phi);
        zoomPan.lastTarget.copy(controls.target); // anything else moving it is a pan, see above

        // `canonicalPolar` is left alone throughout: the pan only ever travels TO it, whether it
        // arrives or is zoomed back out of, and it is what the next way in returns to
        if (alpha < zoomPanDoneAlpha) {
          if (controls.zoomProgress > zoomPan.fromProgress) {
            return void w.r3f?.invalidate(); // still on its way
          }
          state.zoomInSlow = false; // zoomed back out: let go where it began
        }
        // arrived — the zoom's tail is not worth holding the view unsteerable for — or back out
        state.zoomPan = null;
        state.zoomCrossFadeMs = performance.now();
      },
      /**
       * The outer zoom stop is the nearest radius that still shows both the player and their
       * frontier, with `frontierMargin` to spare — the view held between them by `followPlayer`
       * — up to the persisted stop, so open floor is seen from as far as ever and a wall ahead is
       * seen from close. Eased, since the frontier jumps as they turn past a doorway, and eased
       * BACK to the persisted stops whenever the view is not on the player — no player, or not
       * following nor holding — since then the framing is of nothing in view, and a free look is
       * as high as ever. `update` re-derives the radius from the stops each frame, so moving the
       * stop is all that moving the camera takes
       */
      easeFrontier() {
        const { controls } = state;
        const min = state.ctrlOpts.minDistance ?? 10;
        const outer = state.ctrlOpts.maxDistance ?? defaultCameraMaxDistance;
        const player = state.getFollowedPlayer();
        let wanted = outer;
        let wantedMin = min;
        if (player !== undefined && state.playerFrontier.ahead(tmpAhead) === true) {
          // the segment's extent along each screen axis, on the ground — the camera's own x and y
          // axes, which lie flat at birdseye — and the radius at which that fits the frustum
          const camera = controls.object as THREE.PerspectiveCamera;
          const m = camera.matrixWorld.elements;
          const alongX = Math.abs(tmpAhead.x * m[0] + tmpAhead.z * m[2]);
          const alongY = Math.abs(tmpAhead.x * m[4] + tmpAhead.z * m[6]);
          const halfTan = Math.tan((camera.fov * Math.PI) / 360);
          // the view sits `frontierPanFrac` of the way along, so the far end is what must fit
          const far = Math.max(frontierPanFrac, 1 - frontierPanFrac) * frontierMargin;
          const fit = Math.max((alongX * far) / (halfTan * camera.aspect), (alongY * far) / halfTan);
          wanted = Math.min(outer, Math.max(min + (outer - min) * frontierNearFrac, fit));
          // and zoomed in, the same fit draws the INNER stop in — only ever nearer than persisted,
          // so open floor is seen from the usual distance and a wall ahead from closer still
          wantedMin = Math.min(min, Math.max(frontierNearest, fit));
        }

        // measured in time: a demand frameloop's frame gaps vary
        const now = performance.now();
        const deltaSecs = Math.min((now - state.frontierMs) / 1000, 0.1);
        state.frontierMs = now;
        const alpha = 1 - Math.exp(-frontierRate * deltaSecs);

        const remaining = wanted - controls.maxDistance;
        const remainingMin = wantedMin - controls.minDistance;
        if (Math.abs(remaining) < frontierSettleUntil && Math.abs(remainingMin) < frontierSettleUntil) {
          controls.maxDistance = wanted;
          controls.minDistance = wantedMin;
          return;
        }
        controls.maxDistance += remaining * alpha;
        controls.minDistance += remainingMin * alpha;
        w.r3f?.invalidate(); // still on its way
      },
      /**
       * Close in the polar is the user's own and is REMEMBERED as `canonicalPolar`. Further out it
       * is a function of the zoom, eased from that tilt to birdseye and pinned, which also blocks
       * the drag's polar input — so the way back in restores exactly the tilt the way out left.
       * The azimuth is left exactly where it was: `enableRotate` stops it turning
       */
      shapeCanonicalPolar(spherical, t) {
        const { controls, ctrlOpts } = state;
        if (t <= canonicalFlattenFrom) {
          controls.minPolarAngle = ctrlOpts.minPolarAngle ?? 0;
          controls.maxPolarAngle = ctrlOpts.maxPolarAngle ?? Math.PI / 2;
          state.canonicalPolar = spherical.phi;
          return;
        }
        const u = (t - canonicalFlattenFrom) / (1 - canonicalFlattenFrom);
        const s = u * u * (3 - 2 * u);
        const phi = state.canonicalPolar * (1 - s) + canonicalBirdseyePolar * s;

        // a shift-drag may TILT up from this, to peek — as far as the close-in tilt, or
        // `canonicalPeekPolar` if that is flatter — and on release it springs back: a detent at the
        // shaped polar. The clamps are opened for the drag and the spring, and pinned again once it
        // has landed. Pinned, a drag's polar input is simply clamped away, which is how the zoom
        // keeps the polar to itself the rest of the time
        const peekTo = Math.max(phi, state.canonicalPolar, canonicalPeekPolar);
        if (controls.isRotating() === true) {
          state.canonicalTilting = true;
          controls.minPolarAngle = phi;
          controls.maxPolarAngle = peekTo;
          return;
        }
        if (state.canonicalTilting === true) {
          if (Math.abs(spherical.phi - phi) > detentSettleUntil) {
            controls.minPolarAngle = phi;
            controls.maxPolarAngle = peekTo;
            state.seedDetent("phi", phi - spherical.phi);
            return;
          }
          state.canonicalTilting = false; // landed
        }

        state.pinPolar(phi);
        // applied now rather than by the clamps next update, which would tilt a frame behind the
        // zoom driving it. Only an unsettled phi needs placing, or a next frame
        if (Math.abs(spherical.phi - phi) > phiSettledEpsilon) {
          state.placeCamera(spherical, phi);
          w.r3f?.invalidate();
        }
      },
      /** Drives the polar outright: pinning both clamps blocks the drag's polar input with it */
      pinPolar(phi) {
        state.controls.minPolarAngle = phi;
        state.controls.maxPolarAngle = phi;
      },
      /**
       * `canonical`'s azimuth is a detented compass dial: free whilst dragging, then on release it
       * advances a point per `canonicalSnapArm` turned, or springs back inside the arm. It runs at
       * EVERY zoom — out there `enableRotate` is off, so it simply holds the point we were left on
       */
      detentCanonicalAzimuth(spherical) {
        const { controls } = state;

        if (controls.pointers.length > 0) {
          if (state.canonicalDragging === false) state.canonicalPeak = 0; // a fresh drag
          state.canonicalDragging = true;
          const turning = state.getCanonicalHeading();
          if (Math.abs(turning) > Math.abs(state.canonicalPeak)) state.canonicalPeak = turning;
          return;
        }
        if (state.lookAtAnimId !== 0) return; // `lookAt` owns the camera whilst it runs

        if (state.canonicalDragging === true) {
          // ON RELEASE ONLY: measuring every frame would measure against a detent the camera is
          // still travelling to, land beyond the arm on the far side, and oscillate forever
          state.canonicalDragging = false;
          const turned = state.getCanonicalHeading();
          // turning back within the same drag is a PEEK: they went to look and thought better of
          // it, so the dial returns to where it set out from — but only within the first point:
          // past a quarter turn the dial has been turned, and turning back is steering, not a peek
          const cameBack =
            Math.abs(state.canonicalPeak) < halfPi &&
            Math.abs(state.canonicalPeak) - Math.abs(turned) > canonicalSnapCancel;
          if (cameBack === false && Math.abs(turned) > canonicalSnapArm) {
            // at least one point, else however many quarters were actually turned
            const points = Math.max(1, Math.round(Math.abs(turned) / halfPi));
            state.canonicalTheta = normalizeAngle(state.canonicalTheta + Math.sign(turned) * points * halfPi);
          }
        }

        state.seedDetent("theta", deltaAngle(spherical.theta, state.canonicalTheta));
      },
      /**
       * How far the azimuth is from its detent, measured against where the turn is HEADING rather
       * than where the camera has damped to: `update` adds `sphericalDelta.theta` in total, so
       * their sum is where it will come to rest. The damped angle lags a drag badly enough that a
       * turn back within one would barely register
       */
      getCanonicalHeading() {
        const { spherical, sphericalDelta } = state.controls;
        return deltaAngle(state.canonicalTheta, spherical.theta + sphericalDelta.theta);
      },
      /**
       * Seeds the detent's remaining turn, and asks for the frame to spend it on. `update`
       * applies `delta * damping` and decays the rest, so overwriting also swallows leftover
       * momentum — a detented dial must not coast
       */
      seedDetent(axis, remaining) {
        if (Math.abs(remaining) <= detentSettleUntil) return;
        state.controls.sphericalDelta[axis] = remaining;
        w.r3f?.invalidate();
      },
      onCreated(rootState) {
        w.threeReady = true;
        // override THREE.WebGPURenderer
        w.r3f = rootState as Omit<typeof rootState, "gl"> as typeof w.r3f;
        w.texFloor.renderer = w.texCeil.renderer = w.texObs.renderer = w.r3f.gl;
        // a new GPU context (e.g. Chrome cmd+shift+t double init) has lost their layers, which
        // live only there — three re-uploads the rest from their mirrors, these are redrawn
        if (w.floor?.drawnMapKey != null) {
          w.floor.drawAll();
          void Promise.all([w.ceil.draw(), w.obs.draw()]).then(() => w.update());
        }
        w.update();
      },
      onLookGesture(held) {
        if (state.cameraFollow === true) {
          // either press leaves the follow: looking is what it already does every frame, so a press
          // that only looked would do nothing at all
          state.setCameraFollow(false);
        } else if (held === true) {
          state.setCameraFollow(true);
        } else {
          state.holdFrontier();
        }
      },
      holdFrontier() {
        if (w.n[w.player?.key ?? ""] === undefined) return;
        // the follow's framing — the player and their frontier — without the follow: held until
        // the camera is next touched, see `onCameraStart`. A `lookAt` takes it there rather than
        // leaving it to the follow, which runs on the world tick — a paused world runs none. It
        // tracks the goal, since they walk, and the goal moves with their frontier
        state.frontierHold = true;
        state.lookAtPlayer();
      },
      onResize: debounce(() => {
        w.menu?.onResize();
        w.speech?.onResize();
      }, 100),
      onKeyDown(e) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        state.keysDown.add(e.key.toLowerCase());
        if (e.key === "Escape") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = true));
        } else if (e.key === "Enter") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = false));
        } else if (e.key === "f" || e.key === "F") {
          // the look button's gesture on a key: a held key REPEATS, which is the long press — no
          // timer of our own, and a tap never gets there. The short press waits for the release,
          // since only by then is it known not to have been a hold
          if (e.repeat === false) {
            state.fHeld = false;
          } else if (state.fHeld === false) {
            state.fHeld = true;
            state.onLookGesture(true);
          }
        } else if (fadeRoomsModeByKey[e.key] !== undefined) {
          // `1`, `2` and `3` go straight to a mode, where the button cycles round them
          if (e.repeat === false) {
            state.setFadeRoomsMode(fadeRoomsModeByKey[e.key]);
            w.menu?.update();
          }
        }
      },
      onKeyUp(e) {
        state.keysDown.delete(e.key.toLowerCase());
        if ((e.key === "f" || e.key === "F") && state.fHeld === false) {
          state.onLookGesture(false);
        }
      },
      onPointerDown(e) {
        const last = state.lastPointer;
        clearTimeout(last.longPressTimer);
        last.down.copy(getRelativePointer(e));
        last.epochMs = Date.now();
        last.longPress = false;
        last.rightPress = isRMB(e.nativeEvent);

        const modifier = e.shiftKey === true || e.ctrlKey === true || e.metaKey === true;
        state.canvas.style.cursor = modifier ? "grabbing" : "move";

        if (state.otherPointerDown(e) === true) {
          return; // a second finger is the camera being pinched or rotated, never a pick
        }

        last.longPressTimer = window.setTimeout(() => {
          last.longPress = true;
          if (state.isPointDiffDrag(last.down, last.move) === true) {
            return; // drag is not long press
          }
          state.pickObject(e);
        }, 500);
      },
      onPointerLeave(_e) {
        clearTimeout(state.lastPointer.longPressTimer);
        state.lastPointer.longPressTimer = 0;
        state.canvas.style.cursor = "";
      },
      onPointerMove(e) {
        state.lastPointer.move.copy(getRelativePointer(e));
      },
      async onPointerUp(e) {
        const last = state.lastPointer;
        clearTimeout(last.longPressTimer);
        last.longPressTimer = 0;
        state.canvas.style.cursor = "";
        e.currentTarget.focus();

        // another finger still down, or this one was never the gesture's first — the camera's, not
        // a pick. A pinch usually lifts one finger before the other, and the first of those ups
        // would otherwise pick wherever the second still rests
        if (state.otherPointerDown(e) === true || e.isPrimary === false) {
          return;
        }
        if (last.longPress === true) {
          return; // already picked
        }
        if (state.isPointDiffDrag(last.down, getRelativePointer(e)) === true) {
          return; // drag is not a pick
        }
        state.pickObject(e);
      },
      otherPointerDown(e) {
        return (state.controls?.pointers ?? []).some((p) => p.pointerId !== e.pointerId);
      },
      async pickObject(e) {
        if (w.settledMapKey !== w.mapKey) {
          return;
        }
        const { gl, scene, camera } = w.r3f;
        const renderer = gl as unknown as THREE.WebGPURenderer;

        const uv = state.computePixelUv(e.nativeEvent);

        const rt = state.pickRT;
        const rtCamera = camera;
        const size = new THREE.Vector2();
        renderer.getDrawingBufferSize(size);
        const x = Math.min(Math.floor(uv.u * size.x), size.x - 1);
        const y = Math.min(Math.floor(uv.v * size.y), size.y - 1);
        rtCamera.setViewOffset(size.x, size.y, x, y, 1, 1);

        state.objectPick.value = 1 * state.objectPickScale;
        // the npc material declares an extra output whilst bordering, so this pass needs the same
        // mrt (and `pickRT` the matching attachment count) or its pipeline won't validate
        renderer.setMRT(state.npcMaskMrt);
        renderer.setRenderTarget(rt);
        renderer.render(scene, rtCamera);
        state.objectPick.value = 0;
        renderer.setMRT(null);
        renderer.setRenderTarget(null);
        rtCamera.clearViewOffset();

        const rgba = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1);
        const picked = state.getPickedFromPixel(rgba);
        if (picked === null) return;

        const intersection = state.getRaycastIntersection(e.nativeEvent, picked);
        // console.log("picked", picked, intersection);
        if (intersection === null) return;

        const { distance, point } = intersection;
        // always take 1st -- see `pick` for execution order
        const clickId = state.clickIds.shift();

        // npc might lack gmId
        const gmRoomId = "gmId" in picked ? w.e.findRoomContaining(point, true) : null;

        const pickEvent: JshCli.PickEvent = {
          key: "picked",
          ...(clickId && { clickId: clickId.id }),
          srcWorld: w.key,
          meta: {
            ...picked,
            ...gmRoomId,
            nav: picked.type === "floor" && w.npc.getClosestPoly(point).success,
            do:
              // picked decor with meta.do string
              (picked.type === "decor" && !!w.decor.byKey[picked.decorKey]?.meta.do) ||
              // picked obstacle with meta.decorIds array
              (picked.type === "obstacle" && !!w.gms[picked.gmId].obstacles[picked.obstacleId].meta.decorIds),
          },
          gmRoomId,

          distance,
          point: point.toArray(), // better for CLI
          faceIndex: intersection.faceIndex,
          normal: intersection.normal,

          longDown: state.lastPointer.longPress,
          rightDown: state.lastPointer.rightPress,
          shiftKey: e.shiftKey,

          ...point, // can provide as point with meta
        };

        w.events.next(pickEvent);
        w.net?.forwardPick(pickEvent);
      },
      syncPickRT() {
        // `RenderTarget` attachments must match what the materials output — see `pickObject`
        const count = state.npcMaskMrt === null ? 1 : 2;
        if (state.pickRT.textures.length !== count) {
          state.pickRT.dispose();
          state.pickRT = createPickRT(count);
        }
      },
      setupDom() {
        if (veiled(w.key) === false) {
          w.rootEl.style.setProperty("--world-veil-duration", "0ms");
          w.rootEl.style.setProperty("--world-veil", "0");
        }

        const ro = new ResizeObserver(([entry]) => {
          // only trigger when visible
          entry.contentRect.width && state.onResize();
        });
        ro.observe(w.rootEl);

        const { onKeyDown, onKeyUp, onZoomWheel } = state;
        // a key released after focus has gone elsewhere never reaches `onKeyUp`
        const onBlur = () => state.keysDown.clear();
        w.rootEl.addEventListener("keydown", onKeyDown);
        w.rootEl.addEventListener("keyup", onKeyUp);
        w.rootEl.addEventListener("focusout", onBlur);
        window.addEventListener("blur", onBlur);
        // CAPTURE, so the aim is taken from the zoom progress BEFORE the controls advance it
        w.rootEl.addEventListener("wheel", onZoomWheel, { capture: true, passive: false });

        return () => {
          ro.disconnect();
          w.rootEl?.removeEventListener("keydown", onKeyDown);
          w.rootEl?.removeEventListener("keyup", onKeyUp);
          w.rootEl?.removeEventListener("focusout", onBlur);
          window.removeEventListener("blur", onBlur);
          w.rootEl?.removeEventListener("wheel", onZoomWheel, { capture: true });
        };
      },
      /**
       * With the follow option on — in EITHER mode — the view keeps the player centred: the target
       * eases onto them and the camera is carried by the same amount, so the angle and distance the
       * user chose are kept. `update` derives the spherical from `position - target`, so moving one
       * alone would swing the camera instead of travelling with it.
       *
       * Panning is off whilst it runs (see `enablePan` below), so the target is ours alone: nothing
       * else moves it, and a zoom is always towards the player.
       */
      followPlayer(deltaSecs) {
        const { controls } = state;
        const player = w.n[w.player?.key ?? ""];
        if (
          (state.cameraFollow === false && state.frontierHold === false) ||
          controls === null ||
          player === undefined
        ) {
          return;
        }
        // a `lookAt` owns the target whilst it runs, and tracks the player itself — two of us
        // writing it would fight, and the pan would never arrive
        if (state.lookAtAnimId !== 0) return;

        state.getFollowGoal(tmpGoal); // the player, or part way to their frontier — see it

        const { target } = controls;
        const dx = tmpGoal.x - target.x;
        const dz = tmpGoal.z - target.z;
        if (Math.hypot(dx, dz) < followUntil) return;

        // exponential approach, so it is frame-rate independent and has no end to overshoot
        const alpha = 1 - Math.exp(-followRate * deltaSecs);
        const moveX = dx * alpha;
        const moveZ = dz * alpha;
        target.x += moveX;
        target.z += moveZ;
        controls.object.position.x += moveX;
        controls.object.position.z += moveZ;
        w.r3f?.invalidate();
      },
      showCentreHint() {
        state.set({ centreHint: true });
      },
      setCameraFollow(cameraFollow) {
        state.frontierHold = false; // superseded either way
        state.cameraFollow = cameraFollow; // before the look, whose goal is the follow's
        // turning it on goes to the player at once rather than waiting for them to move
        if (cameraFollow === true) state.lookAtPlayer();
        store.patch({ cameraFollow });
        state.set({ cameraFollow });
        w.update(); // the look button shows it
        w.r3f?.invalidate();
      },
      setCameraMode(cameraMode) {
        if (cameraMode === "canonical") {
          state.canonicalPolar = state.controls?.spherical.phi ?? state.initial.polar;
          // entering turns you onto the nearest compass point
          state.canonicalTheta = nearestCompass(state.controls?.spherical.theta ?? state.initial.azimuthal);
        } else if (state.cameraMode === "canonical" && state.controls !== null) {
          // leaving: give the polar clamps and the zoom's own pace back — r3f leaves our direct
          // writes alone, so nothing else would
          state.controls.minPolarAngle = state.ctrlOpts.minPolarAngle ?? 0;
          state.controls.maxPolarAngle = state.ctrlOpts.maxPolarAngle ?? Math.PI / 2;
          state.controls.zoomSettleRate = defaultZoomSettleRate;
          state.controls.lockRotateAxis = true; // only `canonical` ever takes it away
          // see `easeFrontier`, which has been easing both stops
          state.controls.maxDistance = state.ctrlOpts.maxDistance ?? defaultCameraMaxDistance;
          state.controls.minDistance = state.ctrlOpts.minDistance ?? 10;
          state.zoomPan = null;
          state.zoomCrossFadeMs = 0;
          state.zoomInSlow = false;
          if (state.zoomCrossEl !== null) state.zoomCrossEl.visible = false;
        }
        store.patch({ cameraMode });
        state.set({ cameraMode });
        w.update(); // the menu shows the mode, on its label and on the look button
        w.r3f?.invalidate();
      },
      hideCentreHint() {
        state.centreHint === true && state.set({ centreHint: false });
      },
      lookAtPlayer() {
        // a `lookAt` rather than leaving it to the follow, which runs on the world tick — a paused
        // world runs none, and the move onto them would wait until it resumed. This animates on
        // its own frames, paused or not. Tracked, since they walk whilst it pans. And at the
        // follow's own GOAL — the player offset towards their frontier — rather than at them: else
        // it centres them and the follow then slides off to the goal, which reads as two motions
        const track = () => (state.getFollowGoal(tmpGoal) === true ? { x: tmpGoal.x, y: tmpGoal.z } : undefined);
        const at = track();
        if (at === undefined) return;
        void state.lookAt(at, { animate: true, height: npcConfig.dist.height, track });
      },
      async lookAt(groundPoint, opts = {}) {
        const { controls } = state;
        if (controls === null) {
          return;
        }

        cancelAnimationFrame(state.lookAtAnimId);
        const from = controls.target.clone();
        const to = new THREE.Vector3(groundPoint.x, opts.height ?? 0, groundPoint.y);

        // `update` would clamp it anyway, but then `fromRadius` and the tween would disagree
        const fromRadius = controls.spherical.radius;
        const toRadius =
          opts.radius === undefined
            ? fromRadius
            : THREE.MathUtils.clamp(opts.radius, controls.minDistance, controls.maxDistance);

        /**
         * Keeps the current orientation, moving the orbit target and (optionally) the zoom.
         * The camera must be carried along explicitly: `update` derives `spherical` from
         * `position - target`, so moving the target alone would swing the camera instead.
         * We don't call `update` ourselves — `CameraControls` does so from a `useFrame` just
         * before the render, and a second call would double its per-call damping.
         */
        const applyTarget = (alpha: number) => {
          // `track` is where the destination is NOW, so a pan onto a walking npc lands on them
          // rather than where they set off from. `from` stays put, so the lerp simply chases
          const at = opts.track?.();
          at !== undefined && to.set(at.x, opts.height ?? 0, at.y);

          controls.target.copy(from).lerp(to, alpha);
          // live `phi` and `theta`, so a tilt or turn underway still applies mid-pan
          const radius = fromRadius + (toRadius - fromRadius) * alpha;
          tmpLookAtOffset.setFromSphericalCoords(radius, controls.spherical.phi, controls.spherical.theta);
          controls.object.position.copy(controls.target).add(tmpLookAtOffset);
          w.r3f?.invalidate();
        };

        try {
          // Nothing to travel — pressing the look button whilst already on them, say. Taken as an
          // instant move rather than animated: the taper below would give it a zero duration, and
          // the first frame's `0 / 0` would lerp the target to NaN and take the camera with it
          if (opts.animate !== true || from.distanceTo(to) < lookAtUntil) {
            applyTarget(1);
            controls.update(); // no frame to wait for
            return;
          }

          // a leftover gesture would otherwise keep decaying underneath the pan
          controls.u.panOffset.set(0, 0, 0);
          controls.sphericalDelta.set(0, 0, 0);

          // Further pans take longer, so the apparent speed stays similar. The floor tapers away
          // over the last `lookAtShortUnits`, else a pan onto a player already under the crosshair
          // takes the same beat as one across the map, and reads as the view hesitating
          const distance = from.distanceTo(to);
          const durationMs =
            Math.min(lookAtMaxMs, lookAtMinMs + distance * lookAtMsPerUnit) * Math.min(1, distance / lookAtShortUnits);
          let elapsedMs = 0;
          let lastEpochMs = performance.now();

          await new Promise<void>((resolve) => {
            const step = () => {
              if (controls.pointers.length > 0) {
                return resolve(); // interacting: leave the camera where they put it
              }
              // Advanced by the frame rather than read off the clock: a hitch — a shader compiled,
              // a texture uploaded, which is exactly what the pan on load runs amongst — would
              // otherwise be a stretch of the pan nobody saw, and the camera arrives at the far
              // side of it in one step. Capped, the pan simply takes longer than it meant to
              const now = performance.now();
              elapsedMs += Math.min(now - lastEpochMs, lookAtMaxStepMs);
              lastEpochMs = now;

              const ratio = Math.min(1, elapsedMs / Math.max(1, durationMs));
              // smootherstep: unlike smoothstep its acceleration is zero at both ends too
              applyTarget(ratio * ratio * ratio * (ratio * (ratio * 6 - 15) + 10));
              ratio < 1 ? (state.lookAtAnimId = requestAnimationFrame(step)) : resolve();
            };
            step();
          });
        } finally {
          // `followPlayer` stands down whilst this is non-zero, so every way out must clear it
          state.lookAtAnimId = 0;
          // else the next frame's settle would pull the view off the radius just reached
          controls.setZoomFromRadius(controls.spherical.radius);
        }
      },
      dimBackground(darken, durationMs = bgDimMs) {
        w.rootEl?.style.setProperty("--world-dim-duration", `${durationMs}ms`);
        w.rootEl?.style.setProperty("--world-dim", `${darken ? 1 : 0}`);
        return pause(durationMs);
      },
      veilCanvas(opaque, durationMs = veilMs) {
        setVeiled(w.key, opaque); // so a fresh root element can be given it back — see `setupDom`
        w.rootEl?.style.setProperty("--world-veil-duration", `${durationMs}ms`);
        w.rootEl?.style.setProperty("--world-veil", `${opaque ? 1 : 0}`);
        return pause(durationMs);
      },
      resetCamera() {
        const initial = defaultInitialCamera();
        state.initial = initial;
        state.canonicalPolar = initial.polar; // else a reset zoomed out keeps the old tilt
        store.patch({ cameraInitial: initial });
        if (state.controls) {
          state.controls.target.set(initial.position.x, 0, initial.position.z);
          const delta = new THREE.Vector3().setFromSphericalCoords(
            initial.position.y,
            initial.polar,
            initial.azimuthal,
          );
          state.controls.object.position.copy(state.controls.target).add(delta);
          state.controls.setZoomFromRadius(initial.position.y, true);
          state.controls.update();
          w.r3f?.invalidate();
        }
      },
      setFadeRoomsMode(next = nextFadeRoomsMode(state.fadeRoomsMode)) {
        state.fadeRoomsMode = next;
        store.patch({ fadeRoomsMode: next });
        state.setFadeRoomsActive(next);
        // the rooms fade INTO the post pass's backdrop, so asking for them asks for the pass too
        next !== "qa" && state.postProcessing === false ? state.setPostProcessingEnabled(true) : state.forceUpdate();
        w.menu?.update();
      },
      setFadeRoomsActive(mode) {
        // Not `setFadeRoomsMode`, which would persist the answer — this is also how the intro holds
        // the fade off whilst the world arrives, which is a beat rather than a setting.
        // Either way it SYNCS: going back to `qa` sends every room towards fully shown, which is a
        // fade of its own rather than a snap
        state.fadeRoomsFx.mode = mode;
        state.fadeRoomsFx.sync(w);
      },
      setNpcOutlineEnabled(next = !state.npcOutline) {
        state.npcOutline = next;
        store.patch({ npcOutline: next });
        // it is drawn by the post pass, so asking for it asks for that pass as well
        next === true && state.postProcessing === false ? state.setPostProcessingEnabled(true) : state.forceUpdate();
      },
      setPostProcessingEnabled(next = !state.postProcessing) {
        state.postProcessing = next;
        store.patch({ postProcessing: next });
        state.forceUpdate();
      },
      setRgbShiftEnabled(next = !state.rgbShift) {
        state.rgbShift = next;
        store.patch({ rgbShift: next });
        state.forceUpdate();
        // rebuilding the pipeline is `PostProcessing`'s job — this is one of its deps, so it has
        // to be re-rendered for the change to be noticed. It only exists whilst the post pass does,
        // so with that off the choice simply waits
        state.update();
        w.menu?.update();
      },
      setLitNpcsEnabled(next = state.litNpcsEnabled.value !== 1) {
        state.litNpcsEnabled.value = next === true ? 1 : 0;
        store.patch({ litNpcsEnabled: next });
        w.e.syncFadeRooms();
        w.menu?.update();
      },
      setupPostProcessing() {
        const { gl, scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);

        // the silhouette the npc borders grow from, declared only whilst they are wanted — off, no
        // npc shader writes it. Shared with the pick pass, so both compile the same variant
        state.npcMaskMrt = state.npcOutline === true ? createNpcMaskMrt() : null;
        state.npcMaskMrt !== null && scenePass.setMRT(state.npcMaskMrt);
        state.syncPickRT();
        w.npc?.syncOutlineMask();
        w.roomLabels?.syncOutlineMask();

        const pipeline = new THREE.RenderPipeline(gl);
        // the pass paints what lies beyond the world, which the MODE decides — see its `beyond`
        const composed = state.postFx.apply(scenePass.getTextureNode("output"), state.fadeRoomsFx.prodNode);
        // then the npc borders over the finished frame — see `service/npc-outline`
        const bordered =
          state.npcMaskMrt === null
            ? composed
            : applyNpcOutline(composed, scenePass.getTextureNode("npcMask"), scenePass.getTextureNode("depth"));
        pipeline.outputNode = state.rgbShiftFx.apply(bordered, state.rgbShift);

        const originalRender = gl.render.bind(gl);
        let inPipeline = false;
        gl.render = (s: THREE.Scene, c: THREE.Camera) => {
          if (!inPipeline && gl.getRenderTarget() === null) {
            inPipeline = true;
            pipeline.render();
            inPipeline = false;
          } else {
            originalRender(s, c);
          }
        };
        w.isReady() && state.forceUpdate();

        return () => {
          gl.render = originalRender;
          pipeline.dispose();
          state.npcMaskMrt = null;
          state.syncPickRT();
          w.npc?.syncOutlineMask();
          w.roomLabels?.syncOutlineMask();
          state.forceUpdate();
        };
      },
      syncRenderMode() {
        if (w.disabled === true) {
          w.r3f?.set({ frameloop: "demand" });
          return "demand";
        } else {
          w.r3f?.set({ frameloop: "always" });
          return "always";
        }
      },
      withPickOutput(typeId, forceAlpha) {
        const idx = float(instanceIndex);
        const pickVec = vec4(
          float(typeId).div(255),
          idx.div(256).floor().div(255),
          idx.mod(256).div(255),
          forceAlpha ?? output.a,
        );
        // 🔔 SelectAnyType fixes horrible: Expression produces a union type that is too complex to represent.
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output);
      },
      withPickOutputId(typeId, idUniform) {
        const idx = float(idUniform);
        const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output);
      },
    }),
    {
      reset: {
        ctrlOpts: true,
        /**
         * ℹ️ can set items below true whilst editing respective systems
         */
        initial: false,
        rgbShiftFx: true,
        fadeRoomsFx: false,
        playerFrontier: false,
        playerLight: false, // 🔔 `true` causes decor rebuild on hmr
        postFx: false,
      },
    },
  );

  w.view = state;

  useEffect(() => w.rootEl && state.setupDom(), [w.rootEl]);

  // the rooms are read off whatever map is up now, and arrived at rather than faded to
  useEffect(() => {
    if (w.gms.length === 0) return;
    state.fadeRoomsFx.snapNext = true;
    state.fadeRoomsFx.sync(w);
  }, [w.gmsHash]);

  const [ref, bounds] = useMeasure({ offsetSize: true }); // integers, as for the canvas below
  state.bounds = bounds;

  return (
    <div className="size-full" ref={ref}>
      <Canvas
        className={props.className}
        // the page behind the canvas keeps the theme's own colour whatever the ambient is — see
        // `World`'s className. Dimming it with the world made the stripes vanish at ambient 0
        style={{ filter: `brightness(${w.brightness})` }}
        ref={state.ref("canvas")}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerCancel={state.onPointerLeave}
        onPointerDown={state.onPointerDown}
        onPointerLeave={state.onPointerLeave}
        onPointerMove={state.onPointerMove}
        onPointerUp={state.onPointerUp}
        dpr={getPixelRatio()}
        // `offsetSize`: measures with integers avoids rebuilding render target (`RenderTarget.setSize`),
        // which makes the doors flicker, their see-through being a fraction of the MSAA samples
        resize={{ debounce: 0, offsetSize: true }}
        flat // 🔔 hopefully fix sporadic colorspace issues on refresh
        tabIndex={0}
      >
        <Stats
          showPanel={0}
          className={cn(w.disabled && "pointer-events-none grayscale-100", "absolute! z-0! left-[unset]! right-0")}
          parent={{ current: w.rootEl }}
        />

        <PerspectiveCamera fov={getCameraFov(bounds.width / bounds.height)} makeDefault zoom={1} />

        <CameraControls
          ref={state.ref("controls")}
          fixedPolar={false}
          // whilst following, the target IS the player, so a zoom about it keeps them centred.
          // Aiming at the pointer instead moves the target, which the follow would only undo —
          // and a pan would do the same, so it is simply off for the duration
          // `canonical` pans onto the cursor point instead, which owns `target` — see `zoomPan`
          zoomToCursor={state.cameraMode === "free" && state.cameraFollow === false}
          // a turn goes about the zoom crosshair whilst it shows: what the zoom is heading for
          // stays put. Otherwise, and whilst following, about `target`
          rotateAbout={state.getCrosshairPivot}
          enablePan={state.cameraFollow === false}
          domElement={state.canvas}
          initialAzimuthal={state.initial.azimuthal}
          initialPolar={state.initial.polar}
          initialPosition={state.initial.position}
          minPanDistance={w.touchDevice ? 0.05 : 0}
          // a pinch zooms continuously and keeps whatever distance it is let go at. The wheel has
          // no such gesture, and keeps the two stops
          freeZoom={w.touchDevice}
          onStart={state.onCameraStart}
          onEnd={state.onCameraEnd}
          onFrame={state.onCameraFrame}
          {...state.ctrlOpts}
        />

        <LightSweep />

        <CrossHair />

        <NpcBubbles />

        {state.postProcessing && <PostProcessing />}

        {props.children}
      </Canvas>

      {/* initial pan-to-player option */}
      <AnimatePresence>
        {state.centreHint === true && (
          <motion.button
            type="button"
            className="cursor-pointer absolute inset-0 m-auto grid size-12 place-items-center rounded-full"
            initial={{ opacity: 0, scale: centreHintSmall }}
            animate={{ opacity: [0, 1, 1, 1, 0], scale: [centreHintSmall, 1.08, 1, 1, centreHintSmall] }}
            transition={{ duration: centreHintSecs, times: [0, 0.12, 0.22, 0.6, 1], ease: "linear" }}
            onAnimationComplete={state.hideCentreHint}
            onClick={() => {
              state.hideCentreHint();
              void w.player?.panTo();
            }}
          >
            {/* who the offer is about, rather than what pressing it does */}
            <PersonSimpleCircleIcon className="size-12 text-[#ddf]/40" weight="duotone" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* sci-fi camera corners */}
      <div className="pointer-events-none absolute inset-0 text-white/30 *:absolute *:size-4">
        <div className="top-1 left-1 border-t border-l border-current" />
        <div className="top-1 right-1 border-t border-r border-current" />
        <div className="bottom-1 left-1 border-b border-l border-current" />
        <div className="right-1 bottom-1 border-r border-b border-current" />
      </div>

      {/* fade between maps */}
      <div className="world-veil" />

      {/* paused indicator, which is also how you resume: the menu's play button is a long way from
          where the eye is whilst playing, and the world's own centre is not */}
      <button
        type="button"
        title="resume"
        onClick={() => w.setDisabled(false)}
        onWheel={state.forwardWheel}
        className={cn(
          indicatorClassName,
          "top-[40%] transition-opacity duration-500",
          // it stays mounted for the fade out, so it must stop taking clicks the moment it is not
          // paused — else an invisible button sits over the middle of a running world
          w.disabled === true
            ? "cursor-pointer opacity-100 hover:bg-black/30 hover:text-yellow-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <PlayIcon className="size-4 shrink-0" weight="fill" />
        paused
      </button>

      {/* busy indicator: something heavy is running e.g. a shader recompile — see `runBusy`.
          Informative only, so it takes no pointer events */}
      <AnimatePresence>
        {state.busy !== null && (
          <motion.div
            className={cn(indicatorClassName, "pointer-events-none top-6")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="size-3 shrink-0 rounded-full border-2 border-current border-b-transparent animate-spin" />
            {state.busy}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type State = {
  bounds: Geom.RectJson;
  cameraMode: CameraModeType;
  /** Whether the view keeps the player centred — an option of EITHER mode */
  cameraFollow: boolean;
  /** `canonical`'s polar close in: what a zoom-out flattens FROM and a zoom-in returns TO */
  canonicalPolar: number;
  /** The compass point (multiple of π/2) `canonical`'s azimuth is currently detented at */
  canonicalTheta: number;
  /** Whether a drag is underway — the detent is decided on its release, once */
  canonicalDragging: boolean;
  /** Whether a zoomed-out peek is tilting the polar, or springing back from one — see `shapeCanonicalPolar` */
  canonicalTilting: boolean;
  /** The furthest this drag has turned from its detent, signed — see `canonicalSnapCancel` */
  canonicalPeak: number;
  /** The pan a `canonical` zoom-in is carrying out, keyed to the zoom's progress */
  zoomPan: null | {
    from: THREE.Vector3;
    to: THREE.Vector3;
    /** The target as WE last left it — anything else that moved it is the user panning */
    lastTarget: THREE.Vector3;
    /** The azimuth as of the last frame — a change is a turn, which slid the target about a pivot */
    lastTheta: number;
    /** How far along the pan was as of the last frame — see `advanceZoomPan` */
    lastBeta: number;
    fromProgress: number;
    fromPolar: number;
    /** The tilt to arrive at — `canonicalPolar`, as it stood when the zoom was aimed */
    toPolar: number;
  };
  /** Marks where a `canonical` zoom-in is heading */
  zoomCrossEl: null | THREE.Mesh;
  /** The crosshair's point whilst it shows, for a turn to go about — see `rotateAbout` */
  getCrosshairPivot(): THREE.Vector3 | null;
  /** The player, whilst the view follows them — or a look press holds it on them — and they exist */
  getFollowedPlayer(): Npc | undefined;
  /** Where the follow holds the target, into `out` — `false`, and untouched, whilst not following */
  getFollowGoal(out: { x: number; z: number }): boolean;
  /** When the crosshair began fading out, or `0` whilst it is not */
  zoomCrossFadeMs: number;
  /** Whether an aimed zoom-in is still running, so its slower settle is kept to the end */
  zoomInSlow: boolean;
  canvas: HTMLCanvasElement;
  clickIds: { id: string; blocking: boolean }[];
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps;
  /** Avoid HMR veil */
  initial: { azimuthal: number; polar: number; position: { x: number; y: number; z: number } };
  /** Latest camera reading, updated every frame by `onCameraChange` — persisted by `onCameraEnd` */
  lastPointer: {
    epochMs: number;
    longPress: boolean;
    longPressTimer: number;
    move: Geom.Vect;
    down: Geom.Vect;
    rightPress: boolean;
  };
  pickRT: THREE.RenderTarget;
  /** Non-null whilst the npc borders run, when npc materials write an extra `npcMask` output */
  npcMaskMrt: null | NpcMaskMrt;
  /** What the busy overlay says, or `null` whilst nothing heavy is running — see `runBusy` */
  busy: null | string;
  /** Keeps `pickRT`'s attachment count in step with `npcMaskMrt` */
  syncPickRT(): void;
  raycaster: THREE.Raycaster;
  objectPick: THREE.UniformNode<"float", number>;
  /** What the player can see, swept on the GPU — every material tints itself by it */
  playerLight: PlayerLight;
  /** How far the player can see ahead — see `service/player-frontier` */
  playerFrontier: PlayerFrontier;
  /** When `easeFrontier` last ran, so its ease is measured in time */
  frontierMs: number;
  /** Whether a short look press is holding the view on the player and their frontier, not following */
  frontierHold: boolean;
  /** The keys held down over the world, lowercased — `wasd_delta` reads them */
  keysDown: Set<string>;
  /** Frames the player and their frontier, as the follow would, until the camera is next touched */
  holdFrontier(): void;
  /** Draws `canonical`'s zoom stops in by how little the player sees ahead — see within */
  easeFrontier(): void;
  /** What the post pass does to the finished frame — see `service/post-processing` */
  postFx: PostProcessingType;
  /** Hung off the end of it — see `service/rgb-shift` */
  rgbShiftFx: RgbShiftFx;
  /** Which rooms the world is shown in — see `service/fade-rooms` */
  fadeRoomsFx: FadeRooms;
  /** Which room every part of the world stands in — see `service/room-slots` */
  roomSlots: RoomSlots;
  /**
   * `1` whilst doors take part in picking, `0` whilst they discard themselves out of it — the
   * shader's side of `Debug`'s `pickDoors`, which owns the setting and persists it
   */
  pickDoors: THREE.UniformNode<"float", number>;
  /** `0` (force off), `0.5` (when on ignore walls), `1` (when on pick walls too) */
  objectPickScale: 0 | 0.5 | 1;
  postProcessing: boolean;
  /** Whether the post pass borders the npcs — see `service/npc-outline` */
  npcOutline: boolean;
  /** Whether `rgbShiftFx` runs */
  rgbShift: boolean;
  /** How much of the world is shown by ROOM — see `service/fade-rooms` */
  fadeRoomsMode: FadeRoomsMode;
  /** Whether the rooms in view are outlined over the finished frame */
  /** Whether being lit shows at all — the shader's side of it, and `service/fade-rooms`' */
  litNpcsEnabled: THREE.UniformNode<"float", number>;
  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceUpdate(delta?: number): void;
  /** Hands an overlay's wheel event to the canvas, so the camera still zooms beneath it */
  forwardWheel(e: React.WheelEvent): void;
  /**
   * Runs `task` behind an overlay saying `text`, e.g. a toggle whose shader recompile would
   * otherwise freeze the world unannounced (noticeable on mobile). Pointer events still go through
   */
  runBusy(text: string, task: () => void): Promise<void>;
  /** Whether a pointer OTHER than `e`'s is down, i.e. the gesture belongs to the camera */
  otherPointerDown(e: React.PointerEvent<HTMLDivElement>): boolean;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  /** Whether the `f` key has been held long enough to have done its long press */
  fHeld: boolean;
  /**
   * The look BUTTON's gesture and `f`'s alike, so the two cannot drift apart: a press looks, a hold
   * takes up the follow, and whilst following either one leaves it. See `WorldMenu`'s look button
   */
  onLookGesture(held: boolean): void;
  /** Pans onto the player, following them as they walk — what turning `follow` on does */
  lookAtPlayer(): void;
  onResize(): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerLeave(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(rgba: THREE.TypedArray | [number, number, number, number]): Picked | null;
  /** Where on the frame a pointer landed */
  computePixelUv: (e: PointerEvent) => { u: number; v: number };
  getRaycastIntersection: (e: PointerEvent, picked: Picked) => null | THREE.Intersection;
  isPointDiffDrag(pointA: Geom.VectJson, pointB: Geom.VectJson): boolean;
  /** Persists `lastCameraReading` — wired to `<CameraControls onEnd>`, fires on real interaction end */
  /** The camera has been touched: a drag, a pinch or the wheel */
  onCameraStart(): void;
  onCameraEnd(): void;
  /** Per rendered frame — in `canonical` mode drives the polar, the detent and any aimed zoom */
  onCameraFrame(spherical: THREE.Spherical): void;
  /** The crosshair's fade-out, once whatever raised it has arrived */
  fadeCrosshair(): void;
  /** Carries a `canonical` zoom-in's pan, tilt and height along with the zoom's progress */
  advanceZoomPan(spherical: THREE.Spherical): void;
  /** `canonical`'s polar: the user's own close in, a function of the zoom further out */
  shapeCanonicalPolar(spherical: THREE.Spherical, t: number): void;
  /** Drives the polar outright: pinning both clamps blocks the drag's polar input with it */
  pinPolar(phi: number): void;
  /** `canonical`'s azimuth as a detented compass dial — see `canonicalSnapArm` */
  detentCanonicalAzimuth(spherical: THREE.Spherical): void;
  /** How far the azimuth is from its detent, where the turn is HEADING rather than damped to */
  getCanonicalHeading(): number;
  /** Seeds a detent's remaining turn or tilt, and asks for the frame to spend it on */
  seedDetent(axis: "theta" | "phi", remaining: number): void;
  /** Puts the crosshair on a ground point and shows it at full strength */
  setCrosshair(at: THREE.Vector3): void;
  /** Rebuilds the camera about `target` at `phi` and re-aims it */
  placeCamera(spherical: THREE.Spherical, phi: number): void;
  /** Aims a `canonical` zoom-in at the cursor's ground point */
  onZoomWheel(e: WheelEvent): void;
  /** Debounced resize + key events */
  setupDom(): () => void;
  setCameraFollow(cameraFollow: boolean): void;
  setCameraMode(cameraMode: CameraModeType): void;
  /** Keeps the player centred whilst `cameraFollow` is on — called every tick from `World` */
  followPlayer(deltaSecs: number): void;
  /** Where the follow sits relative to the player, in world XZ — a pan is what sets it */
  /** Whether the "centre on the player" UI is shown */
  centreHint: boolean;
  /** What two fingers do; one finger always pans */
  /** Restores `initial` to its default and immediately re-applies it to the live camera/controls */
  /**
   * Moves the camera's orbit target onto `groundPoint`, preserving its orientation.
   * Resolves on arrival. Zoom is preserved unless `radius` is given, which is tweened alongside.
   */
  lookAt(
    groundPoint: Geom.VectJson,
    opts?: {
      animate?: boolean;
      radius?: number;
      height?: number;
      /** Where it is NOW, re-read each frame, for a destination that moves */
      track?: () => undefined | Geom.VectJson;
    },
  ): Promise<void>;
  /** Takes the centre offer down, whether it was taken or simply ran out */
  hideCentreHint(): void;
  /** Puts the centre offer up, for as long as it takes to fade */
  showCentreHint(): void;
  /** Non-zero whilst `lookAt` is animating */
  lookAtAnimId: number;
  /** `0` the world is folded flat, `1` full height — for anything that folds in its shader */
  foldNode: THREE.UniformNode<"float", number>;
  /** How much of the room labels is shown — the first boot holds them back, see `revealRoomLabels` */
  labelReveal: THREE.UniformNode<"float", number>;
  labelRevealAnimId: number;
  /** Fade the room labels to `to` over `ms`, after waiting `delayMs` */
  revealRoomLabels(to: number, ms?: number, delayMs?: number): void;
  /** How much of a label the ZOOM leaves: `1` from `roomLabelFadeBy` out, `roomLabelNearAlpha` in */
  labelZoomFade: THREE.UniformNode<"float", number>;
  /** Takes the page background to black and back, whilst a map loads */
  dimBackground(darken: boolean, durationMs?: number): Promise<void>;
  /** Black over the canvas contents, hiding a floor swap — see `world.css` */
  veilCanvas(opaque: boolean, durationMs?: number): Promise<void>;
  resetCamera(): void;
  syncRenderMode(): RootState["frameloop"];
  /**
   * TSL node for `outputNode`: when state.objectPick==1, outputs raw unlit pick color;
   * otherwise passes through the standard lit `output`.
   *
   * We include `colorScale` here because scaling colorNode on
   * transparent material broke picking.
   */
  withPickOutput(typeId: number, forceAlpha?: number): THREE.Node;
  /** Like `withPickOutput` but uses a uniform instead of `instanceIndex` (for non-instanced meshes). */
  withPickOutputId(typeId: number, idUniform: THREE.Node<"float">): THREE.Node;
  setPostProcessingEnabled(next?: boolean): void;
  /** Borders the npcs, turning the post pass itself on if it is off */
  setNpcOutlineEnabled(next?: boolean): void;
  /** Whether the rgb shift runs after the post pass — takes hold whenever that pass is on */
  setRgbShiftEnabled(next?: boolean): void;
  /** How much of the world is shown by room, cycling round when asked for no mode in particular */
  setFadeRoomsMode(next?: FadeRoomsMode): void;
  /** Puts the world into `mode` WITHOUT persisting it — see within */
  setFadeRoomsActive(mode: FadeRoomsMode): void;
  /** Puts the circular fade on or off, which showing by room turns off whilst it is on */
  setupPostProcessing(): () => void;
  /** Whether being lit shows at all — see `setNpcLit` */
  setLitNpcsEnabled(next?: boolean): void;
};

/**
 * `fov` is vertical, so a short wide viewport derives an ever wider horizontal one — 91° at
 * 16:9 but 127° at 3.5:1, where the edges smear. Keep `cameraFov` up to `cameraRefAspect`,
 * then hold the horizontal angle that implies and close the vertical instead.
 */
function getCameraFov(aspect: number) {
  // `false` for the NaN of an unmeasured element, leaving the fov alone
  if (!(aspect > cameraRefAspect)) return cameraFov;
  const halfTan = Math.tan(cameraFov * 0.5 * THREE.MathUtils.DEG2RAD);
  return 2 * Math.atan((halfTan * cameraRefAspect) / aspect) * THREE.MathUtils.RAD2DEG;
}

/** Mirrors r3f's default `dpr={[1, 2]}` i.e. `calculateDpr` */
function getPixelRatio() {
  return Math.min(Math.max(1, window.devicePixelRatio), 2);
}

/** How quickly the follow camera closes on the player, and how near counts as arrived */
const followRate = 6;
const followUntil = 0.01;
/** Near enough the outer stop it is easing to that it simply lands there */
const frontierSettleUntil = 0.001;

/**
 * An animated `lookAt` lasts `lookAtMinMs + distance * lookAtMsPerUnit`, capped — and scaled down
 * within `lookAtShortUnits` of its destination, so a short hop is not held to the full floor
 */
const lookAtMinMs = 700;
const lookAtShortUnits = 2.5;
/** Below this much to travel (metres) a `lookAt` simply arrives, rather than animating */
const lookAtUntil = 0.01;
const lookAtMsPerUnit = 60;
/** The most a single frame may advance a pan, so a stall is a slow pan rather than a jump */
const lookAtMaxStepMs = 50;
const lookAtMaxMs = 2500;
/** How long the background takes to go black, or to come back */
const bgDimMs = 300;

/** How long the veil over the canvas takes to fade, either way */
const veilMs = 250;
/** How long the offer to centre on the player is up for, fade and all, and how small it starts */
/** Shared by the paused and busy indicators, which only differ in where they sit */
const indicatorClassName = cn(
  "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 select-none",
  "flex items-center gap-3 bg-black/20 rounded px-5 py-2",
  "font-mono text-yellow-200/80 text-xs uppercase tracking-[0.4em]",
);
const centreHintSecs = 4;
const centreHintSmall = 0.6;
/** The least time the busy overlay is shown for, so a quick task does not flicker it */
const busyMinMs = 2000;

/**
 * Whether this world's canvas is veiled — per `worldKey`, since each instance veils its own canvas.
 *
 * Kept in `world-flags` rather than in the state: an hmr can recreate the state AND the root
 * element together, and a plain field would come back `true` — veiled, with nothing left to lift
 * it. The flag resets with the pane (see `clearWorldFlags` in `World`) and on a full reload,
 * which is right, since both genuinely do start behind the veil
 */
function veiled(worldKey: string): boolean {
  return getWorldFlag("unveiled", worldKey) === false;
}
function setVeiled(worldKey: string, next: boolean): void {
  setWorldFlag("unveiled", worldKey, next === false);
}

/** The intro pans from here to the player, via `w.player.panToPlayer` */
/**
 * `MRTNode` maps its entries onto attachments by texture *name* (see `getTextureIndex`), which
 * `PassNode` sets for us but a hand-made target does not — leave them unnamed and the pick colour
 * never reaches attachment 0.
 */
function createPickRT(count: 1 | 2) {
  const renderTarget = new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat, count });
  renderTarget.textures[0].name = "output";
  if (renderTarget.textures[1] !== undefined) {
    renderTarget.textures[1].name = "npcMask";
  }
  return renderTarget;
}

function defaultInitialCamera(): State["initial"] {
  return {
    azimuthal: 0,
    polar: Math.PI / 4,
    // the far stop of `ctrlOpts`, touch and desktop alike
    position: { x: 4, y: 14, z: 4 },
  };
}

/**
 * Sweeps the player's light polygon, once per rendered frame and before the render — a priority
 * under the controls' own `-1`. Its own component rather than part of the tick, which stops
 * whilst the world is paused: the view can still move then, and the light must keep up.
 */
function PostProcessing() {
  const w = useContext(WorldContext);
  // The pipeline captured the effect's node graph, so a rebooted effect needs a fresh pipeline —
  // `reset` gives us one on hmr, and the uids are how we notice. `fadeRoomsFx` too, whose mode node
  // the pass reads. `npcOutlineUid` is a MODULE constant rather than one of ours: an hmr of that
  // file re-runs this one, and `setupPostProcessing` — a function, so `useStateRef` swaps it in
  // whilst rendering — is already the new one by the time this effect looks
  useEffect(
    () => w.view.setupPostProcessing(),
    [
      w.view.postFx.uid,
      w.view.fadeRoomsFx.uid,
      w.view.rgbShiftFx.uid,
      w.view.rgbShift,
      w.view.npcOutline,
      npcOutlineUid,
    ],
  );
  // the border is measured in pixels, so it owes the zoom a scale — see `syncNpcOutlineWidth`
  useFrame(() => syncNpcOutlineWidth(w.view.controls?.zoomProgress ?? 1), -2);
  return null;
}

/** Resolves once the browser has painted what is currently pending */
function awaitPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const tmpVect = new Vect();
const tmpLookAtOffset = new THREE.Vector3();
const tmpNdc = new THREE.Vector2();
const tmpDrift = new THREE.Vector3();
/** From the player to their frontier — see `service/player-frontier` */
const tmpAhead = { x: 0, z: 0 };
/** Where the follow is holding the target — see `getFollowGoal` */
const tmpGoal = { x: 0, z: 0 };
/** The player on screen, were the target at the goal — see `getFollowGoal` */
const tmpProjected = new THREE.Vector3();
const tmpGroundHit = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** How long the crosshair takes to fade once the zoom-in has arrived */
const crosshairFadeMs = 450;

/** The zoom headroom a `canonical` zoom-in pan needs, as a fraction of the whole travel */
const zoomPanMinSpan = 0.1;
/** How much of the pan counts as arrived — the zoom's tail is not worth holding the view for */
const zoomPanDoneAlpha = 0.97;
/** Near enough the outer stop to count as fully zoomed out */
const zoomOutStopEpsilon = 0.001;
/** Near enough the polar it is easing to, so no further frame is asked for */
const phiSettledEpsilon = 0.0001;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Near enough its compass point that the detent stops turning */
const detentSettleUntil = 0.002;

const halfPi = Math.PI / 2;
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const nearestCompass = (theta: number) => normalizeAngle(Math.round(theta / halfPi) * halfPi);
/** The normal of an obstacle's top, for a pick that landed on it without hitting a face */
const up = new THREE.Vector3(0, 1, 0);

export type Picked = {
  instanceId: number;
} & (
  | { type: "floor"; floor: true; gmId: number; gmKey: string }
  | { type: "ceiling"; ceiling: true; gmId: number; gmKey: string }
  | ({ type: "door"; door: true } & ReturnType<import("./Doors").State["decodeInstanceId"]>)
  | ({ type: "wall"; wall: true } & ReturnType<import("./Walls").State["decodeInstanceId"]>)
  | ({ type: "obstacle"; obstacle: true } & ReturnType<import("./Obstacles").State["decodeInstanceId"]>)
  // static and runtime decor have same decode format
  | ({ type: "decor"; decor: true } & ReturnType<import("./Decor").State["decodeStaticInstanceId"]>)
  | ({ type: "debugPoint"; debugPoint: true } & ReturnType<import("./Debug").State["decodeDebugPointInstanceId"]>)
  // we require spawn inside room but map might change
  | ({ type: "npc"; npcKey: string } & Partial<Geomorph.GmRoomId>)
);
