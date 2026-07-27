import { CELL } from "./constants.js";
import type { Aabb, ArenaGrid, Vec2 } from "./types.js";

export function cellCentre(grid: ArenaGrid, col: number, row: number): Vec2 {
  return { x: grid.originX + (col + 0.5) * CELL, y: grid.originY + (row + 0.5) * CELL };
}

/** A full-cell box, the size every pillar and destructible occupies. */
export function cellBox(grid: ArenaGrid, col: number, row: number): Aabb {
  const centre = cellCentre(grid, col, row);
  return { x: centre.x, y: centre.y, halfW: CELL / 2, halfH: CELL / 2 };
}

/** Centre of the cell containing `v` on one axis — also the nearest centre, since cells tile the axis. */
export function snapToCellCentre(v: number, origin: number): number {
  return origin + (Math.floor((v - origin) / CELL) + 0.5) * CELL;
}

/**
 * Resolves a requested dash reach along one axis to a cell-centred landing distance, clamping *down* to the
 * nearest reachable cell — rounding up would let a dash travel further than the TP it paid for. Returns 0 when
 * even the first cell centre is out of reach, so a half-tile drag is a no-op rather than a stumble.
 *
 * `from` may be off-grid (hard-stopped against a pillar, or flung by Shockwave): because the *destination* is
 * what snaps, the next dash pulls that ninja back onto the grid on its own. No realignment logic, and no way
 * to get wedged between cells.
 */
export function snapDashDistance(from: number, dir: number, maxDistance: number, origin: number): number {
  if (dir === 0 || maxDistance <= 0) return 0;

  let distance = (snapToCellCentre(from + dir * maxDistance, origin) - from) * dir;
  // Snapping to the containing cell can only round up by half a cell, so this steps back at most once.
  while (distance > maxDistance) distance -= CELL;

  return distance > 0 ? distance : 0;
}

/**
 * Distance along one axis from `from` to the centre of the cell `cells` away from the one it stands in. Unlike
 * `snapDashDistance` this never clamps down — a knockback isn't paid for out of TP, so the push always crosses
 * whole cells — and because the *containing* cell is the reference, an off-grid victim (hard-stopped against a
 * pillar, or already flung) lands back on a centre.
 */
export function cellPushDistance(from: number, dir: number, cells: number, origin: number): number {
  if (dir === 0 || cells <= 0) return 0;
  return (snapToCellCentre(from, origin) + dir * cells * CELL - from) * dir;
}
