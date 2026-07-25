import { describe, expect, it } from "vitest";
import { CELL, CRATE_HP, HAY_HP } from "./constants.js";
import { cellCentre } from "./grid.js";
import { ARENAS, DOJO_ARENA, arenaById, parseArenaMap } from "./map.js";
import type { ArenaMap } from "./types.js";

/** Every authored box sits on a cell centre, which is what makes a snapped dash land flush against cover. */
function onGrid(map: ArenaMap, x: number, y: number): boolean {
  const col = (x - map.grid.originX) / CELL - 0.5;
  const row = (y - map.grid.originY) / CELL - 0.5;
  return Number.isInteger(col) && Number.isInteger(row);
}

describe("parseArenaMap", () => {
  const map = parseArenaMap("fixture", "Fixture", ["2.#..", "..xo1"]);

  it("sizes the arena from the row count, inside a half-cell border", () => {
    expect(map.grid).toEqual({ originX: CELL / 2, originY: CELL / 2, cols: 5, rows: 2 });
    expect(map.width).toBe(CELL + 5 * CELL);
    expect(map.height).toBe(CELL + 2 * CELL);
  });

  it("puts pillars in walls alongside the border, since neither is destructible", () => {
    expect(map.walls).toHaveLength(5);
    expect(map.walls).toEqual([...map.border, ...map.pillars]);
    expect(map.pillars).toEqual([{ ...cellCentre(map.grid, 2, 0), halfW: CELL / 2, halfH: CELL / 2 }]);
  });

  it("gives each destructible tier its own starting HP", () => {
    expect(map.obstacles.map((o) => o.hp)).toEqual([CRATE_HP, HAY_HP]);
    expect(map.obstacles[0]).toMatchObject({ ...cellCentre(map.grid, 2, 1), halfW: CELL / 2 });
  });

  it("orders spawns by their digit, not by scan order", () => {
    expect(map.spawns).toEqual([cellCentre(map.grid, 4, 1), cellCentre(map.grid, 0, 0)]);
  });

  it("falls back to the centre when a map authors no spawns", () => {
    const blank = parseArenaMap("blank", "Blank", ["..", ".."]);
    expect(blank.spawns).toEqual([{ x: blank.width / 2, y: blank.height / 2 }]);
  });
});

describe("ARENAS", () => {
  it("ships three arenas with distinct ids and names", () => {
    expect(ARENAS).toHaveLength(3);
    expect(new Set(ARENAS.map((a) => a.id)).size).toBe(3);
    expect(new Set(ARENAS.map((a) => a.name)).size).toBe(3);
  });

  // The client sizes its canvas once from whichever map the room picked, so a mismatch would misplace every hitbox.
  it("sizes every arena identically at 15x8 cells", () => {
    for (const arena of ARENAS) {
      expect([arena.width, arena.height]).toEqual([1280, 720]);
      expect([arena.grid.cols, arena.grid.rows]).toEqual([15, 8]);
    }
  });

  it("gives every arena four spawns and both destructible tiers", () => {
    for (const arena of ARENAS) {
      expect(arena.spawns).toHaveLength(4);
      expect(new Set(arena.obstacles.map((o) => o.hp))).toEqual(new Set([CRATE_HP, HAY_HP]));
    }
  });

  it("places every pillar, destructible and spawn on the grid", () => {
    for (const arena of ARENAS) {
      for (const box of [...arena.pillars, ...arena.obstacles]) {
        expect(onGrid(arena, box.x, box.y)).toBe(true);
      }
      for (const spawn of arena.spawns) {
        expect(onGrid(arena, spawn.x, spawn.y)).toBe(true);
      }
    }
  });

  // A spawn buried inside cover would drop a respawning ninja straight into a wall.
  it("keeps every spawn cell clear of pillars and destructibles", () => {
    for (const arena of ARENAS) {
      for (const spawn of arena.spawns) {
        const blocked = [...arena.pillars, ...arena.obstacles].some(
          (box) => box.x === spawn.x && box.y === spawn.y,
        );
        expect(blocked).toBe(false);
      }
    }
  });

  it("resolves a synced id, and falls back rather than leaving a client mapless", () => {
    expect(arenaById("halls").name).toBe("Twin Halls");
    expect(arenaById("nope")).toBe(DOJO_ARENA);
  });
});
