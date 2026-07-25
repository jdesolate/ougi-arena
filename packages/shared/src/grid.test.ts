import { describe, expect, it } from "vitest";
import { CELL } from "./constants.js";
import { cellBox, cellCentre, snapDashDistance, snapToCellCentre } from "./grid.js";
import { snapToCardinal } from "./math.js";
import type { ArenaGrid } from "./types.js";

const GRID: ArenaGrid = { originX: 40, originY: 40, cols: 15, rows: 8 };

describe("cell geometry", () => {
  it("centres a cell half a cell in from its corner", () => {
    expect(cellCentre(GRID, 0, 0)).toEqual({ x: 80, y: 80 });
    expect(cellCentre(GRID, 14, 7)).toEqual({ x: 1200, y: 640 });
  });

  it("fills a whole cell with an obstacle box", () => {
    expect(cellBox(GRID, 3, 1)).toEqual({ x: 320, y: 160, halfW: CELL / 2, halfH: CELL / 2 });
  });

  it("snaps any point to the centre of the cell containing it", () => {
    expect(snapToCellCentre(41, 40)).toBe(80);
    expect(snapToCellCentre(119, 40)).toBe(80);
    expect(snapToCellCentre(120, 40)).toBe(160);
    // Off the grid entirely: the tiling continues, so the maths never falls over on a knocked-out ninja.
    expect(snapToCellCentre(-10, 40)).toBe(0);
  });
});

describe("snapDashDistance", () => {
  it("keeps an exact multiple of a cell exactly as requested", () => {
    expect(snapDashDistance(80, 1, 5 * CELL, 40)).toBe(5 * CELL);
    expect(snapDashDistance(640, -1, 3 * CELL, 40)).toBe(3 * CELL);
  });

  it("clamps down to the nearest reachable cell rather than up", () => {
    // 1.9 cells of reach lands one cell away, never two — rounding up would outspend the TP that paid for it.
    expect(snapDashDistance(80, 1, CELL * 1.9, 40)).toBe(CELL);
    expect(snapDashDistance(80, 1, CELL * 2.1, 40)).toBe(CELL * 2);
  });

  it("refuses a drag too short to reach the next cell", () => {
    expect(snapDashDistance(80, 1, CELL * 0.4, 40)).toBe(0);
    expect(snapDashDistance(80, 1, 0, 40)).toBe(0);
  });

  it("pulls an off-grid start back onto the grid", () => {
    // A ninja hard-stopped against a pillar at x=262 asking for 3 cells: the destination snaps, not the origin.
    const distance = snapDashDistance(262, 1, 3 * CELL, 40);
    expect(262 + distance).toBe(480);
    expect(distance).toBeLessThanOrEqual(3 * CELL);
  });

  it("has no distance without a direction", () => {
    expect(snapDashDistance(80, 0, 400, 40)).toBe(0);
  });
});

describe("snapToCardinal", () => {
  it("resolves a diagonal to its dominant axis", () => {
    expect(snapToCardinal(3, 4)).toEqual({ x: 0, y: 1 });
    expect(snapToCardinal(-9, 2)).toEqual({ x: -1, y: 0 });
  });

  it("breaks a perfect diagonal toward the horizontal, and leaves nothing as nothing", () => {
    expect(snapToCardinal(5, 5)).toEqual({ x: 1, y: 0 });
    expect(snapToCardinal(0, 0)).toEqual({ x: 0, y: 0 });
  });
});
