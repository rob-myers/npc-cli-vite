import {
  type Footfall,
  getAudio,
  isSfxKey,
  isStepSet,
  type SfxKey,
  type SfxOpts,
  type Side,
  sfxKeys,
  stepSets,
  warmAudio,
} from "@npc-cli/ui__audio/engine";

type Foot = {
  side: Side;
  bone: NonNullable<ReturnType<NonNullable<JshCli.Npc["group"]>["getObjectByName"]>>;
  /** The lowest it has been lately, above their feet's ground, rising slowly to follow a crouch or a slope */
  floor: number;
  /** When it last lifted, in game seconds, else `null` whilst down */
  liftedAt: null | number;
};

type Feet = {
  group: NonNullable<JshCli.Npc["group"]>;
  feet: Foot[];
  /** Their position's height when last read */
  groundY: number;
  /** Whether they were moving when last read */
  moving: boolean;
  /** When last read, in game seconds */
  readAt: number;
};

function feetOf(group: Feet["group"], groundY: number): Feet {
  const feet = (["left", "right"] as const).flatMap((side) => {
    const bone = group.getObjectByName(`${side}foot`);
    return bone === undefined ? [] : [{ side, bone, floor: Number.POSITIVE_INFINITY, liftedAt: null }];
  });
  return { group, feet, groundY, moving: false, readAt: 0 };
}

/**
 * The feet that came down since last read: each lifted clear of its floor, then back near it.
 * A foot lifted longer than a stride sets its floor afresh. So do both, setting off, or the ground jumping, as
 * getting up off a chair.
 */
function footfalls(feet: Feet, groundY: number, moving: boolean, now: number) {
  const dt = Math.min(0.2, now - feet.readAt);
  feet.readAt = now;
  const jumped = Math.abs(groundY - feet.groundY) > feetConfig.jumpMetres || (moving && !feet.moving);
  [feet.groundY, feet.moving] = [groundY, moving];
  const landed: Side[] = [];
  for (const foot of feet.feet) {
    // the height the last render left it at, no matrix worked out afresh: a frame late at worst
    const height = foot.bone.matrixWorld.elements[13] - groundY;
    const stuck = foot.liftedAt !== null && now - foot.liftedAt > feetConfig.strideSecs;
    if (jumped || stuck) [foot.floor, foot.liftedAt] = [height, null];
    foot.floor = Math.min(height, foot.floor + dt * feetConfig.floorRise);
    if (height > foot.floor + feetConfig.liftMetres) foot.liftedAt ??= now;
    else if (foot.liftedAt !== null && height < foot.floor + feetConfig.plantMetres) {
      foot.liftedAt = null;
      landed.push(foot.side);
    }
  }
  return landed;
}

/** A footfall of `npc`'s: whether running, and how hard, louder the faster */
function footfallOf(npc: JshCli.Npc, side: Side): Footfall {
  if (npc.anim.crouched) return { side, run: false, level: stepLevels.crouched };
  if (npc.isMoving() === false) return { side, run: false, level: stepLevels.turning };
  if (npc.anim.fast) return { side, run: true, level: stepLevels.running };
  return { side, run: false, level: npc.anim.strafe ? stepLevels.strafing : stepLevels.walking };
}

/** Each gait's step level, out of the steps' fader */
const stepLevels = { crouched: 0.07, turning: 0.15, walking: 0.35, strafing: 0.3, running: 0.5 };

const feetConfig = {
  /** How far above its floor a foot must rise to be lifted, and come back within to land, in metres */
  liftMetres: 0.03,
  plantMetres: 0.012,
  /** Metres a second a foot's floor rises by, so it follows a crouch or a step up */
  floorRise: 0.15,
  /** Longer lifted than this, a foot's floor is wrong, as after sitting: it is set afresh */
  strideSecs: 0.8,
  /** The ground moving this far between reads, as a spawn or getting off a chair, sets both feet's floors afresh */
  jumpMetres: 0.05,
};

/**
 * Plays a sound effect, heard where an npc is if given
 * ```sh
 * sfx phaser
 * sfx armour rob
 * sfx wall
 * ```
 */
export function sfx({ args, w }: JshCli.RunArg) {
  const [key, npcKey] = args;
  if (!isSfxKey(key)) throw Error(`expected one of ${sfxKeys.join(", ")}`);
  getAudio().sfx(key, npcKey === undefined ? {} : heardAt(w, w.npc.get(npcKey).position));
}

/**
 * Plays footsteps, one per footfall read off their feet each tick: the player's, and quieter those of npcs near them.
 * Also the weapon sounds: phaser fire, how each shot at someone ended, and a shot at no one striking (idempotent).
 * `set:` chooses the player's footsteps, as the desk does: tile, tile3 or tile4. See `docs/audio.md`
 * ```sh
 * sounds
 * sounds set:tile3
 * sounds off
 * ```
 */
export function sounds({ api, args, w }: JshCli.RunArg) {
  const opts: { set?: unknown } = api.jsArg(args.filter((arg) => arg.includes(":")));
  if (opts.set !== undefined) {
    if (!isStepSet(opts.set)) throw Error(`expected one of ${stepSets.join(", ")}: ${opts.set}`);
    getAudio().setStepSet(opts.set);
  }
  if (args[0] === "off") {
    w.e.keyedListener.delete("sounds");
    w.e.keyedTick.delete("sounds");
    return;
  }
  warmAudio();
  w.e.addKeyedListener("sounds", onSoundsEvent);
  /** Each heard npc's feet, the player's among them */
  const feet = new Map<string, Feet>();
  /** The npcs near the player, found every `everySecs` */
  let near: JshCli.Npc[] = [];
  let nearAt = Number.NEGATIVE_INFINITY;
  w.e.addKeyedTick("sounds", (w) => {
    const player = w.n[w.player.key];
    if (player === undefined) return;
    const now = w.gameTime.now();
    if (now - nearAt >= hearConfig.everySecs) {
      nearAt = now;
      near = nearPlayer(w, player);
      const heard = new Set([player.key, ...near.map(({ key }) => key)]);
      for (const key of feet.keys()) if (!heard.has(key)) feet.delete(key);
    }
    for (let i = -1; i < near.length; i++) {
      const npc = i === -1 ? player : near[i];
      if (npc.group == null) continue;
      let theirs = feet.get(npc.key);
      if (theirs?.group !== npc.group) feet.set(npc.key, (theirs = feetOf(npc.group, npc.position.y)));
      for (const side of footfalls(theirs, npc.position.y, npc.isMoving(), now)) {
        const footfall = footfallOf(npc, side);
        getAudio().footfall(
          npc === player ? footfall : { ...heardFrom(w, player, npc, footfall), set: setOf(npc.key) },
        );
      }
    }
  });
}

/** The nearest `maxNear` npcs in reach of the player, through open doors, and within `hearMetres` */
function nearPlayer(w: JshCli.WorldState, player: JshCli.Npc) {
  const { x, z } = player.position;
  return w.e
    .getNpcsInReach(player.key)
    .map((npc) => ({ npc, dist: Math.hypot(npc.position.x - x, npc.position.z - z) }))
    .filter(({ dist }) => dist < hearConfig.hearMetres)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, hearConfig.maxNear)
    .map(({ npc }) => npc);
}

/** `npc`'s footfall as the player hears it: quieter, fading out by `hearMetres`, panned across the view */
function heardFrom(w: JshCli.WorldState, player: JshCli.Npc, npc: JshCli.Npc, footfall: Footfall): Footfall {
  const [dx, dz] = [npc.position.x - player.position.x, npc.position.z - player.position.z];
  const near = Math.max(0, 1 - Math.hypot(dx, dz) / hearConfig.hearMetres);
  const e = w.r3f.camera.matrixWorld.elements;
  const across = (dx * e[0] + dz * e[2]) / (Math.hypot(e[0], e[2]) || 1);
  const pan = Math.max(-1, Math.min(1, across / heardConfig.panMetres)) * heardConfig.maxPan;
  return { ...footfall, level: footfall.level * hearConfig.npcLevel * near * near, pan };
}

/** An npc's own set of footsteps: random across npcs, the same each time for one */
function setOf(npcKey: string) {
  let hash = 0;
  for (let i = 0; i < npcKey.length; i++) hash = (hash * 31 + npcKey.charCodeAt(i)) | 0;
  return stepSets[Math.abs(hash) % stepSets.length];
}

const hearConfig = {
  /** How often the npcs near the player are found, in game seconds */
  everySecs: 0.5,
  /** Beyond this, an npc's steps are not heard */
  hearMetres: 10,
  /** The most npcs whose steps are heard at once, the nearest */
  maxNear: 6,
  /** An npc's step beside the player, out of the player's own */
  npcLevel: 0.7,
};

function onSoundsEvent(e: JshCli.Event, w: JshCli.WorldState) {
  if (e.key === "phaser-fired") playAt(w, "phaser", e.by);
  else if (e.key === "npc-shot") playAt(w, e.outcome, e.npcKey);
  else if (e.key === "phaser-struck" && e.what !== "nothing") getAudio().sfx("wall", heardAt(w, e.at));
}

function playAt(w: JshCli.WorldState, key: SfxKey, npcKey: string) {
  const npc = w.n[npcKey];
  if (npc !== undefined) getAudio().sfx(key, heardAt(w, npc.position));
}

/** Panned by where `at` is across the view, and quieter the further it is from the view's centre */
function heardAt(w: JshCli.WorldState, at: { x: number; z: number }): SfxOpts {
  const centre = w.view.controls?.target ?? w.r3f.camera.position;
  const [dx, dz] = [at.x - centre.x, at.z - centre.z];
  // the camera's right, along the ground
  const e = w.r3f.camera.matrixWorld.elements;
  const right = Math.hypot(e[0], e[2]) || 1;
  const across = (dx * e[0] + dz * e[2]) / right;
  const dist = Math.hypot(dx, dz);
  return {
    pan: Math.max(-1, Math.min(1, across / heardConfig.panMetres)) * heardConfig.maxPan,
    gain: 1 / (1 + Math.max(0, dist - heardConfig.nearMetres) / heardConfig.falloffMetres),
  };
}

const heardConfig = {
  /** Metres across the view at which a sound is panned furthest */
  panMetres: 8,
  maxPan: 0.8,
  /** Within this, a sound is at full level */
  nearMetres: 4,
  /** Metres beyond `nearMetres` at which a sound is at half level */
  falloffMetres: 8,
};
