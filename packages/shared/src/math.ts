import type { Aabb } from "./types.js";

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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
