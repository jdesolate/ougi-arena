import {
  canFireOugi,
  laneDistance,
  lengthOf,
  maxDashDistanceOf,
  type NinjaState,
  type SimCommand,
  type SimState,
} from "@ougi-arena/shared";

/** Namespaces synthetic ninja ids so the room can tell a bot apart from a real client's sessionId. */
export const BOT_ID_PREFIX = "bot:";

export function isBotId(id: string): boolean {
  return id.startsWith(BOT_ID_PREFIX);
}

/** A bot dashes once it's charged at least this fraction of a full-power reach — not full TP, so it stays active. */
const CHARGE_THRESHOLD = 0.5;
/** Close enough to a target that further aiming is pointless. */
const TARGET_EPSILON = 4;

export interface BotDecision {
  command: SimCommand | null;
  /** Continuous hold state, mirroring the `"charge"` message a real client sends — set every tick, not queued. */
  charging: boolean;
}

/**
 * Dash-at-nearest AI: holds to charge TP, then releases toward the nearest live target on whichever cardinal
 * axis has clearer line-of-sight (basic obstacle avoidance), and fires its Ougi the instant the meter is full.
 */
export function decideBotCommand(state: SimState, ninja: NinjaState): BotDecision {
  if (!ninja.active || ninja.dashBudget > 0) return { command: null, charging: false };

  if (canFireOugi(ninja)) {
    return { command: { type: "ougi", ninjaId: ninja.id }, charging: false };
  }

  const target = nearestTarget(state, ninja);
  if (!target) return { command: null, charging: true };

  const dx = target.x - ninja.x;
  const dy = target.y - ninja.y;
  if (lengthOf(dx, dy) < TARGET_EPSILON) return { command: null, charging: true };

  const maxDash = maxDashDistanceOf(ninja);
  const chargeFraction = maxDash > 0 ? ninja.tp / maxDash : 0;
  if (chargeFraction < CHARGE_THRESHOLD) return { command: null, charging: true };

  const dir = chooseAxis(state, ninja, dx, dy);
  return {
    command: { type: "launch", ninjaId: ninja.id, dirX: dir.x, dirY: dir.y, power: Math.min(1, chargeFraction) },
    charging: false,
  };
}

function nearestTarget(state: SimState, ninja: NinjaState): NinjaState | null {
  let best: NinjaState | null = null;
  let bestDist = Infinity;
  for (const other of state.ninjas) {
    if (other === ninja || !other.active) continue;
    const dist = lengthOf(other.x - ninja.x, other.y - ninja.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = other;
    }
  }
  return best;
}

/** Picks the dominant axis toward the target unless the other candidate axis has clearer line-of-sight. */
function chooseAxis(state: SimState, ninja: NinjaState, dx: number, dy: number): { x: number; y: number } {
  const horizontal = { x: Math.sign(dx), y: 0 };
  const vertical = { x: 0, y: Math.sign(dy) };

  const horizontalClear = dx !== 0 ? laneClearance(state, ninja, horizontal) : -Infinity;
  const verticalClear = dy !== 0 ? laneClearance(state, ninja, vertical) : -Infinity;

  const dominantIsHorizontal = Math.abs(dx) >= Math.abs(dy);
  const dominant = dominantIsHorizontal ? horizontal : vertical;
  const secondary = dominantIsHorizontal ? vertical : horizontal;
  const dominantClear = dominantIsHorizontal ? horizontalClear : verticalClear;
  const secondaryClear = dominantIsHorizontal ? verticalClear : horizontalClear;

  return secondaryClear > dominantClear ? secondary : dominant;
}

/** How far a dash along `dir` could travel before the first wall or live obstacle blocks it. */
function laneClearance(state: SimState, ninja: NinjaState, dir: { x: number; y: number }): number {
  let reach = Infinity;
  for (const wall of state.map.walls) {
    const d = laneDistance(ninja.x, ninja.y, dir, wall, ninja.radius);
    if (d !== null && d < reach) reach = d;
  }
  for (const obstacle of state.obstacles) {
    if (!obstacle.alive) continue;
    const d = laneDistance(ninja.x, ninja.y, dir, obstacle, ninja.radius);
    if (d !== null && d < reach) reach = d;
  }
  return reach;
}
