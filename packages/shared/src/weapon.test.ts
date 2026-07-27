import { describe, expect, it } from "vitest";
import {
  CELL,
  CRATE_HP,
  FAN_DAMAGE,
  KUNAI_COOLDOWN_TICKS,
  KUNAI_DAMAGE,
  LONGSWORD_DAMAGE,
  MAX_HP,
  MAX_TP,
  RESPAWN_INVULN_TICKS,
  SP_PER_DAMAGE,
} from "./constants.js";
import { createSimState, step } from "./sim.js";
import { OPEN_ARENA } from "./test-arena.js";
import type { NinjaState, SimCommand, SimState } from "./types.js";
import { DEFAULT_WEAPON_ID, WEAPONS, attackCells, weaponFor } from "./weapon.js";

const KUNAI = "kunai";
const FAN = "fan";
const LONGSWORD = "longsword";

/** The open arena's only crate, at cell (6, 4). Every other cell around it is clear floor. */
const CRATE_X = 560;
const CRATE_Y = 400;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Every ninja parked far from the crate and from each other; each test then places what it cares about. */
function arena(weaponIds: string[]): SimState {
  const ids = weaponIds.map((_, i) => String.fromCharCode(97 + i));
  const state = createSimState(ids, OPEN_ARENA, [], weaponIds);
  state.ninjas.forEach((ninja, i) => {
    ninja.x = 80;
    ninja.y = 80 + i * CELL;
  });
  return state;
}

function place(ninja: NinjaState, x: number, y: number): NinjaState {
  ninja.x = x;
  ninja.y = y;
  return ninja;
}

function swing(id: string, dirX: number, dirY: number): SimCommand[] {
  return [{ type: "attack", ninjaId: id, dirX, dirY }];
}

describe("weapon table", () => {
  it("gives every weapon a distinct id and a nonempty pattern", () => {
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    for (const weapon of WEAPONS) {
      expect(weapon.cells.length).toBeGreaterThan(0);
      expect(weapon.damage).toBeGreaterThan(0);
      expect(weapon.cooldownTicks).toBeGreaterThan(0);
    }
  });

  it("falls back to the default weapon for an unknown id", () => {
    expect(weaponFor("not-a-weapon").id).toBe(DEFAULT_WEAPON_ID);
  });

  it("authors every pattern nearest-first within a lane, which is what lets cover block a cell", () => {
    for (const weapon of WEAPONS) {
      const nearest = new Map<number, number>();
      for (const cell of weapon.cells) {
        const previous = nearest.get(cell.lateral);
        if (previous !== undefined) expect(cell.forward).toBeGreaterThan(previous);
        nearest.set(cell.lateral, cell.forward);
      }
    }
  });

  it("trades reach and coverage against sustained damage rather than stacking them", () => {
    const kunai = weaponFor(KUNAI);
    const longsword = weaponFor(LONGSWORD);
    expect(longsword.damage).toBeGreaterThan(kunai.damage);
    expect(longsword.cooldownTicks).toBeGreaterThan(kunai.cooldownTicks);
  });
});

describe("attack patterns", () => {
  it("hits the ninja one cell in front for exactly the weapon's damage", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP - KUNAI_DAMAGE);
    expect(a.sp).toBe(KUNAI_DAMAGE * SP_PER_DAMAGE);
  });

  it("does not reach two cells with a one-cell weapon", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL * 2, 400);

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP);
  });

  it("reaches the second cell with the longsword", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL * 2, 400);

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP - LONGSWORD_DAMAGE);
  });

  it("catches all three approach angles with the fan", () => {
    const state = arena([FAN, KUNAI, KUNAI, KUNAI]);
    const [a, b, c, d] = state.ninjas as [NinjaState, NinjaState, NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);
    place(c, 240 + CELL, 400 - CELL);
    place(d, 240 + CELL, 400 + CELL);

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP - FAN_DAMAGE);
    expect(c.hp).toBe(MAX_HP - FAN_DAMAGE);
    expect(d.hp).toBe(MAX_HP - FAN_DAMAGE);
  });

  it("damages a body straddling two cells of one swing only once", () => {
    const state = arena([FAN, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    // Exactly on the seam between the fan's front and front-left cells.
    place(b, 240 + CELL, 400 - CELL / 2);

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP - FAN_DAMAGE);
  });

  it("rotates the pattern with the swing direction", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240, 400 - CELL);

    step(state, swing("a", 0, -1));

    expect(b.hp).toBe(MAX_HP - KUNAI_DAMAGE);
  });

  it("snaps a diagonal swing to a cardinal, like movement", () => {
    const state = arena([KUNAI, KUNAI, KUNAI]);
    const [a, b, c] = state.ninjas as [NinjaState, NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);
    place(c, 240, 400 + CELL);

    // Mostly right, slightly down: resolves to the dominant axis and hits only the ninja to the right.
    step(state, swing("a", 1, 0.4));

    expect(b.hp).toBe(MAX_HP - KUNAI_DAMAGE);
    expect(c.hp).toBe(MAX_HP);
  });

  it("measures the pattern from the attacker's cell, so an off-grid ninja still hits grid cells", () => {
    const state = arena([KUNAI]);
    const a = place(state.ninjas[0]!, 240 + 31, 400 - 12);
    const [cell] = attackCells(state, a, { x: 1, y: 0 }, weaponFor(KUNAI));

    expect(cell).toEqual({ x: 240 + CELL, y: 400, halfW: CELL / 2, halfH: CELL / 2 });
  });

  it("never hits the attacker itself", () => {
    const state = arena([FAN]);
    const a = place(state.ninjas[0]!, 240, 400);

    step(state, swing("a", 1, 0));

    expect(a.hp).toBe(MAX_HP);
  });
});

describe("cover", () => {
  it("stops a swing at a live obstacle instead of reaching past it", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, CRATE_X - CELL, CRATE_Y);
    place(b, CRATE_X + CELL, CRATE_Y);

    step(state, swing("a", 1, 0));

    expect(state.obstacles[0]!.hp).toBe(CRATE_HP - LONGSWORD_DAMAGE);
    expect(b.hp).toBe(MAX_HP);
  });

  it("blocks a lane on a wall cell but still spends the swing", () => {
    const state = arena([KUNAI]);
    // Leftmost column: the cell in front is inside the border wall.
    const a = place(state.ninjas[0]!, 80, 400);

    const events = step(state, swing("a", -1, 0));

    expect(attackCells(state, a, { x: -1, y: 0 }, weaponFor(KUNAI))).toHaveLength(0);
    expect(events.filter((e) => e.type === "ninjaAttacked")).toHaveLength(1);
    expect(a.attackCooldown).toBe(KUNAI_COOLDOWN_TICKS - 1);
  });

  it("blocks only the lane the cover is in", () => {
    const state = arena([FAN, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, CRATE_X - CELL, CRATE_Y);
    place(b, CRATE_X, CRATE_Y - CELL);

    step(state, swing("a", 1, 0));

    // The crate is in the front lane; the front-left cell beside it is untouched by that.
    expect(b.hp).toBe(MAX_HP - FAN_DAMAGE);
  });
});

describe("obstacles", () => {
  it("chips a destructible and reports the hit", () => {
    const state = arena([KUNAI]);
    place(state.ninjas[0]!, CRATE_X - CELL, CRATE_Y);

    const events = step(state, swing("a", 1, 0));
    const hit = events.find((e) => e.type === "obstacleHit");

    expect(state.obstacles[0]!.hp).toBe(CRATE_HP - KUNAI_DAMAGE);
    expect(hit).toEqual({
      type: "obstacleHit",
      ninjaId: "a",
      obstacleId: 0,
      impact: 0,
      damage: KUNAI_DAMAGE,
    });
  });

  it("opens a lane through the grid after enough swings", () => {
    const state = arena([KUNAI]);
    place(state.ninjas[0]!, CRATE_X - CELL, CRATE_Y);

    let destroyed = false;
    for (let tick = 0; tick < 400 && !destroyed; tick++) {
      const events = step(state, swing("a", 1, 0));
      destroyed = events.some((e) => e.type === "obstacleDestroyed");
    }

    expect(destroyed).toBe(true);
    expect(state.obstacles[0]!.alive).toBe(false);
    expect(state.obstacles[0]!.hp).toBe(0);
  });
});

describe("cooldown", () => {
  it("drops an attack arriving during the cooldown rather than buffering it", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);

    step(state, swing("a", 1, 0));
    const afterFirst = b.hp;

    // Spam every tick of the cooldown window; none of it lands, and none of it is queued up either.
    for (let tick = 0; tick < KUNAI_COOLDOWN_TICKS - 1; tick++) step(state, swing("a", 1, 0));

    expect(b.hp).toBe(afterFirst);
    expect(a.attackCooldown).toBe(0);
  });

  it("allows the next swing once the cooldown expires", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);

    step(state, swing("a", 1, 0));
    for (let tick = 0; tick < KUNAI_COOLDOWN_TICKS - 1; tick++) step(state);
    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP - KUNAI_DAMAGE * 2);
  });

  it("costs no TP", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);

    step(state, swing("a", 1, 0));

    expect(a.tp).toBe(MAX_TP);
  });
});

describe("facing", () => {
  it("starts facing down the screen", () => {
    const state = arena([KUNAI]);
    expect(state.ninjas[0]!).toMatchObject({ facingX: 0, facingY: 1 });
  });

  it("is set by a swing", () => {
    const state = arena([KUNAI]);
    step(state, swing("a", -1, 0));
    expect(state.ninjas[0]!).toMatchObject({ facingX: -1, facingY: 0 });
  });

  it("is set by a dash too, so a dash aims the next swing", () => {
    const state = arena([KUNAI, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240, 400 - CELL * 2);

    // One cell up, then let the dash land.
    step(state, [{ type: "launch", ninjaId: "a", dirX: 0, dirY: -1, power: CELL / MAX_TP }]);
    for (let tick = 0; tick < 10; tick++) step(state);

    expect(a).toMatchObject({ facingX: 0, facingY: -1, dashBudget: 0 });

    // A swing with no direction of its own reuses that facing rather than eating the input.
    step(state, swing("a", 0, 0));
    expect(b.hp).toBe(MAX_HP - KUNAI_DAMAGE);
  });
});

describe("damage rules", () => {
  it("chips rather than instant-killing, so a full-HP target survives any single swing", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);

    step(state, swing("a", 1, 0));

    expect(b.active).toBe(true);
    expect(b.hp).toBeGreaterThan(0);
  });

  it("KOs at 0 HP and credits the swinger", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);
    b.hp = LONGSWORD_DAMAGE;

    const events = step(state, swing("a", 1, 0));

    expect(b.active).toBe(false);
    expect(events).toContainEqual({ type: "ninjaKO", targetId: "b", killerId: "a" });
  });

  it("cannot touch an invulnerable target", () => {
    const state = arena([LONGSWORD, KUNAI]);
    const [a, b] = state.ninjas as [NinjaState, NinjaState];
    place(a, 240, 400);
    place(b, 240 + CELL, 400);
    b.invulnerableTicks = RESPAWN_INVULN_TICKS;

    step(state, swing("a", 1, 0));

    expect(b.hp).toBe(MAX_HP);
    expect(a.sp).toBe(0);
  });

  it("reports the swing itself so the client can animate one it didn't predict", () => {
    const state = arena([FAN]);
    place(state.ninjas[0]!, 240, 400);

    const events = step(state, swing("a", 0, 1));

    expect(events).toContainEqual({
      type: "ninjaAttacked",
      ninjaId: "a",
      weaponId: FAN,
      dirX: 0,
      dirY: 1,
    });
  });
});

describe("determinism", () => {
  function runScript(seed: number, ticks: number): SimState {
    const state = createSimState(["a", "b", "c", "d"], OPEN_ARENA, [], [KUNAI, FAN, LONGSWORD, FAN]);
    const rand = lcg(seed);

    for (let tick = 0; tick < ticks; tick++) {
      const commands: SimCommand[] = [];
      for (const ninja of state.ninjas) {
        const roll = rand();
        if (roll < 0.2) {
          commands.push({
            type: "attack",
            ninjaId: ninja.id,
            dirX: rand() * 2 - 1,
            dirY: rand() * 2 - 1,
          });
        } else if (roll < 0.28) {
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

  it("produces bit-identical state for identical scripts of dashes and swings", () => {
    const a = runScript(4242, 900);
    const b = runScript(4242, 900);

    expect(a.tick).toBe(900);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
