import { circleAabbContact, closingSpeed, resolveNinjaPair, resolveStaticContact } from "./collision.js";
import {
  LAUNCH_SPEED_MAX,
  LAUNCH_SPEED_MIN,
  LINEAR_DAMPING_PER_TICK,
  MIN_IMPACT_SPEED,
  NINJA_RADIUS,
  NINJA_RESTITUTION,
  OBSTACLE_DAMAGE_PER_IMPACT_SPEED,
  OBSTACLE_HP,
  OBSTACLE_RESTITUTION,
  REST_SPEED,
  SIM_DT,
  WALL_RESTITUTION,
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
  return { id, x: spawn.x, y: spawn.y, vx: 0, vy: 0, radius: NINJA_RADIUS, active: true };
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
  const speed = LAUNCH_SPEED_MIN + (LAUNCH_SPEED_MAX - LAUNCH_SPEED_MIN) * power;
  ninja.vx = (command.dirX / len) * speed;
  ninja.vy = (command.dirY / len) * speed;
  return speed;
}

function integrate(ninja: NinjaState): void {
  ninja.vx *= LINEAR_DAMPING_PER_TICK;
  ninja.vy *= LINEAR_DAMPING_PER_TICK;

  if (lengthOf(ninja.vx, ninja.vy) < REST_SPEED) {
    ninja.vx = 0;
    ninja.vy = 0;
  }

  ninja.x += ninja.vx * SIM_DT;
  ninja.y += ninja.vy * SIM_DT;
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
        // Shattered obstacles stop existing this tick, so the dash carries through instead of bouncing.
        obstacle.hp = 0;
        obstacle.alive = false;
        events.push({ type: "obstacleDestroyed", ninjaId: ninja.id, obstacleId: obstacle.id });
        continue;
      }
      events.push({ type: "obstacleHit", ninjaId: ninja.id, obstacleId: obstacle.id, impact, damage });
    }

    resolveStaticContact(ninja, contact, OBSTACLE_RESTITUTION);
  }
}

function collideWithWalls(state: SimState, ninja: NinjaState, events: SimEvent[]): void {
  for (const wall of state.map.walls) {
    const contact = circleAabbContact(ninja, wall);
    if (!contact) continue;

    const impact = resolveStaticContact(ninja, contact, WALL_RESTITUTION);
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

      const impact = resolveNinjaPair(a, b, NINJA_RESTITUTION);
      if (impact !== null && impact >= MIN_IMPACT_SPEED) {
        events.push({ type: "ninjaHit", aId: a.id, bId: b.id, impact });
      }
    }
  }

  state.tick++;
  return events;
}
