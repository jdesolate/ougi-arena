/** Character skins: one shared sprite, recolored per character. Swapping the pack means editing this file, not the scene. */
export interface NinjaSkin {
  /** Multiplied over the sprite (Phaser tint / canvas multiply), so it also reads as the character's colour in UI. */
  bodyColor: number;
  outlineColor: number;
}

/** Absolute so it still resolves from `/r/<code>`, which is a real URL the client is served at. */
export const NINJA_TEXTURE_KEY = "ninja";
export const NINJA_TEXTURE_PATH = "/assets/sprites/ninja.png";
/** Source art is 16x16; NINJA_RADIUS is 18, so this fills the sim's collision circle without overflowing it. */
export const NINJA_SPRITE_SCALE = 2.5;

export const DEFAULT_SKIN: NinjaSkin = {
  bodyColor: 0xff6b6b,
  outlineColor: 0xffffff,
};

const SKINS_BY_CHARACTER: Record<string, NinjaSkin> = {
  ember: DEFAULT_SKIN,
  gale: { bodyColor: 0x4fc3f7, outlineColor: 0xffffff },
  shade: { bodyColor: 0xb388ff, outlineColor: 0xffffff },
};

export function skinFor(characterId: string): NinjaSkin {
  return SKINS_BY_CHARACTER[characterId] ?? DEFAULT_SKIN;
}

/** For the DOM side (character select), which needs the same colour as a CSS string. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
