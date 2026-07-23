/** Placeholder shape/color skins, keyed by character id. Swapping to a real asset pack later means editing this table, not the scene. */
export interface NinjaSkin {
  bodyColor: number;
  outlineColor: number;
}

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
