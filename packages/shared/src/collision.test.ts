import { describe, expect, it } from "vitest";
import { circleAabbContact, closingSpeed, resolveNinjaPair, stopAtContact } from "./collision.js";
import { NINJA_RADIUS } from "./constants.js";
import { createNinja } from "./sim.js";
import type { Aabb } from "./types.js";

const box: Aabb = { x: 0, y: 0, halfW: 50, halfH: 50 };

describe("circleAabbContact", () => {
  it("misses when the circle is clear of the box", () => {
    expect(circleAabbContact(createNinja("a", { x: 100, y: 0 }), box)).toBeNull();
  });

  it("reports the face normal and penetration depth on a side overlap", () => {
    const ninja = createNinja("a", { x: 50 + NINJA_RADIUS - 5, y: 0 });
    const contact = circleAabbContact(ninja, box);
    expect(contact).not.toBeNull();
    expect(contact?.nx).toBe(1);
    expect(contact?.ny).toBe(0);
    expect(contact?.penetration).toBeCloseTo(5);
  });

  it("escapes along the shallowest face when the centre is inside the box", () => {
    const contact = circleAabbContact(createNinja("a", { x: 40, y: 0 }), box);
    expect(contact?.nx).toBe(1);
    expect(contact?.penetration).toBeCloseTo(NINJA_RADIUS + 10);
  });

  it("uses the corner normal when overlapping diagonally", () => {
    const contact = circleAabbContact(createNinja("a", { x: 60, y: 60 }), box);
    expect(contact?.nx).toBeCloseTo(Math.SQRT1_2);
    expect(contact?.ny).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("closingSpeed", () => {
  it("is zero for a body already moving away from the surface", () => {
    const ninja = createNinja("a", { x: 60, y: 0 });
    ninja.vx = 200;
    const contact = circleAabbContact(ninja, box)!;
    expect(closingSpeed(ninja, contact)).toBe(0);
  });

  it("measures only the normal component of an angled approach", () => {
    const ninja = createNinja("a", { x: 60, y: 0 });
    ninja.vx = -300;
    ninja.vy = 400;
    const contact = circleAabbContact(ninja, box)!;
    expect(closingSpeed(ninja, contact)).toBeCloseTo(300);
  });
});

describe("stopAtContact", () => {
  it("depenetrates and fully halts the ninja, ending its dash", () => {
    const ninja = createNinja("a", { x: 50 + NINJA_RADIUS - 6, y: 0 });
    ninja.vx = -400;
    ninja.dashBudget = 120;
    const contact = circleAabbContact(ninja, box)!;

    const impact = stopAtContact(ninja, contact);

    expect(impact).toBeCloseTo(400);
    expect(ninja.vx).toBe(0);
    expect(ninja.vy).toBe(0);
    expect(ninja.dashBudget).toBe(0);
    expect(ninja.x).toBeGreaterThanOrEqual(50 + NINJA_RADIUS);
    expect(circleAabbContact(ninja, box)).toBeNull();
  });
});

describe("resolveNinjaPair", () => {
  it("ignores bodies that are not overlapping", () => {
    const a = createNinja("a", { x: 0, y: 0 });
    const b = createNinja("b", { x: NINJA_RADIUS * 2 + 1, y: 0 });
    expect(resolveNinjaPair(a, b, 0.5)).toBeNull();
  });

  it("separates overlapping bodies symmetrically", () => {
    const a = createNinja("a", { x: 0, y: 0 });
    const b = createNinja("b", { x: 10, y: 0 });

    resolveNinjaPair(a, b, 0.5);

    expect(b.x - a.x).toBeGreaterThanOrEqual(NINJA_RADIUS * 2);
    expect(a.x + b.x).toBeCloseTo(10);
  });

  it("pushes the struck ninja away and slows the attacker", () => {
    const a = createNinja("a", { x: 0, y: 0 });
    const b = createNinja("b", { x: 30, y: 0 });
    a.vx = 600;

    const impact = resolveNinjaPair(a, b, 0.5);

    expect(impact).toBeCloseTo(600);
    expect(b.vx).toBeGreaterThan(a.vx);
    expect(a.vx).toBeLessThan(600);
  });
});
