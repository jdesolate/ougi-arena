/**
 * Code-drawn pixel icons for the weapon cards, at 16x16 so the CSS upscale (48px,
 * image-rendering: pixelated) gives the same chunky look as the ninja portraits.
 */

const ICON_SIZE = 16;

const STEEL = "#c9d1e8";
const STEEL_DARK = "#8a93b8";
const WRAP = "#3a3a4e";
const GOLD = "#ffd166";
const GOLD_DEEP = "#d4a63f";
const WOOD = "#4a3226";
const LACQUER_RED = "#a03636";

type Ctx = CanvasRenderingContext2D;

function drawKunai(ctx: Ctx): void {
  // Leaf-shaped blade, point up.
  ctx.fillStyle = STEEL;
  ctx.fillRect(7, 1, 2, 1);
  ctx.fillRect(6, 2, 4, 2);
  ctx.fillRect(5, 4, 6, 3);
  ctx.fillRect(6, 7, 4, 1);
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(8, 2, 1, 5);
  // Wrapped grip.
  ctx.fillStyle = WRAP;
  ctx.fillRect(7, 8, 2, 4);
  // Pommel ring.
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(6, 12, 4, 1);
  ctx.fillRect(6, 14, 4, 1);
  ctx.fillRect(5, 12, 1, 3);
  ctx.fillRect(10, 12, 1, 3);
}

function drawFan(ctx: Ctx): void {
  // Open tessen: gold leaf spread from a pivot at the bottom.
  ctx.fillStyle = GOLD;
  ctx.fillRect(4, 3, 8, 2);
  ctx.fillRect(3, 5, 10, 2);
  ctx.fillRect(4, 7, 8, 1);
  ctx.fillRect(5, 8, 6, 1);
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(5, 3, 1, 5);
  ctx.fillRect(10, 3, 1, 5);
  // Ribs converging on the pivot.
  ctx.fillStyle = WOOD;
  ctx.fillRect(7, 4, 2, 5);
  ctx.fillRect(6, 9, 4, 1);
  ctx.fillRect(7, 10, 2, 3);
}

function drawLongsword(ctx: Ctx): void {
  // Long straight blade with a bright edge line.
  ctx.fillStyle = STEEL;
  ctx.fillRect(7, 0, 2, 10);
  ctx.fillStyle = "#f0f4ff";
  ctx.fillRect(7, 0, 1, 10);
  // Gold crossguard.
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(4, 10, 8, 1);
  // Lacquered grip and pommel.
  ctx.fillStyle = LACQUER_RED;
  ctx.fillRect(7, 11, 2, 4);
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(7, 15, 2, 1);
}

const DRAWERS: Record<string, (ctx: Ctx) => void> = {
  kunai: drawKunai,
  fan: drawFan,
  longsword: drawLongsword,
};

export function drawWeaponIcon(canvas: HTMLCanvasElement, weaponId: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  DRAWERS[weaponId]?.(ctx);
}
