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

/** Pillars are drawn as blocks with a lit top face, so they read as tall cover rather than more border. */
export const COLOR_PILLAR_TOP = 0xa9673a;
export const COLOR_PILLAR_BODY = 0x2b3a68;
/** Near-black rather than blue-black: the logo outlines every shape in it, and so does the arena. */
export const COLOR_PILLAR_EDGE = 0x0b0f1c;

/** A destructible fades from fresh to broken against its own starting HP, so hay and crates share these. */
export const COLOR_OBSTACLE_FRESH = 0xc8aa3c;
export const COLOR_OBSTACLE_BROKEN = 0x782828;

/** Ember, not gold: gold now means one thing only (ougi charged / winner), and a spawn tile is neither. */
export const COLOR_SPAWN = 0xf97316;
