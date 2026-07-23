import type { Aabb } from "./types.js";

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Distance from a point to a box blocking a cardinal lane, or null if the box isn't in the lane at all.
 * Shared by Cross Slash's beam reach and the bot AI's obstacle avoidance.
 */
export function laneDistance(
  px: number,
  py: number,
  dir: { x: number; y: number },
  box: Aabb,
  laneHalf: number,
): number | null {
  const horizontal = dir.x !== 0;
  const sign = horizontal ? dir.x : dir.y;

  const perpGap = horizontal ? Math.abs(box.y - py) : Math.abs(box.x - px);
  const perpHalf = horizontal ? box.halfH : box.halfW;
  if (perpGap > perpHalf + laneHalf) return null;

  // A box straddling the origin along the axis is beside the caster, not in front — it doesn't block this lane.
  const alongGap = (horizontal ? box.x - px : box.y - py) * sign;
  const alongHalf = horizontal ? box.halfW : box.halfH;
  const near = alongGap - alongHalf;
  return near >= 0 ? near : null;
}

export function lengthOf(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Closest point on a box to a point, used by every circle-vs-AABB test. */
export function closestPointOnAabb(box: Aabb, px: number, py: number): { x: number; y: number } {
  return {
    x: clamp(px, box.x - box.halfW, box.x + box.halfW),
    y: clamp(py, box.y - box.halfH, box.y + box.halfH),
  };
}

export function aabbContains(box: Aabb, px: number, py: number): boolean {
  return (
    px >= box.x - box.halfW &&
    px <= box.x + box.halfW &&
    py >= box.y - box.halfH &&
    py <= box.y + box.halfH
  );
}
