import { describe, expect, it } from "vitest";
import {
  LAUNCH_SPEED_MAX,
  LAUNCH_SPEED_MIN,
  MAX_DASH_DISTANCE,
  MIN_IMPACT_SPEED,
  NINJA_RADIUS,
  OBSTACLE_HP,
} from "./constants.js";
import { DOJO_ARENA } from "./map.js";
import { applyLaunch, createNinja, createSimState, resetObstacles, spawnPointFor, step } from "./sim.js";
import { lengthOf } from "./math.js";
import type { SimCommand, SimState } from "./types.js";

function speedOf(state: SimState, id: string): number {
  const ninja = state.ninjas.find((n) => n.id === id)!;
  return lengthOf(ninja.vx, ninja.vy);
}

/** Deterministic pseudo-random source; the sim itself must never contain one. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("createSimState", () => {
  it("seats ninjas on distinct spawns with a full obstacle grid", () => {
    const state = createSimState(["a", "b", "c", "d"]);

    expect(state.tick).toBe(0);
    expect(state.ninjas).toHaveLength(4);
    state.ninjas.forEach((ninja, index) => {
      expect({ x: ninja.x, y: ninja.y }).toEqual(spawnPointFor(DOJO_ARENA, index));
      expect(ninja.vx).toBe(0);
    });
    expect(state.obstacles).toHaveLength(DOJO_ARENA.obstacles.length);
    expect(state.obstacles.every((o) => o.alive && o.hp === OBSTACLE_HP)).toBe(true);
  });

  it("wraps spawn indices past the map's spawn count", () => {
    expect(spawnPointFor(DOJO_ARENA, DOJO_ARENA.spawns.length)).toEqual(spawnPointFor(DOJO_ARENA, 0));
  });
});

describe("applyLaunch", () => {
  it("normalises the drag direction and maps power onto the speed range", () => {
    const ninja = createNinja("a", { x: 0, y: 0 });

    expect(applyLaunch(ninja, { type: "launch", ninjaId: "a", dirX: 3, dirY: 4, power: 1 })).toBeCloseTo(
      LAUNCH_SPEED_MAX,
    );
    expect(lengthOf(ninja.vx, ninja.vy)).toBeCloseTo(LAUNCH_SPEED_MAX);
    expect(ninja.vx).toBeCloseTo(LAUNCH_SPEED_MAX * 0.6);
    expect(ninja.dashBudget).toBeCloseTo(MAX_DASH_DISTANCE);
  });

  it("clamps power outside 0..1 and ignores a zero-length drag", () => {
    const ninja = createNinja("a", { x: 0, y: 0 });

    applyLaunch(ninja, { type: "launch", ninjaId: "a", dirX: 1, dirY: 0, power: -3 });
    expect(ninja.vx).toBeCloseTo(LAUNCH_SPEED_MIN);

    applyLaunch(ninja, { type: "launch", ninjaId: "a", dirX: 1, dirY: 0, power: 9 });
    expect(ninja.vx).toBeCloseTo(LAUNCH_SPEED_MAX);

    expect(applyLaunch(ninja, { type: "launch", ninjaId: "a", dirX: 0, dirY: 0, power: 1 })).toBe(0);
    expect(ninja.vx).toBeCloseTo(LAUNCH_SPEED_MAX);
  });
});

describe("step", () => {
  it("advances the tick counter once per call", () => {
    const state = createSimState(["a"]);
    step(state);
    step(state);
    expect(state.tick).toBe(2);
  });

  it("damps a dash to a full stop rather than drifting forever", () => {
    const state = createSimState(["a"]);
    const events = step(state, [{ type: "launch", ninjaId: "a", dirX: 1, dirY: 0, power: 1 }]);

    expect(events).toEqual([{ type: "launch", ninjaId: "a", speed: LAUNCH_SPEED_MAX }]);
    expect(speedOf(state, "a")).toBeGreaterThan(0);

    for (let i = 0; i < 120; i++) step(state);
    expect(speedOf(state, "a")).toBe(0);
  });

  it("ignores commands for unknown or inactive ninjas", () => {
    const state = createSimState(["a", "b"]);
    state.ninjas[1]!.active = false;

    const events = step(state, [
      { type: "launch", ninjaId: "ghost", dirX: 1, dirY: 0, power: 1 },
      { type: "launch", ninjaId: "b", dirX: 1, dirY: 0, power: 1 },
    ]);

    expect(events).toHaveLength(0);
    expect(speedOf(state, "b")).toBe(0);
  });

  it("stops a ninja at a wall instead of bouncing, and reports the impact", () => {
    const state = createSimState(["a"]);
    const ninja = state.ninjas[0]!;
    ninja.x = 100;
    ninja.y = 100;

    let wallHits = 0;
    for (let i = 0; i < 30; i++) {
      const events = step(state, i === 0 ? [{ type: "launch", ninjaId: "a", dirX: -1, dirY: 0, power: 1 }] : []);
      wallHits += events.filter((e) => e.type === "wallHit").length;
    }

    expect(wallHits).toBeGreaterThan(0);
    expect(ninja.x).toBeGreaterThanOrEqual(40 + NINJA_RADIUS);
    expect(ninja.vx).toBe(0);
    expect(ninja.dashBudget).toBe(0);
  });

  it("damages an obstacle and stops the dash when the hit does not break it", () => {
    const state = createSimState(["a"]);
    const obstacle = state.obstacles[0]!;
    obstacle.hp = 10_000;

    const ninja = state.ninjas[0]!;
    ninja.x = obstacle.x - obstacle.halfW - NINJA_RADIUS - 5;
    ninja.y = obstacle.y;
    ninja.vx = LAUNCH_SPEED_MAX;
    ninja.dashBudget = MAX_DASH_DISTANCE;

    const events = step(state);
    const hit = events.find((e) => e.type === "obstacleHit");

    expect(hit).toBeDefined();
    expect(obstacle.alive).toBe(true);
    expect(obstacle.hp).toBeLessThan(10_000);
    expect(ninja.vx).toBe(0);
    expect(ninja.dashBudget).toBe(0);
  });

  it("shatters an obstacle on a hard hit but still stops the dash there", () => {
    const state = createSimState(["a"]);
    const obstacle = state.obstacles[0]!;
    const ninja = state.ninjas[0]!;
    ninja.x = obstacle.x - obstacle.halfW - NINJA_RADIUS - 5;
    ninja.y = obstacle.y;
    ninja.vx = LAUNCH_SPEED_MAX;
    ninja.dashBudget = MAX_DASH_DISTANCE;

    const events = step(state);

    expect(events).toContainEqual({ type: "obstacleDestroyed", ninjaId: "a", obstacleId: obstacle.id });
    expect(obstacle.alive).toBe(false);
    expect(obstacle.hp).toBe(0);
    expect(ninja.vx).toBe(0);
    expect(ninja.dashBudget).toBe(0);
  });

  it("leaves a destroyed obstacle out of the sim on later ticks", () => {
    const state = createSimState(["a"]);
    const obstacle = state.obstacles[0]!;
    obstacle.alive = false;

    const ninja = state.ninjas[0]!;
    ninja.x = obstacle.x;
    ninja.y = obstacle.y;
    ninja.vx = 300;
    ninja.dashBudget = MAX_DASH_DISTANCE;

    const events = step(state);
    expect(events).toHaveLength(0);
    expect(ninja.vx).toBeGreaterThan(0);
  });

  it("ignores nudges below the impact threshold", () => {
    const state = createSimState(["a"]);
    const obstacle = state.obstacles[0]!;
    const ninja = state.ninjas[0]!;
    ninja.x = obstacle.x - obstacle.halfW - NINJA_RADIUS - 1;
    ninja.y = obstacle.y;
    ninja.vx = MIN_IMPACT_SPEED - 40;
    ninja.dashBudget = MAX_DASH_DISTANCE;

    const events = step(state);

    expect(events).toHaveLength(0);
    expect(obstacle.hp).toBe(OBSTACLE_HP);
  });

  it("knocks back the ninja that gets hit", () => {
    const state = createSimState(["a", "b"]);
    const [a, b] = state.ninjas as [(typeof state.ninjas)[number], (typeof state.ninjas)[number]];
    a.x = 300;
    a.y = 300;
    b.x = 300 + NINJA_RADIUS * 2 + 20;
    b.y = 300;
    a.vx = LAUNCH_SPEED_MAX;
    a.dashBudget = MAX_DASH_DISTANCE;

    let hit: Extract<ReturnType<typeof step>[number], { type: "ninjaHit" }> | undefined;
    for (let i = 0; i < 5 && !hit; i++) {
      hit = step(state).find((e) => e.type === "ninjaHit");
    }

    expect(hit).toBeDefined();
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x - a.x).toBeGreaterThanOrEqual(NINJA_RADIUS * 2);
  });

  it("resetObstacles restores the grid without moving ninjas", () => {
    const state = createSimState(["a"]);
    state.obstacles[0]!.alive = false;
    state.ninjas[0]!.x = 500;

    resetObstacles(state);

    expect(state.obstacles.every((o) => o.alive && o.hp === OBSTACLE_HP)).toBe(true);
    expect(state.ninjas[0]!.x).toBe(500);
  });
});

describe("determinism", () => {
  function runScript(seed: number, ticks: number): SimState {
    const state = createSimState(["a", "b", "c", "d"]);
    const rand = lcg(seed);

    for (let tick = 0; tick < ticks; tick++) {
      const commands: SimCommand[] = [];
      for (const ninja of state.ninjas) {
        if (rand() < 0.08) {
          commands.push({
            type: "launch",
            ninjaId: ninja.id,
            dirX: rand() * 2 - 1,
            dirY: rand() * 2 - 1,
            power: rand(),
          });
        }
      }
      step(state, commands);
    }
    return state;
  }

  it("produces bit-identical state for identical input scripts", () => {
    const a = runScript(1234, 900);
    const b = runScript(1234, 900);

    expect(a.tick).toBe(900);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps every ninja inside the arena and finite over a long chaotic match", () => {
    const state = runScript(99, 3600);

    for (const ninja of state.ninjas) {
      expect(Number.isFinite(ninja.x) && Number.isFinite(ninja.y)).toBe(true);
      expect(ninja.x).toBeGreaterThanOrEqual(ninja.radius);
      expect(ninja.x).toBeLessThanOrEqual(DOJO_ARENA.width - ninja.radius);
      expect(ninja.y).toBeGreaterThanOrEqual(ninja.radius);
      expect(ninja.y).toBeLessThanOrEqual(DOJO_ARENA.height - ninja.radius);
    }
  });

  it("never leaves ninjas overlapping after a tick", () => {
    const state = runScript(7, 1200);

    for (let i = 0; i < state.ninjas.length; i++) {
      for (let j = i + 1; j < state.ninjas.length; j++) {
        const a = state.ninjas[i]!;
        const b = state.ninjas[j]!;
        expect(lengthOf(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-9);
      }
    }
  });
});
