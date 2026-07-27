import {
  CELL,
  FAN_COOLDOWN_TICKS,
  FAN_DAMAGE,
  FAN_KNOCKBACK_CELLS,
  KUNAI_COOLDOWN_TICKS,
  KUNAI_DAMAGE,
  LONGSWORD_COOLDOWN_TICKS,
  LONGSWORD_DAMAGE,
  WEAPON_KNOCKBACK_SPEED,
} from "./constants.js";
import { damageNinja, isVulnerable } from "./damage.js";
import { cellPushDistance, snapToCellCentre } from "./grid.js";
import { aabbContains, closestPointOnAabb, lengthOf, snapToCardinal } from "./math.js";
import type { Aabb, ArenaGrid, NinjaState, SimEvent, SimState, Vec2 } from "./types.js";

/**
 * One cell of a weapon's pattern, relative to the swing direction: `forward` cells ahead of the attacker and
 * `lateral` cells to its right. Measured in whole `CELL`s — the same unit maps are authored in and an obstacle
 * box fills — so "one box in front" is literal and a swing lines up with the tiles under it.
 *
 * Cells must be authored nearest-first within a lane: cover blocks everything further out in the same
 * `lateral`, and `attackCells` decides that as it walks the list.
 */
export interface WeaponCell {
  forward: number;
  lateral: number;
}

/**
 * A melee attack, expressed as data. Weapon is a separate pick from character — character decides the Ougi,
 * weapon decides the swing — so balance is a table edit and a future weapon-bound Ougi has a slot to live in.
 */
export interface WeaponDefinition {
  id: string;
  name: string;
  description: string;
  cells: readonly WeaponCell[];
  /** Dealt to every ninja and every destructible in the pattern. Chips HP; never an instant kill. */
  damage: number;
  /** Attack speed, as the rate limit it really is. An attack arriving during it is dropped, not buffered. */
  cooldownTicks: number;
  /** Whole cells a hit ninja is pushed along the swing direction; 0 for a weapon that only chips. */
  knockbackCells: number;
}

const KUNAI: WeaponDefinition = {
  id: "kunai",
  name: "Kunai",
  description: "One cell in front. Fastest swing, least damage — safe poke and chip pressure.",
  cells: [{ forward: 1, lateral: 0 }],
  damage: KUNAI_DAMAGE,
  cooldownTicks: KUNAI_COOLDOWN_TICKS,
  knockbackCells: 0,
};

const FAN: WeaponDefinition = {
  id: "fan",
  name: "Paper Fan",
  description: "Three cells across your front, and it shoves them a tile back. Controls the space around you.",
  cells: [
    { forward: 1, lateral: 0 },
    { forward: 1, lateral: -1 },
    { forward: 1, lateral: 1 },
  ],
  damage: FAN_DAMAGE,
  cooldownTicks: FAN_COOLDOWN_TICKS,
  knockbackCells: FAN_KNOCKBACK_CELLS,
};

const LONGSWORD: WeaponDefinition = {
  id: "longsword",
  name: "Longsword",
  description: "Two cells straight ahead. Slowest and hardest hitting — punishes a committed dash.",
  cells: [
    { forward: 1, lateral: 0 },
    { forward: 2, lateral: 0 },
  ],
  damage: LONGSWORD_DAMAGE,
  cooldownTicks: LONGSWORD_COOLDOWN_TICKS,
  knockbackCells: 0,
};

export const WEAPONS: readonly WeaponDefinition[] = [KUNAI, FAN, LONGSWORD];

export const DEFAULT_WEAPON_ID = KUNAI.id;

/** Falls back to the default so an unknown id can never leave a ninja unable to swing. */
export function weaponFor(weaponId: string): WeaponDefinition {
  return WEAPONS.find((w) => w.id === weaponId) ?? KUNAI;
}

/**
 * The world boxes a swing would actually reach, measured against the *current* grid and returned in pattern
 * order. Cover — a wall, a pillar, or a live destructible — blocks every cell beyond it in the same lane,
 * whether or not the swing goes on to break it, matching how a dash hard-stops on contact.
 *
 * Exported so the client can highlight the exact tiles the sim will resolve rather than approximating them.
 */
export function attackCells(
  state: SimState,
  ninja: NinjaState,
  dir: Vec2,
  weapon: WeaponDefinition,
): Aabb[] {
  // Measured from the cell the attacker stands in, not its exact position, so the pattern lines up with the
  // authored grid even when a pillar has left the ninja parked off-centre.
  const originX = snapToCellCentre(ninja.x, state.map.grid.originX);
  const originY = snapToCellCentre(ninja.y, state.map.grid.originY);
  const rightX = -dir.y;
  const rightY = dir.x;

  const boxes: Aabb[] = [];
  const blockedLanes = new Set<number>();

  for (const cell of weapon.cells) {
    if (blockedLanes.has(cell.lateral)) continue;

    const box: Aabb = {
      x: originX + (dir.x * cell.forward + rightX * cell.lateral) * CELL,
      y: originY + (dir.y * cell.forward + rightY * cell.lateral) * CELL,
      halfW: CELL / 2,
      halfH: CELL / 2,
    };

    // A cell centre inside a wall is a pillar or the arena frame: nothing to hit, and nothing past it either.
    if (state.map.walls.some((wall) => aabbContains(wall, box.x, box.y))) {
      blockedLanes.add(cell.lateral);
      continue;
    }

    // A destructible is still reached and damaged; it just stops the swing carrying on behind it.
    if (state.obstacles.some((o) => o.alive && aabbContains(o, box.x, box.y))) {
      blockedLanes.add(cell.lateral);
    }

    boxes.push(box);
  }

  return boxes;
}

/**
 * How far a knockback carries `target`, in world units: to the centre of the cell `knockbackCells` away along the
 * swing axis. Exported so the client can preview or animate the exact landing the sim will resolve.
 */
export function knockbackDistanceFor(
  target: NinjaState,
  dir: Vec2,
  weapon: WeaponDefinition,
  grid: ArenaGrid,
): number {
  if (dir.x !== 0) return cellPushDistance(target.x, dir.x, weapon.knockbackCells, grid.originX);
  if (dir.y !== 0) return cellPushDistance(target.y, dir.y, weapon.knockbackCells, grid.originY);
  return 0;
}

/**
 * Pushes a hit ninja along the swing on the same `dashBudget` Shockwave's fling uses — so walls, pillars and
 * destructibles hard-stop it for free, and `dashLethal` stays false because being shoved must never shatter
 * whoever you land on. Every cell of a pattern pushes along `dir`, not outward from the attacker: a fan's
 * diagonal victims are swept the same way as the one in front, which is what makes the sweep read as one motion.
 */
function applyKnockback(
  state: SimState,
  target: NinjaState,
  source: NinjaState,
  dir: Vec2,
  weapon: WeaponDefinition,
  events: SimEvent[],
): void {
  // A hit that KO'd its target has already zeroed its budget; pushing a corpse would just fight the respawn.
  if (weapon.knockbackCells <= 0 || !target.active) return;

  const distance = knockbackDistanceFor(target, dir, weapon, state.map.grid);
  if (distance <= 0) return;

  target.vx = dir.x * WEAPON_KNOCKBACK_SPEED;
  target.vy = dir.y * WEAPON_KNOCKBACK_SPEED;
  target.dashBudget = distance;
  target.dashLethal = false;
  events.push({
    type: "ninjaKnockback",
    targetId: target.id,
    sourceId: source.id,
    dirX: dir.x,
    dirY: dir.y,
    distance,
  });
}

/**
 * Swings `ninja`'s weapon in `dir`, resolving all damage. Returns false if the swing was refused — on cooldown,
 * or the ninja isn't in play. Damage runs through `damageNinja`, so a weapon charges SP by damage dealt and KOs
 * at 0 HP like any other source; dash-shatter stays the only instant kill.
 */
export function attack(
  state: SimState,
  ninja: NinjaState,
  dirX: number,
  dirY: number,
  events: SimEvent[],
): boolean {
  if (!ninja.active || ninja.attackCooldown > 0) return false;

  const snapped = snapToCardinal(dirX, dirY);
  // A tap landing on your own ninja carries no direction; swing where you already face rather than eat the input.
  const dir =
    snapped.x === 0 && snapped.y === 0 ? { x: ninja.facingX, y: ninja.facingY } : snapped;
  if (dir.x === 0 && dir.y === 0) return false;

  const weapon = weaponFor(ninja.weaponId);
  ninja.facingX = dir.x;
  ninja.facingY = dir.y;
  ninja.attackCooldown = weapon.cooldownTicks;
  events.push({
    type: "ninjaAttacked",
    ninjaId: ninja.id,
    weaponId: weapon.id,
    dirX: dir.x,
    dirY: dir.y,
  });

  // A body straddling two cells of the pattern is still one victim of one swing.
  const alreadyHit = new Set<NinjaState>();

  for (const box of attackCells(state, ninja, dir, weapon)) {
    for (const obstacle of state.obstacles) {
      if (!obstacle.alive || !aabbContains(obstacle, box.x, box.y)) continue;

      obstacle.hp -= weapon.damage;
      if (obstacle.hp <= 0) {
        obstacle.hp = 0;
        obstacle.alive = false;
        events.push({ type: "obstacleDestroyed", ninjaId: ninja.id, obstacleId: obstacle.id });
      } else {
        events.push({
          type: "obstacleHit",
          ninjaId: ninja.id,
          obstacleId: obstacle.id,
          impact: 0,
          damage: weapon.damage,
        });
      }
    }

    for (const other of state.ninjas) {
      if (other === ninja || alreadyHit.has(other) || !isVulnerable(other)) continue;

      const cp = closestPointOnAabb(box, other.x, other.y);
      if (lengthOf(other.x - cp.x, other.y - cp.y) >= other.radius) continue;

      alreadyHit.add(other);
      damageNinja(other, weapon.damage, ninja, events);
      applyKnockback(state, other, ninja, dir, weapon, events);
    }
  }

  return true;
}
