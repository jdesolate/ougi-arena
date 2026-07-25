import { describe, expect, it } from "vitest";
import { CELL, CRATE_HP, HAY_HP } from "./constants.js";
import { cellCentre } from "./grid.js";
import { DOJO_ARENA, parseArenaMap } from "./map.js";

/** Every authored box sits on a cell centre, which is what makes a snapped dash land flush against cover. */
function onGrid(map: typeof DOJO_ARENA, x: number, y: number): boolean {
  const col = (x - map.grid.originX) / CELL - 0.5;
  const row = (y - map.grid.originY) / CELL - 0.5;
  return Number.isInteger(col) && Number.isInteger(row);
}

describe("parseArenaMap", () => {
  const map = parseArenaMap("fixture", [
    "2.#..",
    "..xo1",
  ]);

  it("sizes the arena from the row count, inside a half-cell border", () => {
    expect(map.grid).toEqual({ originX: CELL / 2, originY: CELL / 2, cols: 5, rows: 2 });
    expect(map.width).toBe(CELL + 5 * CELL);
    expect(map.height).toBe(CELL + 2 * CELL);
  });

  it("puts pillars in walls alongside the border, since neither is destructible", () => {
    expect(map.walls).toHaveLength(5);
    expect(map.walls[4]).toEqual({ ...cellCentre(map.grid, 2, 0), halfW: CELL / 2, halfH: CELL / 2 });
  });

  it("gives each destructible tier its own starting HP", () => {
    expect(map.obstacles.map((o) => o.hp)).toEqual([CRATE_HP, HAY_HP]);
    expect(map.obstacles[0]).toMatchObject({ ...cellCentre(map.grid, 2, 1), halfW: CELL / 2 });
  });

  it("orders spawns by their digit, not by scan order", () => {
    expect(map.spawns).toEqual([cellCentre(map.grid, 4, 1), cellCentre(map.grid, 0, 0)]);
  });

  it("falls back to the centre when a map authors no spawns", () => {
    const blank = parseArenaMap("blank", ["..", ".."]);
    expect(blank.spawns).toEqual([{ x: blank.width / 2, y: blank.height / 2 }]);
  });
});

describe("DOJO_ARENA", () => {
  it("is the same 1280x720 arena, now read as 15x8 cells", () => {
    expect(DOJO_ARENA.width).toBe(1280);
    expect(DOJO_ARENA.height).toBe(720);
    expect(DOJO_ARENA.grid.cols).toBe(15);
    expect(DOJO_ARENA.grid.rows).toBe(8);
    expect(DOJO_ARENA.spawns).toHaveLength(4);
  });

  it("places every pillar, destructible and spawn on the grid", () => {
    for (const wall of DOJO_ARENA.walls.slice(4)) {
      expect(onGrid(DOJO_ARENA, wall.x, wall.y)).toBe(true);
    }
    for (const obstacle of DOJO_ARENA.obstacles) {
      expect(onGrid(DOJO_ARENA, obstacle.x, obstacle.y)).toBe(true);
    }
    for (const spawn of DOJO_ARENA.spawns) {
      expect(onGrid(DOJO_ARENA, spawn.x, spawn.y)).toBe(true);
    }
  });

  it("mixes both destructible tiers", () => {
    const hps = new Set(DOJO_ARENA.obstacles.map((o) => o.hp));
    expect(hps).toEqual(new Set([CRATE_HP, HAY_HP]));
  });
});
