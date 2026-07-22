import type { Aabb, ArenaMap } from "./types.js";

const WIDTH = 1280;
const HEIGHT = 720;
const WALL = 40;

const OBSTACLE_HALF = 30;
const OBSTACLE_COLS = 5;
const OBSTACLE_ROWS = 3;
const OBSTACLE_SPACING_X = 160;
const OBSTACLE_SPACING_Y = 160;

function border(width: number, height: number, thickness: number): Aabb[] {
  const half = thickness / 2;
  return [
    { x: width / 2, y: half, halfW: width / 2, halfH: half },
    { x: width / 2, y: height - half, halfW: width / 2, halfH: half },
    { x: half, y: height / 2, halfW: half, halfH: height / 2 },
    { x: width - half, y: height / 2, halfW: half, halfH: height / 2 },
  ];
}

function obstacleGrid(): Aabb[] {
  const boxes: Aabb[] = [];
  const originX = WIDTH / 2 - ((OBSTACLE_COLS - 1) * OBSTACLE_SPACING_X) / 2;
  const originY = HEIGHT / 2 - ((OBSTACLE_ROWS - 1) * OBSTACLE_SPACING_Y) / 2;

  for (let row = 0; row < OBSTACLE_ROWS; row++) {
    for (let col = 0; col < OBSTACLE_COLS; col++) {
      boxes.push({
        x: originX + col * OBSTACLE_SPACING_X,
        y: originY + row * OBSTACLE_SPACING_Y,
        halfW: OBSTACLE_HALF,
        halfH: OBSTACLE_HALF,
      });
    }
  }
  return boxes;
}

/** The MVP's single arena. Maps are pure data so a second one is a new file, not new code. */
export const DOJO_ARENA: ArenaMap = {
  id: "dojo",
  width: WIDTH,
  height: HEIGHT,
  walls: border(WIDTH, HEIGHT, WALL),
  obstacles: obstacleGrid(),
  spawns: [
    { x: 160, y: 140 },
    { x: WIDTH - 160, y: 140 },
    { x: 160, y: HEIGHT - 140 },
    { x: WIDTH - 160, y: HEIGHT - 140 },
  ],
};
