import { NINJA_TEXTURE_PATH, cssColor } from "../skins.js";

const PORTRAIT_SIZE = 48;

let spritePromise: Promise<HTMLImageElement> | null = null;

function loadSprite(): Promise<HTMLImageElement> {
  spritePromise ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("ninja sprite failed to load"));
    img.src = NINJA_TEXTURE_PATH;
  });
  return spritePromise;
}

/**
 * Draws the character's ninja at the size the select screen wants. Phaser tints by multiplying the sprite, so
 * the canvas does the same — otherwise the card wouldn't match the ninja you end up playing.
 */
export async function drawPortrait(canvas: HTMLCanvasElement, color: number): Promise<void> {
  const img = await loadSprite();
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = PORTRAIT_SIZE;
  canvas.height = PORTRAIT_SIZE;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  ctx.drawImage(img, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);

  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = cssColor(color);
  ctx.fillRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  // Multiply also painted the transparent margin, so re-apply the sprite's own alpha as a mask.
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  ctx.globalCompositeOperation = "source-over";
}
