import { CELL, CRATE_HP, HAY_HP } from "./constants.js";
import { cellBox } from "./grid.js";
import type { Aabb, ArenaGrid, ArenaMap, ObstacleTemplate, Vec2 } from "./types.js";

/** Border thickness. Half a cell, so the playable grid still tiles the arena exactly. */
const WALL = CELL / 2;

const TILE_PILLAR = "#";
const TILE_CRATE = "x";
const TILE_HAY = "o";

function border(width: number, height: number, thickness: number): Aabb[] {
  const half = thickness / 2;
  return [
    { x: width / 2, y: half, halfW: width / 2, halfH: half },
    { x: width / 2, y: height - half, halfW: width / 2, halfH: half },
    { x: half, y: height / 2, halfW: half, halfH: height / 2 },
    { x: width - half, y: height / 2, halfW: half, halfH: height / 2 },
  ];
}

/**
 * Parses an arena from ASCII rows, one character per `CELL`: `#` stone pillar (indestructible cover that forms
 * the choke points), `x` crate, `o` hay bale, a digit for spawn point N, anything else floor. A map is ten
 * lines of text rather than code, which is what makes a second arena nearly free.
 */
export function parseArenaMap(id: string, rows: readonly string[]): ArenaMap {
  const cols = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const grid: ArenaGrid = { originX: WALL, originY: WALL, cols, rows: rows.length };
  const width = WALL * 2 + cols * CELL;
  const height = WALL * 2 + rows.length * CELL;

  const walls = border(width, height, WALL);
  const obstacles: ObstacleTemplate[] = [];
  const spawns: { order: number; point: Vec2 }[] = [];

  rows.forEach((line, row) => {
    for (let col = 0; col < cols; col++) {
      const tile = line[col];
      if (tile === undefined) continue;
      const box = cellBox(grid, col, row);

      if (tile === TILE_PILLAR) walls.push(box);
      else if (tile === TILE_CRATE) obstacles.push({ ...box, hp: CRATE_HP });
      else if (tile === TILE_HAY) obstacles.push({ ...box, hp: HAY_HP });
      else if (tile >= "1" && tile <= "9") {
        spawns.push({ order: Number(tile), point: { x: box.x, y: box.y } });
      }
    }
  });

  // Ordered by digit rather than by scan order, so the author controls which slot starts where.
  spawns.sort((a, b) => a.order - b.order);

  return {
    id,
    width,
    height,
    grid,
    walls,
    obstacles,
    spawns: spawns.length > 0 ? spawns.map((s) => s.point) : [{ x: width / 2, y: height / 2 }],
  };
}

/**
 * The MVP's arena: pillar rows forming vertical chokes through the middle, crates guarding the two open
 * corridors, and a bale of hay near each spawn as cover you can clear in one hit. 15x8 cells = 1280x720.
 */
export const DOJO_ARENA: ArenaMap = parseArenaMap("dojo", [
  "1..o.......o..2",
  "..#..#...#..#..",
  ".....x...x.....",
  "..#.#..#..#.#..",
  "..#.#..#..#.#..",
  ".....x...x.....",
  "..#..#...#..#..",
  "3..o.......o..4",
]);
