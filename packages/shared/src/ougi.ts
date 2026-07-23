import {
  CROSS_SLASH_LANE_HALF_WIDTH,
  MAX_SP,
  MAX_TP,
  SHOCKWAVE_KNOCKBACK_DISTANCE,
  SHOCKWAVE_KNOCKBACK_SPEED,
  SHOCKWAVE_MAX_DAMAGE,
  SHOCKWAVE_RADIUS,
  SURGE_DASH_MULTIPLIER,
  SURGE_DURATION_TICKS,
} from "./constants.js";
import { damageNinja, isVulnerable, shatterNinja } from "./damage.js";
import { closestPointOnAabb, laneDistance, lengthOf } from "./math.js";
import type { NinjaState, ObstacleState, SimEvent, SimState } from "./types.js";

/**
 * An ultimate, expressed as effect functions over the sim. Definitions are pure and deterministic like the
 * rest of the sim, but only the authoritative room ever fires them — the client's prediction sim never does.
 *
 * A duration Ougi may only buff through generic `NinjaState` modifier fields (`dashRangeMultiplier`), never
 * through state of its own, so a KO mid-Ougi can clear every buff without knowing which Ougi was running.
 */
export interface OugiDefinition {
  id: string;
  name: string;
  description: string;
  /** 0 for an instant Ougi; otherwise how many ticks `onTick` runs for after `onFire`. */
  durationTicks: number;
  onFire(state: SimState, ninja: NinjaState, events: SimEvent[]): void;
  onTick?(state: SimState, ninja: NinjaState, events: SimEvent[]): void;
  onEnd?(state: SimState, ninja: NinjaState): void;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  ougiId: string;
}

/** Radial burst: chips everyone nearby, flings them outward, and clears the destructible cover around you. */
const SHOCKWAVE: OugiDefinition = {
  id: "shockwave",
  name: "Shockwave",
  description: "Burst outward: damages and flings everyone nearby, and shatters cover in the blast.",
  durationTicks: 0,
  onFire(state, ninja, events) {
    for (const other of state.ninjas) {
      if (other === ninja || !isVulnerable(other)) continue;

      const dx = other.x - ninja.x;
      const dy = other.y - ninja.y;
      const dist = lengthOf(dx, dy);
      if (dist >= SHOCKWAVE_RADIUS) continue;

      const falloff = 1 - dist / SHOCKWAVE_RADIUS;
      // Perfectly stacked bodies have no direction; pick a fixed axis so the result stays reproducible.
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;

      damageNinja(other, SHOCKWAVE_MAX_DAMAGE * falloff, ninja, events);
      if (!other.active) continue;

      // Knockback rides the same budget a dash uses, but is never lethal — being flung shouldn't shatter people.
      other.vx = nx * SHOCKWAVE_KNOCKBACK_SPEED;
      other.vy = ny * SHOCKWAVE_KNOCKBACK_SPEED;
      other.dashBudget = SHOCKWAVE_KNOCKBACK_DISTANCE * falloff;
      other.dashLethal = false;
    }

    for (const obstacle of state.obstacles) {
      if (!obstacle.alive) continue;
      const cp = closestPointOnAabb(obstacle, ninja.x, ninja.y);
      if (lengthOf(ninja.x - cp.x, ninja.y - cp.y) >= SHOCKWAVE_RADIUS) continue;
      obstacle.hp = 0;
      obstacle.alive = false;
      events.push({ type: "obstacleDestroyed", ninjaId: ninja.id, obstacleId: obstacle.id });
    }
  },
};

/** Mobility ultimate: for its duration your dash reaches twice as far and TP never runs dry. */
const SURGE: OugiDefinition = {
  id: "surge",
  name: "Surge",
  description: "For 5 seconds your dash reaches twice as far and TP refills instantly between dashes.",
  durationTicks: SURGE_DURATION_TICKS,
  onFire(_state, ninja) {
    ninja.dashRangeMultiplier = SURGE_DASH_MULTIPLIER;
    ninja.tp = maxTpOf(ninja);
  },
  onTick(_state, ninja) {
    // Topped up every tick rather than made free, so the TP cap still bounds a single dash.
    if (ninja.dashBudget <= 0) ninja.tp = maxTpOf(ninja);
  },
  onEnd(_state, ninja) {
    ninja.dashRangeMultiplier = 1;
    ninja.tp = Math.min(ninja.tp, MAX_TP);
  },
};

const CARDINALS: readonly { x: number; y: number }[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Four instant beams along the cardinal axes, each stopping at the first wall or obstacle it cleaves. */
const CROSS_SLASH: OugiDefinition = {
  id: "crossSlash",
  name: "Cross Slash",
  description: "Instant beams up, down, left and right — anyone caught in a lane is shattered.",
  durationTicks: 0,
  onFire(state, ninja, events) {
    // Every beam is measured against the same starting grid, so one lane's break can't lengthen another.
    const beams = CARDINALS.map((dir) => {
      let reach = Infinity;
      let blocker: ObstacleState | null = null;

      for (const wall of state.map.walls) {
        const d = laneDistance(ninja.x, ninja.y, dir, wall, CROSS_SLASH_LANE_HALF_WIDTH);
        if (d !== null && d < reach) reach = d;
      }

      for (const obstacle of state.obstacles) {
        if (!obstacle.alive) continue;
        const d = laneDistance(ninja.x, ninja.y, dir, obstacle, CROSS_SLASH_LANE_HALF_WIDTH);
        if (d === null || d > reach) continue;
        reach = d;
        blocker = obstacle;
      }

      return { dir, reach, blocker };
    });

    for (const beam of beams) {
      if (beam.blocker && beam.blocker.alive) {
        beam.blocker.hp = 0;
        beam.blocker.alive = false;
        events.push({ type: "obstacleDestroyed", ninjaId: ninja.id, obstacleId: beam.blocker.id });
      }

      for (const other of state.ninjas) {
        if (other === ninja || !isVulnerable(other)) continue;
        if (inLane(ninja.x, ninja.y, beam.dir, other, beam.reach)) shatterNinja(ninja, other, events);
      }
    }
  },
};

function inLane(
  px: number,
  py: number,
  dir: { x: number; y: number },
  target: NinjaState,
  reach: number,
): boolean {
  const horizontal = dir.x !== 0;
  const sign = horizontal ? dir.x : dir.y;

  const perpGap = horizontal ? Math.abs(target.y - py) : Math.abs(target.x - px);
  if (perpGap > target.radius + CROSS_SLASH_LANE_HALF_WIDTH) return false;

  const alongGap = (horizontal ? target.x - px : target.y - py) * sign;
  return alongGap + target.radius > 0 && alongGap - target.radius <= reach;
}

export const OUGIS: Record<string, OugiDefinition> = {
  [SHOCKWAVE.id]: SHOCKWAVE,
  [SURGE.id]: SURGE,
  [CROSS_SLASH.id]: CROSS_SLASH,
};

/** Characters share identical base stats; the Ougi is the whole difference between them. */
export const CHARACTERS: readonly CharacterDefinition[] = [
  { id: "ember", name: "Ember", ougiId: SHOCKWAVE.id },
  { id: "gale", name: "Gale", ougiId: SURGE.id },
  { id: "shade", name: "Shade", ougiId: CROSS_SLASH.id },
];

export const DEFAULT_CHARACTER_ID = CHARACTERS[0]!.id;

export function characterFor(characterId: string): CharacterDefinition {
  return CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0]!;
}

export function ougiForCharacter(characterId: string): OugiDefinition {
  return OUGIS[characterFor(characterId).ougiId] ?? SHOCKWAVE;
}

/** Dash reach and the TP tank scale together, so a reach buff is spendable rather than instantly TP-capped. */
export function maxTpOf(ninja: NinjaState): number {
  return MAX_TP * ninja.dashRangeMultiplier;
}

export function canFireOugi(ninja: NinjaState): boolean {
  return ninja.active && ninja.sp >= MAX_SP;
}

/** Spends the full meter and runs the Ougi's immediate effect. Returns false if the meter wasn't full. */
export function fireOugi(state: SimState, ninja: NinjaState, events: SimEvent[]): boolean {
  if (!canFireOugi(ninja)) return false;

  const ougi = ougiForCharacter(ninja.characterId);
  ninja.sp = 0;
  ninja.ougiTicks = ougi.durationTicks;
  ougi.onFire(state, ninja, events);
  events.push({ type: "ougiFired", ninjaId: ninja.id, ougiId: ougi.id });
  return true;
}

/** Advances a running duration Ougi by one tick, ending it (and clearing its buffs) when the clock runs out. */
export function tickOugi(state: SimState, ninja: NinjaState, events: SimEvent[]): void {
  if (ninja.ougiTicks <= 0) return;

  const ougi = ougiForCharacter(ninja.characterId);
  ougi.onTick?.(state, ninja, events);
  ninja.ougiTicks--;
  if (ninja.ougiTicks === 0) ougi.onEnd?.(state, ninja);
}
