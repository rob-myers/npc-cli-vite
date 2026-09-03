import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Rect, Vect } from "@npc-cli/util/geom";
import { getRelativePointer, isRMB } from "@npc-cli/util/legacy/dom";
import { pause, testNever } from "@npc-cli/util/legacy/generic";
import { PersonSimpleCircleIcon } from "@phosphor-icons/react";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState, useFrame } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import debounce from "debounce";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import useMeasure from "react-use-measure";
import { float, instanceIndex, output, pass, select, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  cameraFov,
  cameraRefAspect,
  defaultCameraModeDesktop,
  defaultCameraModeMobile,
  npcConfig,
  rotateSpeedDesktop,
  rotateSpeedMobile,
  zoomSpeedDesktop,
  zoomSpeedMobile,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { createDemoPostFx, type DemoPostFx, type DemoPostFxKey, warpCrtUv } from "../service/demo-post-process";
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
import { createPlayerLight, type PlayerLight } from "../service/player-light";
import { createPostProcessing, type PostProcessing as PostProcessingType } from "../service/post-processing";
import { createRoomSlots, type RoomSlots } from "../service/room-slots";
import { getWorldStore, type PersistedCamera } from "../service/storage";
import type { SelectAnyType } from "../service/texture";
import { getWorldFlag, setWorldFlag } from "../service/world-flags";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
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
      cameraMode: saved.cameraMode ?? (w.touchDevice ? defaultCameraModeMobile : defaultCameraModeDesktop),
      centreHint: false,
      fHeld: false,
      clickIds: [],
      controls: null as any,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: 0,
        maxPolarAngle: Math.PI / 2 - Math.PI / 8,
        // The two stops the zoom moves between — see `camera-controls`' `zoomProgress`. Touch
        // comes in closer: a phone shows far less of the world at a given distance, and its pinch
        // is free to rest anywhere between the two rather than settling on one
        minDistance: 10,
        maxDistance: 20,
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
      freezeEl: null as any,
      frozen: false,
      objectPick: uniform(0),
      playerLight: createPlayerLight(),
      postFx: createPostProcessing(),
      demoFx: createDemoPostFx(),
      fadeRoomsFx: createFadeRooms(parseFadeRoomsMode(saved.fadeRoomsMode)),
      roomSlots: createRoomSlots(),
      pickDoors: uniform(saved.pickDoors === false ? 0 : 1),
      objectPickScale: 0.5, // don't pick walls by default
      pickRT: createPickRT(1),
      npcMaskMrt: null,
      postProcessing: saved.postProcessing,
      npcOutline: saved.npcOutline,
      demoPostFx: saved.demoPostFx,
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
        // `crt` bends the frame under the pointer, so where we clicked is not what we clicked on
        return state.demoPostFx === "crt" ? warpCrtUv(u, v) : { u, v };
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
            if (npc) return { ...pick, npcKey: npc.key, ...w.e.npcToRoom.get(npc.key) };
            return null;
          }
          default:
            throw new ExhaustiveError(pick);
        }
      },
      getRaycastIntersection(e, picked) {
        let mesh: THREE.Mesh;

        const uv = state.computePixelUv(e);
        if (uv === null) {
          return null; // warped uvs needn't cover pixels
        }
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
      onCameraEnd() {
        const cameraInitial: PersistedCamera = {
          azimuthal: state.controls.spherical.theta,
          polar: state.controls.spherical.phi,
          position: { x: state.controls.target.x, y: state.controls.spherical.radius, z: state.controls.target.z },
        };
        store.patch({ cameraInitial });
      },
      onCreated(rootState) {
        w.threeReady = true;
        // override THREE.WebGPURenderer
        w.r3f = rootState as Omit<typeof rootState, "gl"> as typeof w.r3f;
        // re-upload textures on new GPU context (e.g. Chrome cmd+shift+t double init)
        w.texFloor.update();
        w.update();
      },
      onResize: debounce(() => {
        w.menu?.onResize();
        w.speech?.onResize();
      }, 100),
      onKeyDown(e) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "Escape") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = true));
        } else if (e.key === "Enter") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = false));
        } else if (e.key === "f" || e.key === "F") {
          // the TOGGLE waits for the release, so that holding the key can mean something else. A
          // held key repeats, which is the long press — no timer of our own, and a tap never gets
          // there. Held whilst following it keeps the mode and simply goes back to the player,
          // which is otherwise only reachable by leaving follow and returning to it
          if (e.repeat === false) {
            state.fHeld = false;
          } else if (state.fHeld === false) {
            state.fHeld = true;
            state.cameraMode === "follow" ? state.lookAtPlayer() : state.setCameraMode("follow");
          }
        } else if (e.key === "q" || e.key === "Q") {
          // what the look button does: pressed again once on them, `panTo` swings round behind them
          void w.player?.panTo();
        } else if (e.key === "e" || e.key === "E") {
          // the world shown by room, as the fade button does — which also turns the post pass on,
          // there being nothing to fade into otherwise
          state.setFadeRoomsMode();
          w.menu?.update();
        } else if (fadeRoomsModeByKey[e.key] !== undefined) {
          // `1`, `2` and `3` go straight to a mode, where the button and `e` cycle round them
          if (e.repeat === false) {
            state.setFadeRoomsMode(fadeRoomsModeByKey[e.key]);
            w.menu?.update();
          }
        }
      },
      onKeyUp(e) {
        if ((e.key === "f" || e.key === "F") && state.fHeld === false) {
          state.setCameraMode(state.cameraMode === "follow" ? "free" : "follow");
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
        if (uv === null) {
          return; // the `crt` bulge pushes the corners off-frame, where there is nothing to pick
        }

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

        const { onKeyDown, onKeyUp } = state;
        w.rootEl.addEventListener("keydown", onKeyDown);
        w.rootEl.addEventListener("keyup", onKeyUp);

        return () => {
          ro.disconnect();
          w.rootEl?.removeEventListener("keydown", onKeyDown);
          w.rootEl?.removeEventListener("keyup", onKeyUp);
        };
      },
      /**
       * In `follow` mode the view keeps the player centred: the target eases onto them and the
       * camera is carried by the same amount, so the angle and distance the user chose are kept —
       * `update` derives the spherical from `position - target`, so moving one alone would swing
       * the camera instead of travelling with it.
       *
       * Panning is off in this mode (see `enablePan` below), so the target is ours alone: nothing
       * else moves it, and a zoom is always towards the player.
       */
      followPlayer(deltaSecs) {
        const { controls } = state;
        const player = w.n[w.player?.key ?? ""];
        if (state.cameraMode !== "follow" || controls === null || player === undefined) return;
        // a `lookAt` owns the target whilst it runs, and tracks the player itself — two of us
        // writing it would fight, and the pan would never arrive
        if (state.lookAtAnimId !== 0) return;

        const { target } = controls;
        const dx = player.position.x - target.x;
        const dz = player.position.z - target.z;
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
      setCameraMode(cameraMode) {
        if (cameraMode === "follow") {
          state.lookAtPlayer();
        }
        store.patch({ cameraMode });
        state.set({ cameraMode });
        w.update(); // the menu shows the mode, on its label and on the look button
      },
      hideCentreHint() {
        state.centreHint === true && state.set({ centreHint: false });
      },
      lookAtPlayer() {
        const player = w.n[w.player?.key ?? ""];
        if (player === undefined) return;

        // a `lookAt` rather than leaving it to the follow, which runs on the world tick — a paused
        // world runs none, and the move onto them would wait until it resumed. This animates on
        // its own frames, paused or not. Tracked, since they walk whilst it pans
        void state.lookAt(player.point, {
          animate: true,
          height: npcConfig.dist.height,
          track: () => w.n[w.player?.key ?? ""]?.point,
        });
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
      setDemoPostFx(next) {
        state.demoPostFx = next;
        store.patch({ demoPostFx: next });
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

        const pipeline = new THREE.RenderPipeline(gl);
        // the pass paints what lies beyond the world, which the MODE decides — see its `beyond`
        const composed = state.postFx.apply(scenePass.getTextureNode("output"), state.fadeRoomsFx.prodNode);
        // then the npc borders over the finished frame — see `service/npc-outline`
        const bordered =
          state.npcMaskMrt === null
            ? composed
            : applyNpcOutline(composed, scenePass.getTextureNode("npcMask"), scenePass.getTextureNode("depth"));
        // then whatever is being tried out on top of it, which is usually nothing at all
        pipeline.outputNode = state.demoFx.apply(bordered, state.demoPostFx);

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
        demoFx: true,
        fadeRoomsFx: false,
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
          zoomToCursor={state.cameraMode !== "follow"}
          enablePan={state.cameraMode !== "follow"}
          domElement={state.canvas}
          initialAzimuthal={state.initial.azimuthal}
          initialPolar={state.initial.polar}
          initialPosition={state.initial.position}
          minPanDistance={w.touchDevice ? 0.05 : 0}
          // a pinch zooms continuously and keeps whatever distance it is let go at. The wheel has
          // no such gesture, and keeps the two stops
          freeZoom={w.touchDevice}
          onEnd={state.onCameraEnd}
          {...state.ctrlOpts}
        />

        <LightSweep />

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

      {/* paused indicator */}
      <div
        className={cn(
          "pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 select-none",
          "bg-black/30 px-4 py-1.5 font-mono text-yellow-200/80 text-xs uppercase tracking-[0.4em]",
          "transition-opacity duration-500",
          w.disabled ? "opacity-100" : "opacity-0",
        )}
      >
        paused
      </div>
    </div>
  );
}

export type State = {
  bounds: Geom.RectJson;
  cameraMode: CameraModeType;
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
  /** Keeps `pickRT`'s attachment count in step with `npcMaskMrt` */
  syncPickRT(): void;
  raycaster: THREE.Raycaster;
  objectPick: THREE.UniformNode<"float", number>;
  /** What the player can see, swept on the GPU — every material tints itself by it */
  playerLight: PlayerLight;
  /** What the post pass does to the finished frame — see `service/post-processing` */
  postFx: PostProcessingType;
  /** The shelf of effects we can hang off the end of it — see `service/demo-post-process` */
  demoFx: DemoPostFx;
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
  /** Which effect is hung off the end of the post pass, `"none"` for the pass on its own */
  demoPostFx: DemoPostFxKey;
  /** How much of the world is shown by ROOM — see `service/fade-rooms` */
  fadeRoomsMode: FadeRoomsMode;
  /** Whether the rooms in view are outlined over the finished frame */
  /** Whether being lit shows at all — the shader's side of it, and `service/fade-rooms`' */
  litNpcsEnabled: THREE.UniformNode<"float", number>;
  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceUpdate(delta?: number): void;
  /** Whether a pointer OTHER than `e`'s is down, i.e. the gesture belongs to the camera */
  otherPointerDown(e: React.PointerEvent<HTMLDivElement>): boolean;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  /** Whether the `f` key has been held long enough to have done its long press */
  fHeld: boolean;
  /** Pans onto the player, following them as they walk — what turning `follow` on does */
  lookAtPlayer(): void;
  onResize(): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerLeave(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(rgba: THREE.TypedArray | [number, number, number, number]): Picked | null;
  /** Where on the frame a pointer landed, `null` if off it — see `warpCrtUv` */
  computePixelUv: (e: PointerEvent) => null | { u: number; v: number };
  getRaycastIntersection: (e: PointerEvent, picked: Picked) => null | THREE.Intersection;
  isPointDiffDrag(pointA: Geom.VectJson, pointB: Geom.VectJson): boolean;
  /** Persists `lastCameraReading` — wired to `<CameraControls onEnd>`, fires on real interaction end */
  onCameraEnd(): void;
  /** Debounced resize + key events */
  setupDom(): () => void;
  setCameraMode(cameraMode: CameraModeType): void;
  /** Keeps the player centred whilst `cameraMode` is `follow` — called every tick from `World` */
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
  /** Takes the page background to black and back, whilst a map loads */
  dimBackground(darken: boolean, durationMs?: number): Promise<void>;
  /** Black over the canvas contents, hiding a floor swap — see `world.css` */
  veilCanvas(opaque: boolean, durationMs?: number): Promise<void>;
  freezeEl: HTMLCanvasElement;
  frozen: boolean;
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
  /** Which stock effect runs after the post pass — takes hold whenever that pass is on */
  setDemoPostFx(next: DemoPostFxKey): void;
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
/** How long the held frame takes to give way to the map beneath it */
const freezeFadeMs = 700;
/** How long the offer to centre on the player is up for, fade and all, and how small it starts */
const centreHintSecs = 4;
const centreHintSmall = 0.6;

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
function LightSweep() {
  const w = useContext(WorldContext);

  useEffect(() => {
    // the walls never move, so they are read once per map — the doors are read per frame, being
    // few and the only occluders that change
    w.gms.length > 0 && w.gmsData !== undefined && w.view.playerLight.syncWalls(w.gms, w.gmsData);
  }, [w.gmsHash, w.gmsData]);

  useFrame((root) => {
    const renderer = root.gl as unknown as THREE.WebGPURenderer;
    const player = w.n[w.player?.key ?? ""];
    w.view.playerLight.update(
      renderer,
      player?.position ?? null,
      player?.rotation.y ?? 0,
      w.d ?? emptyDoors,
      w.door?.openRatioArray ?? emptyOpenRatios,
    );
  }, -2);

  return null;
}

const emptyOpenRatios = new Float32Array(0);
const emptyDoors: Record<string, Geomorph.DoorState> = {};

function PostProcessing() {
  const w = useContext(WorldContext);
  // The pipeline captured the effect's node graph, so a rebooted effect needs a fresh pipeline —
  // `reset` gives us one on hmr, and the uids are how we notice. `fadeRoomsFx` too, whose mode node
  // the pass reads. `npcOutlineUid` is a MODULE constant rather than one of ours: an hmr of that
  // file re-runs this one, and `setupPostProcessing` — a function, so `useStateRef` swaps it in
  // whilst rendering — is already the new one by the time this effect looks
  useEffect(
    () => w.view.setupPostProcessing(),
    [w.view.postFx.uid, w.view.fadeRoomsFx.uid, w.view.demoFx.uid, w.view.demoPostFx, w.view.npcOutline, npcOutlineUid],
  );
  // the border is measured in pixels, so it owes the zoom a scale — see `syncNpcOutlineWidth`
  useFrame(() => syncNpcOutlineWidth(w.view.controls?.zoomProgress ?? 1), -2);
  return null;
}

const tmpVect = new Vect();
const _tmpRect = new Rect();
const _tmpVector3 = new THREE.Vector3();
const tmpLookAtOffset = new THREE.Vector3();
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
