import {
  MAX_SP,
  RESPAWN_DELAY_TICKS,
  SP_GAIN_ON_KO,
  SP_PER_DAMAGE,
} from "./constants.js";
import type { NinjaState, SimEvent } from "./types.js";

/** Lives here rather than in `sim.ts` so Ougi effects can deal damage without importing the sim back. */

/** A ninja that is KO'd, mid-respawn, or freshly respawned can't be touched. */
export function isVulnerable(ninja: NinjaState): boolean {
  return ninja.active && ninja.invulnerableTicks <= 0 && ninja.respawnTicks <= 0;
}

export function awardSp(ninja: NinjaState, amount: number): void {
  ninja.sp = Math.min(MAX_SP, ninja.sp + amount);
}

/**
 * Drops `target` out of the match and starts its respawn countdown. Ougi buffs are cleared through the
 * generic modifier fields, which is why an Ougi may only buff via those and never via hidden state.
 */
export function koNinja(target: NinjaState, killerId: string, events: SimEvent[]): void {
  target.hp = 0;
  target.active = false;
  target.vx = 0;
  target.vy = 0;
  target.dashBudget = 0;
  target.dashLethal = false;
  target.charging = false;
  target.ougiTicks = 0;
  target.dashRangeMultiplier = 1;
  target.invulnerableTicks = 0;
  target.respawnTicks = RESPAWN_DELAY_TICKS;
  events.push({ type: "ninjaKO", targetId: target.id, killerId });
}

/** Chips HP and pays the dealer in SP; a lethal hit rolls straight into a KO worth the usual bonus. */
export function damageNinja(
  target: NinjaState,
  amount: number,
  source: NinjaState,
  events: SimEvent[],
): number {
  if (amount <= 0 || !isVulnerable(target)) return 0;

  const dealt = Math.min(amount, target.hp);
  target.hp -= dealt;
  awardSp(source, dealt * SP_PER_DAMAGE);
  events.push({ type: "ninjaDamaged", targetId: target.id, sourceId: source.id, amount: dealt });

  if (target.hp <= 0) {
    koNinja(target, source.id, events);
    awardSp(source, SP_GAIN_ON_KO);
  }

  return dealt;
}

/** A dash reaching an enemy shatters them outright — no HP chipping, straight to a KO. */
export function shatterNinja(attacker: NinjaState, target: NinjaState, events: SimEvent[]): void {
  koNinja(target, attacker.id, events);
  awardSp(attacker, SP_GAIN_ON_KO);
}
