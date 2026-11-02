import {
  type DoorVoice,
  doorVoices,
  type Footfall,
  getAudio,
  isDoorVoice,
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
  feet.groundY = groundY;
  feet.moving = moving;
  landed.length = 0;
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

/** What `footfalls` returns, reused every tick */
const landed: Side[] = [];

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
 * Plays a sound effect, heard where an npc is if given. `amount:` from `0` to `1`, e.g. a shot's charge
 * ```sh
 * sfx fire
 * sfx fire amount:0.2
 * sfx armour rob
 * ```
 */
export function sfx({ api, args, w }: JshCli.RunArg) {
  const opts: { amount?: unknown } = api.jsArg(args.filter((arg) => arg.includes(":")));
  const [key, npcKey] = args.filter((arg) => !arg.includes(":"));
  if (!isSfxKey(key)) throw Error(`expected one of ${sfxKeys.join(", ")}`);
  const amount = typeof opts.amount === "number" ? opts.amount : undefined;
  getAudio().sfx(key, { amount, ...(npcKey === undefined ? {} : heardAt(w, w.npc.get(npcKey).position)) });
}

/**
 * Lists the doors the player hears, with their voices. Else chooses a voice for one door, or for every door, until a
 * reload. `off` forgets what was chosen
 * ```sh
 * doorvoice
 * doorvoice smug
 * doorvoice g1d19 heavy
 * doorvoice off
 * ```
 */
export function doorvoice({ args, w }: JshCli.RunArg) {
  const { chosenVoices } = getAudio();
  const [first, voice] = args;
  if (first === "off") return void chosenVoices.clear();
  if (isDoorVoice(first)) return void chosenVoices.set("*", first);
  if (first !== undefined) {
    if (!(first in w.door.byKey)) throw Error(`no such door: ${first}`);
    if (!isDoorVoice(voice)) throw Error(`expected one of ${doorVoices.join(", ")}`);
    return void chosenVoices.set(first, voice);
  }
  const player = w.n[w.player.key];
  if (player === undefined) throw Error("no player");
  return [...doorsInReach(w, player)].map((gdKey) => `${gdKey} ${voiceOf(w.door.byKey[gdKey])}`).join("\n");
}

/**
 * Plays footsteps, one per footfall read off their feet each tick: the player's, and quieter those of npcs near them.
 * Also the phaser's sounds: raised, lowered, charging, fired, and where each shot ends.
 * And the doors': sliding, locked, held, refusing someone (idempotent).
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
  const hearing: Hearing = {
    npcKeys: new Set(),
    gdKeys: new Set(),
    settling: new Set(),
    seated: new Set(),
    deniedAt: new Map(),
    ratios: new Map(),
    moving: new Map(),
    doorsReadAt: 0,
  };
  w.e.addKeyedListener("sounds", (e, w) => onSoundsEvent(e, w, hearing));
  /** Each heard npc's feet, the player's among them */
  const feet = new Map<string, Feet>();
  /** Each heard npc's charge when last read, whilst charging */
  const charges = new Map<string, number>();
  /** The player, then the nearest `maxNear` npcs within `hearMetres`: their feet and charges are read each tick */
  let heard: JshCli.Npc[] = [];
  let foundAt = Number.NEGATIVE_INFINITY;
  w.e.addKeyedTick("sounds", (w) => {
    const player = w.n[w.player.key];
    if (player === undefined) return;
    const now = w.gameTime.now();
    if (now - foundAt >= hearConfig.everySecs || heard[0] !== player) {
      foundAt = now;
      const inReach = npcsInReach(w, player);
      hearing.npcKeys = new Set([player.key, ...inReach.map(({ npc }) => npc.key)]);
      hearing.gdKeys = doorsInReach(w, player);
      for (const gdKey of hearing.ratios.keys()) {
        if (hearing.gdKeys.has(gdKey)) continue;
        hearing.ratios.delete(gdKey);
        hearing.moving.delete(gdKey) && getAudio().release("door", placeOf(w.door.byKey[gdKey]));
      }
      const near = inReach.filter(({ dist }) => dist < hearConfig.hearMetres).slice(0, hearConfig.maxNear);
      heard = [player, ...near.map(({ npc }) => npc)];
      const keys = new Set(heard.map(({ key }) => key));
      for (const key of [...feet.keys(), ...charges.keys()]) {
        if (keys.has(key)) continue;
        feet.delete(key);
        charges.delete(key) && getAudio().release("charge", key);
      }
    }
    for (const npc of heard) {
      syncCharge(w, npc, charges);
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
    syncDoors(w, hearing, now);
  });
}

/** The npcs in reach of the player, through open doors, within `reachMetres`, nearest first */
function npcsInReach(w: JshCli.WorldState, player: JshCli.Npc) {
  const { x, z } = player.position;
  return w.e
    .getNpcsInReach(player.key)
    .filter((npc) => npc !== player)
    .map((npc) => ({ npc, dist: Math.hypot(npc.position.x - x, npc.position.z - z) }))
    .filter(({ dist }) => dist < hearConfig.reachMetres)
    .sort((a, b) => a.dist - b.dist);
}

/** Holds `npc`'s phaser charging, ticks once it is full, and cools it if cancelled */
function syncCharge(w: JshCli.WorldState, npc: JshCli.Npc, charges: Map<string, number>) {
  const was = charges.get(npc.key);
  if (w.phasers?.isCharging(npc.key) === true) {
    const level = w.phasers.chargeOf(npc.key);
    const at = heardAt(w, npc.position);
    getAudio().hold("charge", npc.key, { level, ...at });
    if (level >= 1 && (was ?? 0) < 1) getAudio().sfx("charged", at);
    charges.set(npc.key, level);
  } else if (was !== undefined) {
    charges.delete(npc.key);
    getAudio().release("charge", npc.key);
    // else fired, heard on `phaser-fired`
    if (w.phasers?.isCooling(npc.key) === true) getAudio().sfx("cool", { ...heardAt(w, npc.position), amount: was });
  }
}

/** `npc`'s footfall as the player hears it: quieter, fading out by `hearMetres`, panned across the view */
function heardFrom(w: JshCli.WorldState, player: JshCli.Npc, npc: JshCli.Npc, footfall: Footfall): Footfall {
  const [dx, dz] = [npc.position.x - player.position.x, npc.position.z - player.position.z];
  const near = Math.max(0, 1 - Math.hypot(dx, dz) / hearConfig.hearMetres);
  return { ...footfall, level: footfall.level * hearConfig.npcLevel * near * near, pan: panOf(w, dx, dz) };
}

/** An npc's own set of footsteps: random across npcs, the same each time for one */
const setOf = (npcKey: string) => stepSets[hashOf(npcKey) % stepSets.length];

/** A door's voice: chosen by hand, else its map's `meta.voice`, else one of them by its key */
function voiceOf(door: Geomorph.DoorState): DoorVoice {
  const { chosenVoices } = getAudio();
  const chosen = chosenVoices.get(door.gdKey) ?? chosenVoices.get("*");
  if (chosen !== undefined) return chosen;
  const { voice } = door.connector.meta;
  if (isDoorVoice(voice)) return voice;
  return doorVoices[hashOf(door.gdKey) % doorVoices.length];
}

/** Holds the sound of each heard door whilst it moves, `level` its speed. One that stops is let go */
function syncDoors(w: JshCli.WorldState, hearing: Hearing, now: number) {
  const dt = now - hearing.doorsReadAt;
  hearing.doorsReadAt = now;
  for (const gdKey of hearing.gdKeys) {
    const door = w.door.byKey[gdKey];
    const ratio = w.door.openRatioArray[door.instanceId];
    const was = hearing.ratios.get(gdKey) ?? ratio;
    hearing.ratios.set(gdKey, ratio);
    const level = dt > 0 ? Math.min(1, Math.abs(ratio - was) / dt / hearConfig.doorSpeed) : 0;
    if (level > 0) {
      hearing.moving.set(gdKey, level);
      getAudio().hold("door", placeOf(door), { level, ...heardAt(w, centreOf(door)), voice: voiceOf(door) });
    } else if (hearing.moving.delete(gdKey)) getAudio().release("door", placeOf(door));
  }
}

/** A door's centre on the ground */
const centreOf = (door: Geomorph.DoorState) => ({ x: (door.src.x + door.dst.x) / 2, z: (door.src.y + door.dst.y) / 2 });

/** Where a door is, to the decimetre, so both sides of a hull door hold one voice */
function placeOf(door: Geomorph.DoorState) {
  const { x, z } = centreOf(door);
  return `${Math.round(x * 10)},${Math.round(z * 10)}`;
}

/** A string's hash, a non-negative integer */
function hashOf(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** The doors of the rooms the player reaches through open doors, and of the rooms beyond those */
function doorsInReach(w: JshCli.WorldState, player: JshCli.Npc) {
  const at = w.npc.npcToRoom.get(player.key);
  if (at === undefined || w.gmRoomGraph.getNode(at.grKey) === null) return new Set<Geomorph.GmDoorKey>();
  // their room is depth 0, its doors 1, the rooms beyond 2, their doors 3
  const nodes = w.gmRoomGraph.getReachableUpTo(at.grKey, (node, depth) =>
    node.type === "room" ? depth >= 4 : node.type !== "door" || w.door.isSeenThrough(node.gdKey) === false,
  );
  return new Set(nodes.flatMap((node) => (node.type === "door" ? [node.gdKey] : [])));
}

const hearConfig = {
  /** How often the npcs near the player are found, in game seconds */
  everySecs: 0.5,
  /** Beyond this, an npc's steps are not heard */
  hearMetres: 10,
  /** The most npcs whose steps are heard at once, the nearest */
  maxNear: 6,
  /** Beyond this, an npc's other sounds are not heard, as their phaser */
  reachMetres: 20,
  /** Game seconds before a door refusing someone is heard again */
  deniedSecs: 1.5,
  /** A door's open ratio per game second, as the World's `doorSpeed`: a moving door's full level */
  doorSpeed: 4,
  /** An npc's step beside the player, out of the player's own */
  npcLevel: 0.7,
};

/** Whose sounds are heard, and which doors, found every `everySecs` */
type Hearing = {
  npcKeys: Set<string>;
  gdKeys: Set<Geomorph.GmDoorKey>;
  /** Npcs about to settle onto a doable (`npc-pre-do`), so one spawned onto it is not heard */
  settling: Set<string>;
  /** Npcs sat or lain on a doable, so getting off is heard */
  seated: Set<string>;
  /** When each door last refused someone, in game seconds */
  deniedAt: Map<Geomorph.GmDoorKey, number>;
  /** Each heard door's open ratio when last read */
  ratios: Map<Geomorph.GmDoorKey, number>;
  /** Each moving door's speed when last read, `0` to `1` */
  moving: Map<Geomorph.GmDoorKey, number>;
  doorsReadAt: number;
};

/** Plays what is heard. Without a player, all is */
function onSoundsEvent(e: JshCli.Event, w: JshCli.WorldState, hearing: Hearing) {
  const anyone = w.n[w.player.key] === undefined;
  const heard = (...npcKeys: string[]) => anyone || npcKeys.some((key) => hearing.npcKeys.has(key));
  const doorHeard = (gdKey: Geomorph.GmDoorKey) => anyone || hearing.gdKeys.has(gdKey);
  switch (e.key) {
    case "phasers":
      for (const npcKey of e.npcKeys) heard(npcKey) && playAt(w, e.armed ? "raise" : "lower", npcKey);
      break;
    case "npc-pre-do":
      hearing.settling.add(e.npcKey);
      break;
    case "npc-do": {
      // only one settling onto it, not one spawned there
      const settling = hearing.settling.delete(e.npcKey);
      const how = e.decorKey === null ? null : w.decor.byKey[e.decorKey]?.meta.do;
      const wasOn = hearing.seated.has(e.npcKey);
      how === "sit" || how === "lie" ? hearing.seated.add(e.npcKey) : hearing.seated.delete(e.npcKey);
      if (!heard(e.npcKey)) break;
      if (settling && (how === "sit" || how === "lie")) playAt(w, how, e.npcKey);
      else if (e.decorKey === null && wasOn) playAt(w, "stand", e.npcKey);
      break;
    }
    case "phaser-fired":
      heard(e.by) && playAt(w, "fire", e.by, { amount: e.charge });
      break;
    case "npc-shot":
      heard(e.by, e.npcKey) && playAt(w, e.outcome, e.npcKey);
      break;
    case "phaser-struck":
      e.what !== "nothing" && heard(e.by) && getAudio().sfx("wall", heardAt(w, e.at));
      break;
    case "door-open":
    case "door-closed": {
      const amount = hearing.moving.get(e.gdKey) ?? 1;
      doorHeard(e.gdKey) && playAtDoor(w, e.key === "door-open" ? "opened" : "closed", e.gdKey, amount);
      break;
    }
    case "door-locked":
    case "door-unlocked":
      doorHeard(e.gdKey) && playAtDoor(w, e.key === "door-locked" ? "lock" : "unlock", e.gdKey);
      break;
    case "door-toggled":
      e.what === "held" && doorHeard(e.gdKey) && playAtDoor(w, e.on ? "hold" : "unhold", e.gdKey);
      break;
    case "door-denied": {
      const now = w.gameTime.now();
      if (!doorHeard(e.gdKey) || now - (hearing.deniedAt.get(e.gdKey) ?? -Infinity) < hearConfig.deniedSecs) break;
      hearing.deniedAt.set(e.gdKey, now);
      playAtDoor(w, "denied", e.gdKey);
      break;
    }
  }
}

function playAtDoor(w: JshCli.WorldState, key: SfxKey, gdKey: Geomorph.GmDoorKey, amount?: number) {
  const door = w.door.byKey[gdKey];
  if (door !== undefined) getAudio().sfx(key, { ...heardAt(w, centreOf(door)), voice: voiceOf(door), amount });
}

function playAt(w: JshCli.WorldState, key: SfxKey, npcKey: string, opts: SfxOpts = {}) {
  const npc = w.n[npcKey];
  if (npc !== undefined) getAudio().sfx(key, { ...heardAt(w, npc.position), ...opts });
}

/** Panned by where `at` is across the view, quieter the further it is from the view's centre, at the World's speed */
function heardAt(
  w: JshCli.WorldState,
  at: { x: number; z: number },
): Required<Pick<SfxOpts, "pan" | "gain" | "speed">> {
  const centre = w.view.controls?.target ?? w.r3f.camera.position;
  const [dx, dz] = [at.x - centre.x, at.z - centre.z];
  return {
    pan: panOf(w, dx, dz),
    gain: 1 / (1 + Math.max(0, Math.hypot(dx, dz) - heardConfig.nearMetres) / heardConfig.falloffMetres),
    speed: w.gameTime.scale,
  };
}

/** A pan for an offset `dx, dz` on the ground, by how far it lies along the camera's right */
function panOf(w: JshCli.WorldState, dx: number, dz: number) {
  const e = w.r3f.camera.matrixWorld.elements;
  const across = (dx * e[0] + dz * e[2]) / (Math.hypot(e[0], e[2]) || 1);
  return Math.max(-1, Math.min(1, across / heardConfig.panMetres)) * heardConfig.maxPan;
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
