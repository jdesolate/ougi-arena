import { KNOCKBACK_BONUS, SEPARATION_SLOP } from "./constants.js";
import { closestPointOnAabb, lengthOf } from "./math.js";
import type { Aabb, NinjaState } from "./types.js";

export interface Contact {
  /** Unit normal pointing away from the other body. */
  nx: number;
  ny: number;
  penetration: number;
}

/** Overlap test only; resolution is a separate step so callers can decide not to bounce (shattered obstacles). */
export function circleAabbContact(ninja: NinjaState, box: Aabb): Contact | null {
  const cp = closestPointOnAabb(box, ninja.x, ninja.y);
  const dx = ninja.x - cp.x;
  const dy = ninja.y - cp.y;
  const dist = lengthOf(dx, dy);

  if (dist > 0) {
    if (dist >= ninja.radius) return null;
    return { nx: dx / dist, ny: dy / dist, penetration: ninja.radius - dist };
  }

  // Centre is inside the box: push out along the shallowest face.
  const left = ninja.x - (box.x - box.halfW);
  const right = box.x + box.halfW - ninja.x;
  const top = ninja.y - (box.y - box.halfH);
  const bottom = box.y + box.halfH - ninja.y;
  const min = Math.min(left, right, top, bottom);

  if (min === left) return { nx: -1, ny: 0, penetration: ninja.radius + left };
  if (min === right) return { nx: 1, ny: 0, penetration: ninja.radius + right };
  if (min === top) return { nx: 0, ny: -1, penetration: ninja.radius + top };
  return { nx: 0, ny: 1, penetration: ninja.radius + bottom };
}

/** Closing speed along the contact normal — the sim's single measure of how hard a hit landed. */
export function closingSpeed(ninja: NinjaState, contact: Contact): number {
  const along = ninja.vx * contact.nx + ninja.vy * contact.ny;
  return along < 0 ? -along : 0;
}

/** Depenetrates and fully halts a ninja against static geometry — no bounce, the dash ends here. Returns the impact speed. */
export function stopAtContact(ninja: NinjaState, contact: Contact): number {
  const impact = closingSpeed(ninja, contact);
  ninja.x += contact.nx * (contact.penetration + SEPARATION_SLOP);
  ninja.y += contact.ny * (contact.penetration + SEPARATION_SLOP);
  ninja.vx = 0;
  ninja.vy = 0;
  ninja.dashBudget = 0;
  return impact;
}

/** Cheap overlap test used to decide whether a pair needs resolving at all. */
export function circlesOverlap(a: NinjaState, b: NinjaState): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDist = a.radius + b.radius;
  return dx * dx + dy * dy < minDist * minDist;
}

/** Equal-mass elastic-ish exchange plus a flat knockback bonus so hits read as hits. Returns impact speed. */
export function resolveNinjaPair(a: NinjaState, b: NinjaState, restitution: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = lengthOf(dx, dy);
  const minDist = a.radius + b.radius;
  if (dist >= minDist) return null;

  // Perfectly stacked bodies have no normal; pick a fixed axis so both peers resolve identically.
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;

  const impact = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

  const push = (minDist - dist) * 0.5 + SEPARATION_SLOP;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;

  if (impact > 0) {
    const j = ((1 + restitution) * impact) * 0.5 + KNOCKBACK_BONUS * 0.5;
    a.vx -= nx * j;
    a.vy -= ny * j;
    b.vx += nx * j;
    b.vy += ny * j;
  }

  return impact > 0 ? impact : 0;
}
