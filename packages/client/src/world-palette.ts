/**
 * The arena's colours, in one place because two things draw the same world: the Phaser scene and the lobby's
 * map thumbnails. A picker that didn't match the arena you land in would be worse than no picker.
 *
 * The DOM shares this palette too: src/style.css maps these constants onto CSS tokens
 * (see the header comment there). A value changed here must change there as well.
 */
/**
 * The arena splits warm against cool the way the logo badge does: a cold blue floor with ember light
 * catching whatever stands up out of it. Cover you can hide behind is the warm thing on screen, so the
 * split does double duty as readability.
 */
export const COLOR_FLOOR = 0x0f3460;
export const COLOR_BORDER = 0x16213e;

/** The floor is tiled on the sim's own `CELL` grid, so "a dash lands on a tile" is visible before you drag. */
export const COLOR_FLOOR_TILE = 0x123c6e;
export const COLOR_FLOOR_LINE = 0x0b2748;

/** Pillars are drawn as blocks with a lit top face, so they read as tall cover rather than more border. */
export const COLOR_PILLAR_TOP = 0xa9673a;
/** The ember light lands hardest on the front lip of the top face; the rest of the face falls off from it. */
export const COLOR_PILLAR_TOP_LIT = 0xd98a4a;
export const COLOR_PILLAR_BODY = 0x2b3a68;
/** The body is in its own shadow toward the floor, which is what sells the height. */
export const COLOR_PILLAR_BODY_DARK = 0x1b2545;
/** Near-black rather than blue-black: the logo outlines every shape in it, and so does the arena. */
export const COLOR_PILLAR_EDGE = 0x0b0f1c;

/** The border is a wall seen from slightly above: a dark cap with a lit inner face turned toward the arena. */
export const COLOR_BORDER_FACE = 0x22315a;

/** Everything standing above the floor drops the same shadow, so the arena reads as one light. */
export const COLOR_SHADOW = 0x050a18;
export const SHADOW_ALPHA = 0.38;
/** Down-right, matching the ember key light implied by the lit pillar tops. */
export const SHADOW_OFFSET_X = 7;
export const SHADOW_OFFSET_Y = 9;

/** A destructible fades from fresh to broken against its own starting HP, so hay and crates share these. */
export const COLOR_OBSTACLE_FRESH = 0xc8aa3c;
export const COLOR_OBSTACLE_BROKEN = 0x782828;
/** Same near-black keyline the pillars and the logo use, so a crate belongs to the same drawing. */
export const COLOR_OBSTACLE_EDGE = 0x0b0f1c;

/** Ember, not gold: gold now means one thing only (ougi charged / winner), and a spawn tile is neither. */
export const COLOR_SPAWN = 0xf97316;

/**
 * Weapon light. Each swing gets its own colour so you can read what hit you from the flash alone: steel-white
 * for the kunai's thrust, pale ice for the fan's wind, ember-red edged in silver for the longsword's arc.
 */
export const COLOR_SWING_STEEL = 0xf2f7ff;
export const COLOR_SWING_WIND = 0x9fe3ff;
export const COLOR_SWING_BLADE = 0xff3b1f;

/** Kicked up by a knockback slide and by a body scraping to a halt — the floor's own tone, not the weapon's. */
export const COLOR_DUST = 0x8a9ec4;
