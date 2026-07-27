import { describe, expect, it } from "vitest";
import {
  CROSS_SLASH_LANE_HALF_WIDTH,
  MAX_HP,
  MAX_SP,
  MAX_TP,
  SHOCKWAVE_MAX_DAMAGE,
  SHOCKWAVE_RADIUS,
  SP_GAIN_ON_KO,
  SP_PER_DAMAGE,
  SURGE_DASH_MULTIPLIER,
  SURGE_DURATION_TICKS,
} from "./constants.js";
import { CHARACTERS, ougiForCharacter } from "./ougi.js";
import { applyLaunch, createSimState, step } from "./sim.js";
import { OPEN_ARENA } from "./test-arena.js";
import type { SimCommand, SimState } from "./types.js";

const EMBER = "ember";
const GALE = "gale";
const SHADE = "shade";

/** Open floor, the arena's single crate well out of reach, so an Ougi test only measures the Ougi. */
const CLEAR_X = 200;
const CLEAR_Y = 400;

function arena(characterIds: string[]): SimState {
  const ids = characterIds.map((_, i) => String.fromCharCode(97 + i));
  const state = createSimState(ids, OPEN_ARENA, characterIds);
  // Park everyone out of the way; each test then places only the ninjas it cares about.
  state.ninjas.forEach((ninja, i) => {
    ninja.x = OPEN_ARENA.width - 100;
    ninja.y = 100 + i * 60;
  });
  return state;
}

function fire(id: string): SimCommand[] {
  return [{ type: "ougi", ninjaId: id }];
}

describe("characters", () => {
  it("gives every character a distinct, resolvable Ougi", () => {
    const ougiIds = CHARACTERS.map((c) => ougiForCharacter(c.id).id);
    expect(new Set(ougiIds).size).toBe(CHARACTERS.length);
  });

  it("falls back to the default character for an unknown id", () => {
    expect(ougiForCharacter("not-a-character").id).toBe(ougiForCharacter(CHARACTERS[0]!.id).id);
  });
});

describe("firing", () => {
  it("does nothing unless the meter is full", () => {
    const state = arena([EMBER]);
    const a = state.ninjas[0]!;
    a.sp = MAX_SP - 1;

    const events = step(state, fire("a"));

    expect(events.some((e) => e.type === "ougiFired")).toBe(false);
    expect(a.sp).toBe(MAX_SP - 1);
  });

  it("spends the whole meter and reports which Ougi fired", () => {
    const state = arena([EMBER]);
    const a = state.ninjas[0]!;
    a.sp = MAX_SP;

    const events = step(state, fire("a"));

    expect(events).toContainEqual({ type: "ougiFired", ninjaId: "a", ougiId: "shockwave" });
    expect(a.sp).toBe(0);
  });
});

describe("shockwave", () => {
  it("damages a nearby enemy, paying the caster SP for the damage", () => {
    const state = arena([EMBER, GALE]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X + SHOCKWAVE_RADIUS / 2;
    b.y = CLEAR_Y;
    a.sp = MAX_SP;

    const events = step(state, fire("a"));

    // Half-radius means half the damage, and SP is paid back at the per-damage rate.
    expect(b.hp).toBeCloseTo(MAX_HP - SHOCKWAVE_MAX_DAMAGE / 2, 5);
    expect(events.some((e) => e.type === "ninjaDamaged" && e.targetId === "b")).toBe(true);
    expect(a.sp).toBeCloseTo((SHOCKWAVE_MAX_DAMAGE / 2) * SP_PER_DAMAGE, 5);
  });

  it("leaves the enemy standing where the blast caught it", () => {
    const state = arena([EMBER, GALE]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X + 40;
    b.y = CLEAR_Y;
    a.sp = MAX_SP;

    step(state, fire("a"));
    for (let tick = 0; tick < 20; tick++) step(state);

    // The burst is damage only, so there is no budget to travel and no way to be flung into a third party.
    expect(b.x).toBe(CLEAR_X + 40);
    expect(b.y).toBe(CLEAR_Y);
    expect(b).toMatchObject({ dashBudget: 0, vx: 0, vy: 0 });
  });

  it("leaves an out-of-range enemy untouched", () => {
    const state = arena([EMBER, GALE]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X + SHOCKWAVE_RADIUS + 1;
    b.y = CLEAR_Y;
    a.sp = MAX_SP;

    step(state, fire("a"));

    expect(b.hp).toBe(MAX_HP);
    expect(a.sp).toBe(0);
  });

  it("KOs an enemy the blast finishes off, crediting the caster", () => {
    const state = arena([EMBER, GALE]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X + 40;
    b.y = CLEAR_Y;
    b.hp = 5;
    a.sp = MAX_SP;

    const events = step(state, fire("a"));

    expect(events).toContainEqual({ type: "ninjaKO", targetId: "b", killerId: "a" });
    expect(b.active).toBe(false);
    expect(a.sp).toBeGreaterThanOrEqual(SP_GAIN_ON_KO);
  });

  it("clears destructible cover inside the blast", () => {
    const state = arena([EMBER]);
    const a = state.ninjas[0]!;
    const target = state.obstacles[0]!;
    a.x = target.x;
    a.y = target.y - 60;
    a.sp = MAX_SP;

    step(state, fire("a"));

    expect(target.alive).toBe(false);
  });
});

describe("surge", () => {
  it("doubles dash reach for its duration, then restores it", () => {
    const state = arena([GALE]);
    const a = state.ninjas[0]!;
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    a.sp = MAX_SP;

    step(state, fire("a"));
    expect(a.dashRangeMultiplier).toBe(SURGE_DASH_MULTIPLIER);
    expect(a.tp).toBe(MAX_TP * SURGE_DASH_MULTIPLIER);

    const buffed = applyLaunch(a, { type: "launch", ninjaId: "a", dirX: 0, dirY: 1, power: 1 }, OPEN_ARENA.grid);
    expect(buffed).toBeGreaterThan(0);
    expect(a.dashBudget).toBe(MAX_TP * SURGE_DASH_MULTIPLIER);

    a.dashBudget = 0;
    for (let i = 0; i < SURGE_DURATION_TICKS; i++) step(state);

    expect(a.ougiTicks).toBe(0);
    expect(a.dashRangeMultiplier).toBe(1);
    expect(a.tp).toBeLessThanOrEqual(MAX_TP);
  });

  it("keeps TP topped up between dashes while it runs", () => {
    const state = arena([GALE]);
    const a = state.ninjas[0]!;
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    a.sp = MAX_SP;

    step(state, fire("a"));
    a.tp = 0;
    step(state);

    expect(a.tp).toBe(MAX_TP * SURGE_DASH_MULTIPLIER);
  });

  it("is cancelled by a KO so the buff can't outlive the ninja", () => {
    const state = arena([GALE, SHADE]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    a.sp = MAX_SP;
    step(state, fire("a"));
    expect(a.ougiTicks).toBeGreaterThan(0);

    b.hp = MAX_HP;
    b.sp = MAX_SP;
    b.x = CLEAR_X;
    b.y = CLEAR_Y - 200;
    step(state, fire("b"));

    expect(a.active).toBe(false);
    expect(a.ougiTicks).toBe(0);
    expect(a.dashRangeMultiplier).toBe(1);
  });
});

describe("cross slash", () => {
  it("shatters an enemy standing in a lane", () => {
    const state = arena([SHADE, EMBER]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X;
    b.y = CLEAR_Y - 200;
    a.sp = MAX_SP;

    const events = step(state, fire("a"));

    expect(events).toContainEqual({ type: "ninjaKO", targetId: "b", killerId: "a" });
    expect(a.sp).toBe(SP_GAIN_ON_KO);
  });

  it("misses an enemy standing outside the lane", () => {
    const state = arena([SHADE, EMBER]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X + b.radius + CROSS_SLASH_LANE_HALF_WIDTH + 2;
    b.y = CLEAR_Y - 200;
    a.sp = MAX_SP;

    step(state, fire("a"));

    expect(b.active).toBe(true);
  });

  it("is blocked by the obstacle it cleaves, sparing anyone behind it", () => {
    const state = arena([SHADE, EMBER]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    // Between the first two obstacle rows, so the beam's first blocker is `cover` and `b` sits behind it.
    const cover = state.obstacles[0]!;
    a.x = cover.x;
    a.y = cover.y - 80;
    b.x = cover.x;
    b.y = cover.y + 260;
    a.sp = MAX_SP;

    const events = step(state, fire("a"));

    expect(cover.alive).toBe(false);
    expect(events).toContainEqual({ type: "obstacleDestroyed", ninjaId: "a", obstacleId: cover.id });
    expect(b.active).toBe(true);
  });

  it("is not blocked by cover the caster is standing beside", () => {
    const state = arena([SHADE, EMBER]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    // Hugging the top edge of a box: it clips the horizontal lane but sits beside the caster, not ahead.
    const cover = state.obstacles[0]!;
    a.x = cover.x;
    a.y = cover.y - cover.halfH - a.radius;
    b.x = cover.x - 260;
    b.y = a.y;
    a.sp = MAX_SP;

    step(state, fire("a"));

    expect(b.active).toBe(false);
  });

  it("can't touch an invulnerable enemy", () => {
    const state = arena([SHADE, EMBER]);
    const [a, b] = state.ninjas as [SimState["ninjas"][number], SimState["ninjas"][number]];
    a.x = CLEAR_X;
    a.y = CLEAR_Y;
    b.x = CLEAR_X;
    b.y = CLEAR_Y - 200;
    b.invulnerableTicks = 30;
    a.sp = MAX_SP;

    step(state, fire("a"));

    expect(b.active).toBe(true);
  });
});

describe("determinism", () => {
  it("produces bit-identical state from identical Ougi scripts", () => {
    const script = (state: SimState): void => {
      for (let tick = 0; tick < 200; tick++) {
        const commands: SimCommand[] = [];
        if (tick % 40 === 0) {
          for (const ninja of state.ninjas) {
            ninja.sp = MAX_SP;
            commands.push({ type: "ougi", ninjaId: ninja.id });
          }
        }
        step(state, commands);
      }
    };

    const characterIds = [EMBER, GALE, SHADE];
    const a = createSimState(["a", "b", "c"], OPEN_ARENA, characterIds);
    const b = createSimState(["a", "b", "c"], OPEN_ARENA, characterIds);
    script(a);
    script(b);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
