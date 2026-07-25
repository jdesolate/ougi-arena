/**
 * The arena's colours, in one place because two things draw the same world: the Phaser scene and the lobby's
 * map thumbnails. A picker that didn't match the arena you land in would be worse than no picker.
 */
export const COLOR_FLOOR = 0x0f3460;
export const COLOR_BORDER = 0x16213e;

/** Pillars are drawn as blocks with a lit top face, so they read as tall cover rather than more border. */
export const COLOR_PILLAR_TOP = 0x4a5f9e;
export const COLOR_PILLAR_BODY = 0x2b3a68;
export const COLOR_PILLAR_EDGE = 0x131c33;

/** A destructible fades from fresh to broken against its own starting HP, so hay and crates share these. */
export const COLOR_OBSTACLE_FRESH = 0xc8aa3c;
export const COLOR_OBSTACLE_BROKEN = 0x782828;

export const COLOR_SPAWN = 0xffd166;
