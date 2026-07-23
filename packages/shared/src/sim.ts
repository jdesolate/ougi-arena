import { circleAabbContact, circlesOverlap, closingSpeed, resolveNinjaPair, stopAtContact } from "./collision.js";
import {
  LAUNCH_SPEED_MAX,
  LAUNCH_SPEED_MIN,
  LINEAR_DAMPING_PER_TICK,
  MAX_DASH_DISTANCE,
  MAX_HP,
  MAX_SP,
  MAX_TP,
  MIN_IMPACT_SPEED,
  NINJA_RADIUS,
  NINJA_RESTITUTION,
  OBSTACLE_DAMAGE_PER_IMPACT_SPEED,
  OBSTACLE_HP,
  REST_SPEED,
  RESPAWN_DELAY_TICKS,
  RESPAWN_HP_FRACTION,
  RESPAWN_INVULN_TICKS,
  SIM_DT,
  SP_GAIN_ON_KO,
  TP_CHARGE_PER_TICK,
} from "./constants.js";
import { clamp, lengthOf } from "./math.js";
import { DOJO_ARENA } from "./map.js";
import type {
  ArenaMap,
  LaunchCommand,
  NinjaState,
  ObstacleState,
  SimCommand,
  SimEvent,
  SimState,
  Vec2,
} from "./types.js";

export function spawnPointFor(map: ArenaMap, index: number): Vec2 {
  const spawn = map.spawns[index % map.spawns.length];
  return spawn ? { x: spawn.x, y: spawn.y } : { x: map.width / 2, y: map.height / 2 };
}

export function createNinja(id: string, spawn: Vec2): NinjaState {
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: NINJA_RADIUS,
    dashBudget: 0,
    active: true,
    hp: MAX_HP,
    tp: MAX_TP,
    charging: false,
    sp: 0,
    invulnerableTicks: 0,
    respawnTicks: 0,
  };
}

/** Spawn point whose distance to the nearest other active ninja is greatest — deterministic stand-in for "random" that keeps the sim reproducible. */
function bestRespawnPoint(state: SimState, ninjaId: string): Vec2 {
  const others = state.ninjas.filter((n) => n.active && n.id !== ninjaId);
  let best: Vec2 = spawnPointFor(state.map, 0);
  let bestScore = -Infinity;

  state.map.spawns.forEach((spawn, index) => {
    const score =
      others.length === 0
        ? Infinity
        : Math.min(...others.map((o) => lengthOf(spawn.x - o.x, spawn.y - o.y)));
    if (score > bestScore) {
      bestScore = score;
      best = spawnPointFor(state.map, index);
    }
  });

  return best;
}

function createObstacles(map: ArenaMap): ObstacleState[] {
  return map.obstacles.map((box, index) => ({
    id: index,
    x: box.x,
    y: box.y,
    halfW: box.halfW,
    halfH: box.halfH,
    hp: OBSTACLE_HP,
    alive: true,
  }));
}

export function createSimState(ninjaIds: string[], map: ArenaMap = DOJO_ARENA): SimState {
  return {
    tick: 0,
    map,
    ninjas: ninjaIds.map((id, index) => createNinja(id, spawnPointFor(map, index))),
    obstacles: createObstacles(map),
  };
}

/** Restores the destructible grid without disturbing ninjas; used at match start and on rematch. */
export function resetObstacles(state: SimState): void {
  state.obstacles = createObstacles(state.map);
}

/** Shared by the authoritative tick and the client's optimistic launch, so both produce the same velocity. */
export function applyLaunch(ninja: NinjaState, command: LaunchCommand): number {
  const len = lengthOf(command.dirX, command.dirY);
  if (len === 0) return 0;

  const power = clamp(command.power, 0, 1);
  // TP is spent 1:1 per world unit dashed, so a drained ninja's dash falls short of a full-power reach.
  const distance = Math.min(power * MAX_DASH_DISTANCE, ninja.tp);
  if (distance <= 0) return 0;

  const speed = LAUNCH_SPEED_MIN + (LAUNCH_SPEED_MAX - LAUNCH_SPEED_MIN) * power;
  ninja.vx = (command.dirX / len) * speed;
  ninja.vy = (command.dirY / len) * speed;
  ninja.dashBudget = distance;
  ninja.tp -= distance;
  ninja.charging = false;
  return speed;
}

/** Advances a ninja by one tick, clipping movement to what's left of its dash so it never overshoots the drag's reach. */
function integrate(ninja: NinjaState): void {
  ninja.vx *= LINEAR_DAMPING_PER_TICK;
  ninja.vy *= LINEAR_DAMPING_PER_TICK;

  if (lengthOf(ninja.vx, ninja.vy) < REST_SPEED) {
    ninja.vx = 0;
    ninja.vy = 0;
  }

  if (ninja.dashBudget <= 0) {
    ninja.vx = 0;
    ninja.vy = 0;
    return;
  }

  let dx = ninja.vx * SIM_DT;
  let dy = ninja.vy * SIM_DT;
  const step = lengthOf(dx, dy);

  if (step >= ninja.dashBudget) {
    const scale = ninja.dashBudget / step;
    dx *= scale;
    dy *= scale;
    ninja.dashBudget = 0;
    ninja.vx = 0;
    ninja.vy = 0;
  } else {
    ninja.dashBudget -= step;
  }

  ninja.x += dx;
  ninja.y += dy;
}

function collideWithObstacles(state: SimState, ninja: NinjaState, events: SimEvent[]): void {
  for (const obstacle of state.obstacles) {
    if (!obstacle.alive) continue;

    const contact = circleAabbContact(ninja, obstacle);
    if (!contact) continue;

    const impact = closingSpeed(ninja, contact);
    if (impact >= MIN_IMPACT_SPEED) {
      const damage = impact * OBSTACLE_DAMAGE_PER_IMPACT_SPEED;
      obstacle.hp -= damage;

      if (obstacle.hp <= 0) {
        obstacle.hp = 0;
        obstacle.alive = false;
        events.push({ type: "obstacleDestroyed", ninjaId: ninja.id, obstacleId: obstacle.id });
      } else {
        events.push({ type: "obstacleHit", ninjaId: ninja.id, obstacleId: obstacle.id, impact, damage });
      }
    }

    // Obstacles stop a dash on contact whether or not the hit breaks them — no bounce-through.
    stopAtContact(ninja, contact);
  }
}

function collideWithWalls(state: SimState, ninja: NinjaState, events: SimEvent[]): void {
  for (const wall of state.map.walls) {
    const contact = circleAabbContact(ninja, wall);
    if (!contact) continue;

    const impact = stopAtContact(ninja, contact);
    if (impact >= MIN_IMPACT_SPEED) {
      events.push({ type: "wallHit", ninjaId: ninja.id, impact });
    }
  }

  // Safety net: geometry should already contain the ninja, but never let one leave the arena.
  ninja.x = clamp(ninja.x, ninja.radius, state.map.width - ninja.radius);
  ninja.y = clamp(ninja.y, ninja.radius, state.map.height - ninja.radius);
}

/**
 * Advances the simulation by exactly one fixed timestep, mutating `state` and returning what happened.
 * Pure apart from that mutation: no clock, no randomness, fixed iteration order — same inputs, same result.
 */
export function step(state: SimState, commands: readonly SimCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];

  for (const command of commands) {
    const ninja = state.ninjas.find((n) => n.id === command.ninjaId);
    if (!ninja || !ninja.active) continue;
    const speed = applyLaunch(ninja, command);
    if (speed > 0) events.push({ type: "launch", ninjaId: ninja.id, speed });
  }

  for (const ninja of state.ninjas) {
    if (ninja.active) integrate(ninja);
  }

  for (const ninja of state.ninjas) {
    if (!ninja.active) continue;
    collideWithObstacles(state, ninja, events);
    collideWithWalls(state, ninja, events);
  }

  for (let i = 0; i < state.ninjas.length; i++) {
    const a = state.ninjas[i];
    if (!a || !a.active) continue;
    for (let j = i + 1; j < state.ninjas.length; j++) {
      const b = state.ninjas[j];
      if (!b || !b.active) continue;
      if (!circlesOverlap(a, b)) continue;

      // A live dash shatters (instant-KOs) whoever it reaches instead of bouncing off them, and carries on
      // through to its target point. If both are mid-dash, `a` (lower index — fixed iteration order) wins;
      // an invulnerable or already-KO'd target can't be shattered, so contact falls through to a soft bump.
      if (a.dashBudget > 0 && b.invulnerableTicks <= 0 && b.respawnTicks <= 0) {
        shatterNinja(a, b, events);
      } else if (b.dashBudget > 0 && a.invulnerableTicks <= 0 && a.respawnTicks <= 0) {
        shatterNinja(b, a, events);
      } else {
        const impact = resolveNinjaPair(a, b, NINJA_RESTITUTION);
        if (impact !== null && impact >= MIN_IMPACT_SPEED) {
          events.push({ type: "ninjaHit", aId: a.id, bId: b.id, impact });
        }
      }
    }
  }

  for (const ninja of state.ninjas) {
    if (ninja.active) {
      // TP only refills while the player is actively holding their ninja — never passively, and never mid-dash.
      if (ninja.charging && ninja.dashBudget <= 0) {
        ninja.tp = Math.min(MAX_TP, ninja.tp + TP_CHARGE_PER_TICK);
      }
      if (ninja.invulnerableTicks > 0) ninja.invulnerableTicks--;
      continue;
    }

    if (ninja.respawnTicks <= 0) continue;
    ninja.respawnTicks--;
    if (ninja.respawnTicks === 0) respawnNinja(state, ninja);
  }

  state.tick++;
  return events;
}

/** `attacker` passes through untouched; `target` is instantly KO'd and starts its respawn countdown. */
function shatterNinja(attacker: NinjaState, target: NinjaState, events: SimEvent[]): void {
  target.hp = 0;
  target.active = false;
  target.vx = 0;
  target.vy = 0;
  target.dashBudget = 0;
  target.charging = false;
  target.invulnerableTicks = 0;
  target.respawnTicks = RESPAWN_DELAY_TICKS;
  attacker.sp = Math.min(MAX_SP, attacker.sp + SP_GAIN_ON_KO);
  events.push({ type: "ninjaKO", targetId: target.id, killerId: attacker.id });
}

function respawnNinja(state: SimState, ninja: NinjaState): void {
  const spawn = bestRespawnPoint(state, ninja.id);
  ninja.x = spawn.x;
  ninja.y = spawn.y;
  ninja.vx = 0;
  ninja.vy = 0;
  ninja.dashBudget = 0;
  ninja.hp = MAX_HP * RESPAWN_HP_FRACTION;
  ninja.tp = MAX_TP;
  ninja.charging = false;
  ninja.invulnerableTicks = RESPAWN_INVULN_TICKS;
  ninja.active = true;
}
