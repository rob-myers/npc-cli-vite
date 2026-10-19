import { useStateRef } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { useFrame } from "@react-three/fiber";
import { ANY_QUERY_FILTER, findPath } from "navcat";
import { useContext, useEffect } from "react";
import { attribute, float, smoothstep, uniform, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { EyesKey } from "../const.both";
import { WorldContext } from "./world-context";

/**
 * The player leaves their body and wakes in another, e.g. chosen by "Become" in npc focus.
 * See `docs/spirit.md`
 */
export default function Spirit() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      phase: "idle",
      fromKey: null,
      toKey: null,
      leaving: false,
      leave: 0,
      secs: 0,
      crossSecs: 0,
      arriveSecs: 0,
      route: [],
      lengths: [],
      ends: [],
      length: 0,
      litRooms: [],
      framed: false,
      wasFollowing: false,
      viewHeight: 0,
      roomsAhead: [],
      heights: [0, 0],
      floors: [0, 0],
      light: null,
      looks: new Map(),
      trail: createTrail(w.view.objectPick),

      begin(fromKey, toKey = null) {
        Object.assign(state, { phase: "leave", fromKey, toKey, leaving: true, leave: 0, framed: false });
        w.r3f?.invalidate();
      },
      async commit() {
        state.phase = "commit";
        try {
          const toKey = state.toKey ?? (await state.findTarget());
          if (state.phase !== "commit") return; // abandoned whilst waiting, e.g. unmounted
          const from = state.fromKey === null ? undefined : w.n[state.fromKey];
          const to = toKey === null ? undefined : w.n[toKey];
          if (from === undefined || to === undefined) {
            warn("spirit: nobody sitting or lying to wake in");
            return void Object.assign(state, { phase: "leave", leaving: false });
          }
          state.toKey = to.key;
          state.shut(to.key, true);
          state.route = smoothRoute(await state.findRoute(from, to));
          if (state.phase !== "commit") return;
          state.lengths = state.route
            .slice(1)
            .map((p, i) => Math.hypot(p.x - state.route[i].x, p.y - state.route[i].y));
          let end = 0;
          state.ends = state.lengths.map((length) => (end += length));
          state.length = end;
          state.crossSecs = THREE.MathUtils.clamp(end * spiritConfig.crossSecsPerMetre, ...spiritConfig.crossSecs);
          state.heights = [foreheadOf(from).y, foreheadOf(to).y];
          state.floors = [from.position.y, to.position.y];
          state.trail.setRoute(state.route, state.lengths, state.heights);
          state.roomsAhead = state.findRoomsAlong();
          w.e.setPsi(false, from.key);
          Object.assign(state, { phase: "cross", secs: 0 });
          // the height it has, which a follow keeps: else the view drops once woken
          state.viewHeight = w.view.controls?.target.y ?? 0;
          state.tickCross(0);
        } catch (e) {
          warn("spirit:", e);
          state.restore();
        }
      },
      arrive() {
        const to = state.toKey === null ? undefined : w.n[state.toKey];
        if (to === undefined) return state.restore();
        const from = state.fromKey === null ? undefined : w.n[state.fromKey];
        if (w.e.hasItem(to.key, "psi") === false) w.e.giveItem(to.key, "psi");
        state.light = lightNear(to, 1); // where the spark landed, settling back to them as they wake
        // as `setKey`, without its pan: the crossing has already landed on them
        w.e.setNpcLit(to, false);
        w.player.assign(to.key, { pan: false });
        w.view.playerFrontier.reset();
        w.player.update();
        w.player.persist();
        // the route's rooms go now, as the player's own take over: else those out of sight linger
        state.unlightRooms();
        w.e.setPsi(true, to.key);
        // the first breath is from empty, slow and deep
        const { breath } = to.anim;
        const tune = to.anim.breathTune;
        Object.assign(breath, { phase: 0, pace: spiritConfig.firstPace, swell: spiritConfig.firstSwell });
        state.arriveSecs = (tune.inhale * 60) / (tune.rate * spiritConfig.firstPace);
        if (from !== undefined) {
          from.anim.breath.pace = 1;
          if (from.posture !== "lie") state.shut(from.key, false);
        }
        Object.assign(state, { phase: "arrive", secs: 0 });
        state.handBack(); // the view is theirs as they wake, a follow on again
      },
      async findRoute(from, to) {
        // forehead to forehead
        const { x: ax, z: ay } = foreheadOf(from);
        const a = { x: ax, y: ay };
        const { x: bx, z: by } = foreheadOf(to);
        const b = { x: bx, y: by };
        // along the navmesh's own path, keeping clear of walls, through any door
        const found = findPath(w.nav.navMesh, [ax, 0, ay], [bx, 0, by], routeHalfExtents, ANY_QUERY_FILTER);
        if (found.success === true && found.path.length >= 2) {
          const corners = found.path.slice(1, -1).map(({ position }) => ({ x: position[0], y: position[2] }));
          return [a, ...corners, b];
        }
        // else room to room through the middle of each door
        const src = w.npc.npcToRoom.get(from.key);
        const dst = w.npc.npcToRoom.get(to.key);
        if (src === undefined || dst === undefined || src.grKey === dst.grKey) return [a, b];
        const { success, path } = await w.e.findPathAsync(src.grKey, dst.grKey);
        if (success === false) return [a, b];
        const doors = path.flatMap((node) => (node.type === "door" && w.d[node.id] !== undefined ? w.d[node.id] : []));
        return [a, ...doors.map(({ src, dst }) => ({ x: (src.x + dst.x) / 2, y: (src.y + dst.y) / 2 })), b];
      },
      findRoomsAlong() {
        const rooms: State["roomsAhead"] = [];
        let [dist, probed] = [0, -Infinity];
        for (const [i, p] of state.route.entries()) {
          // every so often, not every sample: a room is metres across
          if (dist - probed >= spiritConfig.roomProbeMetres || i === state.route.length - 1) {
            probed = dist;
            const room = w.findRoomContaining(p, true);
            if (room !== null && rooms.some((x) => x.grKey === room.grKey) === false)
              rooms.push({ grKey: room.grKey, at: dist });
          }
          dist += state.lengths[i] ?? 0;
        }
        return rooms;
      },
      async findTarget() {
        const playerKey = w.player.key;
        const resting = Object.values(w.n).filter((npc) => npc.key !== playerKey && restingPostures.has(npc.posture));
        if (resting.length > 0) return pickOne(resting).key;
        // else someone new, in a free bed, else a free seat
        const free = (posture: "lie" | "sit") =>
          Object.values(w.decor.byKey).filter(
            (d): d is Geomorph.DecorPoint =>
              d.type === "point" && d.meta.do === posture && w.npc.doableToNpc[d.key] == null,
          );
        const beds = free("lie");
        const spots = beds.length > 0 ? beds : free("sit");
        if (spots.length === 0) return null;
        const spot = pickOne(spots);
        let i = 0;
        while (w.n[`${spiritConfig.sleeperKey}-${i}`] !== undefined) i++;
        const npcKey = `${spiritConfig.sleeperKey}-${i}`;
        const skins = w.npc.skin.entries;
        await w.npc.spawn({
          npcKey,
          at: { x: spot.x, y: spot.y, meta: spot.meta },
          as: skins.length === 0 ? undefined : pickOne(skins).key,
        });
        // their mesh is placed and posed by the frames after it mounts: until then their head is nowhere near them
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return npcKey;
      },
      onFrame(delta) {
        if (state.phase === "idle" || state.phase === "commit" || w.disabled === true) return;
        const dt = Math.min(delta, maxStepSecs);
        if (state.phase === "leave") state.tickLeave(dt);
        else if (state.phase === "cross") state.tickCross(dt);
        else state.tickArrive(dt);
        w.r3f.invalidate();
      },
      pointAt(dist) {
        const { route, lengths, ends } = state;
        // the first leg ending at or beyond `dist`
        let [lo, hi] = [0, ends.length - 1];
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ends[mid] < dist) lo = mid + 1;
          else hi = mid;
        }
        const [a, b] = [route[lo], route[lo + 1] ?? route[lo]];
        const length = lengths[lo] || 1;
        const s = THREE.MathUtils.clamp((dist - ends[lo]) / length + 1, 0, 1);
        tmpAt.x = a.x + s * (b.x - a.x);
        tmpAt.y = a.y + s * (b.y - a.y);
        tmpAt.dx = (b.x - a.x) / length;
        tmpAt.dy = (b.y - a.y) / length;
        tmpAt.leg = lo;
        return tmpAt;
      },
      frame(npc) {
        state.framed = true;
        // the effect owns the view until it is over
        state.wasFollowing = w.view.follow;
        if (state.wasFollowing === true) w.view.setFollow(false);
        w.view.zoomHeld = true; // without a follow the stops would ease out, taking the view with them
        const { x, y, z } = foreheadOf(npc);
        const face = faceOf(npc);
        const lain = npc.posture === "lie";
        void w.view.lookAt(
          { x, y: z },
          {
            animate: true,
            ms: spiritConfig.leaveSecs * (1 - state.leave) * 1000,
            height: w.view.controls?.target.y ?? y,
            // lain, across them from their side and low, as woken: else from the side their face is on
            theta: lain === true ? state.sideOf(npc) : face === null ? undefined : Math.atan2(face.x, face.y),
            phi: lain === true ? spiritConfig.lainPolar : undefined,
          },
        );
      },
      sideOf(npc) {
        const { x, z } = foreheadOf(npc);
        const [ux, uz] = [x - npc.position.x, z - npc.position.z];
        const length = Math.hypot(ux, uz);
        if (length === 0) return undefined;
        const from = w.view.controls?.spherical.theta ?? 0;
        const turnOf = (theta: number) => Math.abs(Math.atan2(Math.sin(theta - from), Math.cos(theta - from)));
        // either side of their body: open floor beside the bed first, then the lesser turn
        const sides = [1, -1].map((sign) => {
          const [sx, sz] = [(-uz / length) * sign, (ux / length) * sign];
          const probe = {
            x: npc.position.x + sx * spiritConfig.sideProbeMetres,
            y: npc.position.z + sz * spiritConfig.sideProbeMetres,
          };
          return { theta: Math.atan2(sx, sz), open: w.npc.getClosestPoly(probe, 0.5).success === true };
        });
        sides.sort((a, b) => Number(b.open) - Number(a.open) || turnOf(a.theta) - turnOf(b.theta));
        return sides[0].theta;
      },
      veil(reach, dark, plain = 0) {
        // `ship` keeps the whole ship legible: the light still draws in, but nothing goes to black
        w.view.playerLight.setVeil(reach, w.view.fadeRoomsMode === "ship" ? 0 : dark, plain);
      },
      unlightRooms() {
        for (const grKey of state.litRooms) w.e.setRoomLit(grKey, false);
        state.litRooms.length = 0;
      },
      followSpark() {
        void w.view.lookAt(state.route[state.route.length - 1], {
          animate: true,
          ms: Math.max(0, state.crossSecs - state.secs) * 1000,
          height: state.viewHeight,
          along: () => (state.light === null ? undefined : { x: state.light.x, y: state.light.z }),
        });
      },
      restore() {
        const from = state.fromKey === null ? undefined : w.n[state.fromKey];
        if (from !== undefined) {
          from.anim.breath.pace = 1;
          state.shut(from.key, false);
        }
        if (state.toKey !== null) state.shut(state.toKey, false); // as they were, before we chose them
        state.finish();
      },
      handBack() {
        w.view.zoomHeld = false;
        if (state.wasFollowing === true) w.view.setFollow(true);
        state.wasFollowing = false;
      },
      finish() {
        state.handBack();
        const to = state.toKey === null ? undefined : w.n[state.toKey];
        if (to !== undefined) Object.assign(to.anim.breath, { pace: 1, swell: 1 });
        Object.assign(state, { phase: "idle", fromKey: null, toKey: null, light: null, leave: 0 });
        state.looks.clear();
        state.unlightRooms();
        state.trail.hide();
        w.view.playerLight.setVeil(1, 0);
        w.r3f?.invalidate();
      },
      shut(npcKey, shut) {
        const anim = w.n[npcKey]?.anim;
        if (anim === undefined) return;
        if (shut === true && state.looks.has(npcKey) === false) {
          state.looks.set(npcKey, anim.eyes.look);
          anim.setEyes("shut");
        } else if (shut === false && state.looks.has(npcKey) === true) {
          anim.setEyes(state.looks.get(npcKey) ?? "open");
          state.looks.delete(npcKey);
        }
      },
      start(toKey) {
        if (state.phase !== "idle") throw Error("already under way");
        if (toKey !== undefined && w.n[toKey] === undefined) throw Error(`no such npc: ${toKey}`);
        if (w.player.exists() === false) throw Error("no player");
        state.begin(w.player.key, toKey ?? null);
      },
      tickArrive(dt) {
        const to = state.toKey === null ? undefined : w.n[state.toKey];
        if (to === undefined) return state.finish();
        state.secs += dt;
        const t = Math.min(1, state.secs / state.arriveSecs);
        const lit = smootherstep(t);
        state.light = t === 1 ? null : lightNear(to, 1 - lit);
        // from where the crossing left it
        state.veil(spiritConfig.crossReach + (1 - spiritConfig.crossReach) * lit, 1 - lit, 1 - lit);
        state.trail.opacity.value = Math.max(0, 1 - state.secs / spiritConfig.trailFadeSecs);
        const settled = Math.min(1, (state.secs - state.arriveSecs) / spiritConfig.settleSecs);
        const { breath } = to.anim;
        if (t === 1) breath.pace = 1;
        breath.swell = 1 + (spiritConfig.firstSwell - 1) * (1 - smootherstep(Math.max(0, settled)));
        if (t === 1 && state.looks.has(to.key) === true) {
          state.looks.delete(to.key);
          to.anim.setEyes("open");
          to.anim.blink(spiritConfig.wakeBlinks);
        }
        if (settled === 1) state.finish();
      },
      tickCross(dt) {
        state.secs += dt;
        const t = Math.min(1, state.secs / state.crossSecs);
        const { length } = state;
        const along = smootherstep(t) * length;
        const at = state.pointAt(along);
        const height = riseAt(along, length, state.heights, spiritConfig.height);
        // three's rotation-Y for a heading in world XZ, as `PlayerLight.update` undoes
        state.light = setLight(
          at.x,
          riseAt(along, length, state.floors, 0),
          at.y,
          -Math.atan2(at.dy, at.dx) - Math.PI / 2,
        );
        // a plain circle round the spark: it sees through walls and looks no way in particular
        const shown = smootherstep(Math.min(1, state.secs / spiritConfig.sparkLightSecs));
        state.veil(spiritConfig.crossReach * shown, 1, 1);
        state.trail.place(along, at, height);
        // `sight` shows only the player's rooms, so each is lit by hand before the spark gets there
        while (state.roomsAhead.length > 0 && state.roomsAhead[0].at <= along + spiritConfig.roomLeadMetres) {
          const { grKey } = state.roomsAhead.shift() as { grKey: Geomorph.GmRoomKey };
          if (w.e.handLitRooms.has(grKey) === true) continue;
          state.litRooms.push(grKey);
          w.e.setRoomLit(grKey, true);
        }
        // a pan ended early, by a drag or anything else, gives the view back to the spark once let go
        if (t < 1 && w.view.lookAtAnimId === 0 && (w.view.controls?.pointers.length ?? 0) === 0) state.followSpark();
        if (t === 1) state.arrive();
      },
      tickLeave(dt) {
        const from = state.fromKey === null ? undefined : w.n[state.fromKey];
        if (from === undefined) return state.restore();
        const { leaving } = state;
        if (leaving === false && state.leave === 0) return state.restore();
        if (leaving === true && state.framed === false) state.frame(from);
        const rate = leaving === true ? 1 / spiritConfig.leaveSecs : -1 / spiritConfig.recoverSecs;
        state.leave = THREE.MathUtils.clamp(state.leave + rate * dt, 0, 1);
        const gone = smootherstep(state.leave);
        // drawn in to their forehead, where the spark will leave from
        state.light = lightNear(from, gone);
        state.veil(1 - gone, gone);
        // a breath under way is let finish, and the pause after it drawn out
        const { breath } = from.anim;
        breath.pace = breath.phase < from.anim.breathTune.inhale ? 1 : 1 - (1 - spiritConfig.leavePace) * gone;
        state.shut(from.key, state.leave > spiritConfig.shutAt);
        if (state.leave === 1) void state.commit();
      },
    }),
    { reset: { trail: true } },
  );

  w.spirit = state;

  useFrame((_, delta) => state.onFrame(delta * w.gameTime.scale), -3);

  // unmounted or hot-reloaded part way, else the view, light and rooms are left as the effect had them
  useEffect(
    () => () => {
      if (state.phase !== "idle") state.restore();
      state.light = null;
      w.view.playerLight.setVeil(1, 0);
    },
    [],
  );

  return (
    <>
      <primitive object={state.trail.ribbon} />
      <primitive object={state.trail.spark} />
    </>
  );
}

/** The thread drawn from the body left to the one woken, and the spark at its head */
function createTrail(objectPick: THREE.UniformNode<"float", number>) {
  const head = uniform(0);
  const opacity = uniform(0);
  const color = new THREE.Color(spiritConfig.color);

  const behind = head.sub(attribute<"float">("along", "float"));
  const side = attribute<"float">("side", "float");
  const tail = float(1).sub(smoothstep(0, spiritConfig.tailMetres, behind));
  const ahead = smoothstep(-spiritConfig.headSoftMetres, 0, behind);
  const glow = tail
    .mul(tail)
    .add(spiritConfig.cordGlow)
    .mul(ahead)
    .mul(float(1).sub(side.mul(side)))
    .mul(opacity);

  const ribbonMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true, // behind obstacles: into a bottom bunk, it goes under the top
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    forceSinglePass: true, // else transparent and two-sided, it is drawn twice
  });
  ribbonMaterial.colorNode = vec3(color.r, color.g, color.b);
  // nothing in the pick pass, which its additive blend would otherwise smear
  const drawn = objectPick.equal(0).toFloat();
  ribbonMaterial.opacityNode = glow.mul(drawn);
  const ribbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial);
  Object.assign(ribbon, { visible: false, frustumCulled: false, renderOrder: 10 });

  const sparkMaterial = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  sparkMaterial.opacityNode = opacity.mul(drawn);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(spiritConfig.sparkRadius, 12, 8), sparkMaterial);
  Object.assign(spark, { visible: false, renderOrder: 10 });

  return {
    opacity,
    ribbon,
    spark,
    hide() {
      ribbon.visible = spark.visible = false;
    },
    place(along: number, at: typeof tmpAt, height: number) {
      head.value = along;
      opacity.value = 1;
      spark.position.set(at.x, height, at.y);
      // nothing ahead of the spark glows, so it is not drawn: up to the leg after its own, for the soft head
      ribbon.geometry.setDrawRange(0, (at.leg + 2) * 6);
      ribbon.visible = spark.visible = true;
    },
    setRoute(route: Geom.VectJson[], lengths: number[], heights: [number, number]) {
      ribbon.geometry.dispose();
      ribbon.geometry = createRibbonGeometry(route, lengths, heights);
    },
  };
}

/** A flat strip along `route`, each vertex knowing how far along it lies and which side it is */
function createRibbonGeometry(route: Geom.VectJson[], lengths: number[], heights: [number, number]) {
  const half = spiritConfig.widthMetres / 2;
  const length = lengths.reduce((sum, x) => sum + x, 0);
  const n = route.length;
  const positions = new Float32Array(n * 6);
  const along = new Float32Array(n * 2);
  const sides = new Float32Array(n * 2);
  const indices = new Uint32Array(Math.max(0, n - 1) * 6);
  let dist = 0;
  for (const [i, p] of route.entries()) {
    const prev = route[Math.max(0, i - 1)];
    const next = route[Math.min(n - 1, i + 1)];
    const step = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    const [nx, ny] = [-(next.y - prev.y) / step, (next.x - prev.x) / step];
    const height = riseAt(dist, length, heights, spiritConfig.height);
    positions.set([p.x + nx * half, height, p.y + ny * half, p.x - nx * half, height, p.y - ny * half], i * 6);
    along.set([dist, dist], i * 2);
    sides.set([1, -1], i * 2);
    if (i > 0) indices.set([2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i], (i - 1) * 6);
    dist += lengths[i] ?? 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("side", new THREE.BufferAttribute(sides, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/**
 * A centripetal Catmull-Rom through the route's points, sampled evenly: it neither loops nor overshoots.
 * A straight route is sampled too, so the ribbon rises and falls with the spark
 */
function smoothRoute(route: Geom.VectJson[]) {
  const points = route.filter(
    (p, i) =>
      i === 0 ||
      i === route.length - 1 ||
      Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) > spiritConfig.mergeMetres,
  );
  if (points.length < 2) return points;
  const vs = points.map((p) => new THREE.Vector3(p.x, 0, p.y));
  if (vs.length === 2 && vs[0].equals(vs[1])) return points;
  const curve =
    vs.length === 2 ? new THREE.LineCurve3(vs[0], vs[1]) : new THREE.CatmullRomCurve3(vs, false, "centripetal");
  const samples = Math.max(2, Math.ceil(curve.getLength() / spiritConfig.sampleMetres));
  return curve.getSpacedPoints(samples).map((v) => ({ x: v.x, y: v.z }));
}

/** `cruise`, eased from the first of `ends` over the route's start and to the second over its end */
function riseAt(dist: number, length: number, ends: [number, number], cruise: number) {
  const ramp = Math.min(spiritConfig.rampMetres, length / 2) || 1;
  const away = (x: number) => 1 - smootherstep(THREE.MathUtils.clamp(x / ramp, 0, 1));
  return cruise + (ends[0] - cruise) * away(dist) + (ends[1] - cruise) * away(length - dist);
}

/** Their forehead in the world, whatever their pose */
function foreheadOf(npc: JshCli.Npc) {
  return throughHead(npc, "forehead", tmpForehead);
}

/** The way their face looks in world XZ, unit length. `null` if it looks mostly up or down */
function faceOf(npc: JshCli.Npc) {
  const front = throughHead(npc, "forehead", tmpForehead);
  const middle = throughHead(npc, "middle", tmpMiddle, false);
  const [dx, dy, dz] = [front.x - middle.x, front.y - middle.y, front.z - middle.z];
  const flat = Math.hypot(dx, dz);
  return flat < Math.abs(dy) || flat === 0 ? null : { x: dx / flat, y: dz / flat };
}

/**
 * A point of their head from the bind pose to the world, through the head bone as the skinning takes it.
 * `fresh` of `false` reuses the matrices the last call brought up to date, for a second point of the same head
 */
function throughHead(npc: JshCli.Npc, which: "forehead" | "middle", out: THREE.Vector3, fresh = true) {
  const mesh = npc.skinnedMesh;
  const { bones, boneInverses } = mesh.skeleton;
  const index = headIndexOf(mesh.skeleton);
  if (index !== -1) {
    if (fresh === true) {
      bones[index].updateWorldMatrix(true, false);
      mesh.updateWorldMatrix(true, false);
      tmpBone.multiplyMatrices(bones[index].matrixWorld, boneInverses[index]);
    }
    out
      .copy(bindHeadOf(mesh.geometry, index)[which])
      .applyMatrix4(mesh.bindMatrix)
      .applyMatrix4(tmpBone)
      .applyMatrix4(mesh.bindMatrixInverse)
      .applyMatrix4(mesh.matrixWorld);
    // a mesh not yet placed, e.g. just spawned, has its head far from them
    if (Math.hypot(out.x - npc.position.x, out.z - npc.position.z) <= spiritConfig.headReachMetres) return out;
  }
  const lift = npc.posture === "lie" ? spiritConfig.lainHeadLift : spiritConfig.height;
  return out.set(npc.position.x, npc.position.y + lift, npc.position.z);
}

/**
 * In the bind pose: a little in front of the face most of the way up the head, and the head's middle at that
 * height. Shared by every npc
 */
function bindHeadOf(geometry: THREE.BufferGeometry, headIndex: number) {
  const cached = bindForeheads.get(geometry);
  if (cached !== undefined) return cached;
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const position = geometry.getAttribute("position");
  const box = new THREE.Box3();
  for (let i = 0; i < position.count; i++) {
    for (let k = 0; k < 4; k++)
      if (skinIndex.getComponent(i, k) === headIndex && skinWeight.getComponent(i, k) > 0.99)
        box.expandByPoint(tmpForehead.fromBufferAttribute(position, i));
  }
  // the face is towards -z
  const forehead = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.min.y + (box.max.y - box.min.y) * spiritConfig.foreheadUp,
    box.min.z,
  );
  const middle = forehead.clone().setZ((box.min.z + box.max.z) / 2);
  const head = { forehead, middle };
  bindForeheads.set(geometry, head);
  return head;
}

/** Where the light stands, `share` of the way from their feet to their forehead */
function lightNear(npc: JshCli.Npc, share: number) {
  const { x, z } = foreheadOf(npc);
  const { position: p } = npc;
  return setLight(p.x + (x - p.x) * share, p.y, p.z + (z - p.z) * share, npc.rotation.y);
}

/** Where the light stands, written into the one object reused each frame */
function setLight(x: number, y: number, z: number, rotationY: number) {
  tmpLight.x = x;
  tmpLight.y = y;
  tmpLight.z = z;
  tmpLight.rotationY = rotationY;
  return tmpLight;
}

/** The index of the head among a skeleton's bones, `-1` if none: looked for once per skeleton */
function headIndexOf(skeleton: THREE.Skeleton) {
  let index = headIndexes.get(skeleton);
  if (index === undefined)
    headIndexes.set(skeleton, (index = skeleton.bones.findIndex((bone) => bone.name === "head")));
  return index;
}

const bindForeheads = new WeakMap<THREE.BufferGeometry, { forehead: THREE.Vector3; middle: THREE.Vector3 }>();
const tmpForehead = new THREE.Vector3();
const tmpMiddle = new THREE.Vector3();
const tmpBone = new THREE.Matrix4();
const headIndexes = new WeakMap<THREE.Skeleton, number>();
/** Reused each frame: where the light stands, and the point along the route */
const tmpLight = { x: 0, y: 0, z: 0, rotationY: 0 };
const tmpAt = { x: 0, y: 0, dx: 0, dy: 0, leg: 0 };

function pickOne<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

/** Zero slope and zero acceleration at both ends */
function smootherstep(x: number) {
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const maxStepSecs = 0.1;
/** Whom the spirit may wake in */
const restingPostures = new Set(["sit", "lie"]);
/** How far from a forehead the navmesh may be found: a bed is off it */
const routeHalfExtents: [number, number, number] = [2, 2, 2];

const spiritConfig = {
  /** How long until they have left. With nobody to wake in, how long until they are back */
  leaveSecs: 2.5,
  recoverSecs: 0.8,
  /** How far through leaving their eyes shut */
  shutAt: 0.5,
  /** Their breath's pace once left, drawing out the pause after a breath */
  leavePace: 0.15,
  /** The crossing's seconds per metre of route, and its least and most */
  crossSecsPerMetre: 0.3,
  crossSecs: [3, 12] as [number, number],
  /** Route points nearer than this are merged before it is curved, and the curve's sample spacing */
  mergeMetres: 0.3,
  sampleMetres: 0.15,
  /** The share of `lightRadius` seen around the spark whilst crossing */
  crossReach: 0.3,
  /** Seconds the spark's light takes to grow in, from none once they have left */
  sparkLightSecs: 0.8,
  /** Metres between the route's points looked up for the room they are in */
  roomProbeMetres: 0.5,
  /** Metres ahead of the spark a room on its route is lit, so it has faded in by the time the spark arrives */
  roomLeadMetres: 2.5,
  /** The first breath woken: its pace, and how much more it swells and glows */
  firstPace: 0.5,
  firstSwell: 2.2,
  /** Seconds after that breath for the swell to settle, and for the thread to fade */
  settleSecs: 2,
  trailFadeSecs: 1.5,
  wakeBlinks: 2,
  /** Key prefix of anyone spawned in a bed or seat to wake in */
  sleeperKey: "sleeper",
  color: "#cfe8ff",
  /** Metres the thread flies at, and over how much of each end it eases to a chest */
  height: 0.9,
  rampMetres: 1.5,
  /** How far up the head their forehead is */
  foreheadUp: 0.7,
  /** Further than this from them, their head is not yet where they are: above them instead, lower if lain */
  headReachMetres: 2.5,
  /** Woken lain, the view's tilt off straight down, and how far beside them open floor is looked for */
  lainPolar: 1.1,
  sideProbeMetres: 1,
  lainHeadLift: 0.3,
  widthMetres: 0.12,
  tailMetres: 4,
  headSoftMetres: 0.15,
  /** How bright the whole thread stays behind the spark */
  cordGlow: 0.15,
  sparkRadius: 0.07,
};

export type State = {
  /** `leave` as they go, `commit` whilst finding who to wake in, then `cross` and `arrive` */
  phase: "idle" | "leave" | "commit" | "cross" | "arrive";
  fromKey: null | string;
  toKey: null | string;
  /** Whilst leaving. Cleared when nobody is found to wake in, which draws them back */
  leaving: boolean;
  /** Whether the camera has been sent onto their face, once leaving began */
  framed: boolean;
  /** Whether the camera followed the player before `frame` stopped it: back on once it is over */
  wasFollowing: boolean;
  /** The camera's target height when the crossing began, kept throughout */
  viewHeight: number;
  /** How far they have left, `0` to `1` */
  leave: number;
  /** Seconds into `cross` or `arrive`, and how long each takes */
  secs: number;
  crossSecs: number;
  arriveSecs: number;
  /** Through the middle of each door between the two, and the length of each leg */
  route: Geom.VectJson[];
  lengths: number[];
  /** How far along each leg ends, and the whole route's length */
  ends: number[];
  length: number;
  /** Where the player light stands whilst crossing, else `null` — see `LightSweep` */
  light: null | { x: number; y: number; z: number; rotationY: number };
  /** The chests of the two, and the floors they lie on: the thread leaves one and settles on the other */
  heights: [number, number];
  floors: [number, number];
  /** By npcKey, the look their eyes had before they were shut */
  looks: Map<string, EyesKey>;
  /** Rooms lit by hand for the spark, unlit once woken */
  litRooms: Geomorph.GmRoomKey[];
  /** The rooms on the route yet to be lit, each with how far along it is entered */
  roomsAhead: { grKey: Geomorph.GmRoomKey; at: number }[];
  trail: ReturnType<typeof createTrail>;

  begin(fromKey: string, toKey?: null | string): void;
  /** Pans onto their forehead, from the side their face is on, or across them and low if lain */
  frame(npc: JshCli.Npc): void;
  /** The azimuth looking across them lain, from the side of their bed with open floor, else the lesser turn */
  sideOf(npc: JshCli.Npc): undefined | number;
  /** `playerLight.setVeil`, without the darkening in `ship` mode */
  veil(reach: number, dark: number, plain?: number): void;
  /** Unlights the rooms lit for the spark */
  unlightRooms(): void;
  /** Pans along with the spark until the crossing ends */
  followSpark(): void;
  /** Once left: finds who to wake in, and their route there, then crosses */
  commit(): Promise<void>;
  /** Makes them the player, and has them take their first breath */
  arrive(): void;
  findRoute(from: JshCli.Npc, to: JshCli.Npc): Promise<Geom.VectJson[]>;
  /** Each room the route enters, in order, and how far along */
  findRoomsAlong(): State["roomsAhead"];
  /** Any npc sitting or lying, else one spawned in a free bed, else a free seat. `null` if none */
  findTarget(): Promise<null | string>;
  /** The view as it was before: the zoom let go, and a follow turned back on. Once only */
  handBack(): void;
  /** Back to idle, and the light as it was */
  finish(): void;
  onFrame(delta: number): void;
  /** The point `dist` along the route, the way it heads, and the leg it is on */
  pointAt(dist: number): typeof tmpAt;
  /** Back in the body left, as though nothing happened. Also on unmount part way */
  restore(): void;
  shut(npcKey: string, shut: boolean): void;
  /** Leaves the player's body, to wake in `toKey` or someone found */
  start(toKey?: string): void;
  tickArrive(dt: number): void;
  tickCross(dt: number): void;
  tickLeave(dt: number): void;
};
