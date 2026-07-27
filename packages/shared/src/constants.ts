/** Fixed simulation rate; server and client must both step at exactly this rate. */
export const SIM_TICK_RATE_HZ = 30;

/** Fixed timestep in seconds. Never derive this from wall-clock delta — determinism depends on it. */
export const SIM_DT = 1 / SIM_TICK_RATE_HZ;

/**
 * The arena's single spatial quantum: maps are authored one character per cell, an obstacle fills exactly one,
 * and a dash lands on a cell centre. 1280x720 inside a 40-unit border is exactly 15x8 of these, and a full-TP
 * dash is 5 — so ranges read as tiles rather than pixels.
 */
export const CELL = 80;

/** Ninja body radius in world units. */
export const NINJA_RADIUS = 18;

/** Launch speed range mapped from drag power 0..1; it sets how *fast* a dash covers its distance, not how far. */
export const LAUNCH_SPEED_MIN = 220;
export const LAUNCH_SPEED_MAX = 900;

/** Max reach of a full-power (power=1) dash, in world units, before any TP cap is applied. */
export const MAX_DASH_DISTANCE = 400;

/** TP is spent 1:1 per world unit dashed, so it doubles as the hard cap on dash range. */
export const MAX_TP = MAX_DASH_DISTANCE;

/** TP only refills while the player holds their ninja (press-and-hold to charge) — never passively. Fills in this many seconds of holding. */
export const TP_CHARGE_SECONDS = 2.5;
export const TP_CHARGE_PER_TICK = MAX_TP / (TP_CHARGE_SECONDS * SIM_TICK_RATE_HZ);

/** Ninja hit points; a dash that shatters an enemy sets this straight to 0 rather than chipping it. */
export const MAX_HP = 100;

/** Ougi meter; charges by dealing damage, and a KO is worth the same as half a health bar of chip damage. */
export const MAX_SP = 100;
export const SP_GAIN_ON_KO = 50;
export const SP_PER_DAMAGE = 0.5;

/** Shockwave (Ember): instant radial burst, damage falling off linearly to nothing at the rim. */
export const SHOCKWAVE_RADIUS = 220;
export const SHOCKWAVE_MAX_DAMAGE = 60;
/** How far the burst flings a caught ninja at the epicentre; also scaled by the falloff. */
export const SHOCKWAVE_KNOCKBACK_DISTANCE = 140;
export const SHOCKWAVE_KNOCKBACK_SPEED = 520;

/** Surge (Gale): dash reach and TP tank both scale by this for the duration, and TP stays topped up. */
export const SURGE_DURATION_SECONDS = 5;
export const SURGE_DURATION_TICKS = SURGE_DURATION_SECONDS * SIM_TICK_RATE_HZ;
export const SURGE_DASH_MULTIPLIER = 2;

/** Cross Slash (Shade): four instant cardinal beams, each stopping at the first wall or live obstacle it cleaves. */
export const CROSS_SLASH_LANE_HALF_WIDTH = 14;

/**
 * Weapons. The cell patterns live in `weapon.ts`; these are the two numbers balance actually turns — damage per
 * swing and how often you may swing. Reach, coverage and speed are deliberately traded against each other:
 * the kunai has the highest sustained damage but only one cell of reach, the fan the widest cover, the
 * longsword the biggest single hit. All three chip HP; only a dash can instant-kill.
 */
export const KUNAI_DAMAGE = 8;
export const KUNAI_COOLDOWN_TICKS = 0.3 * SIM_TICK_RATE_HZ;
/**
 * S17 balance pass: was 12 (24 single-target dps, nearly matching kunai/longsword) but the fan hits up to 3
 * targets per swing, so in a crowd its *aggregate* output triples while the others don't — a live S15 match
 * showed it out-trading both. Per-target damage now sits clearly below the other two; the coverage itself,
 * not near-parity damage, is the fan's payoff.
 */
export const FAN_DAMAGE = 9;
export const FAN_COOLDOWN_TICKS = 0.5 * SIM_TICK_RATE_HZ;
export const LONGSWORD_DAMAGE = 20;
export const LONGSWORD_COOLDOWN_TICKS = 0.9 * SIM_TICK_RATE_HZ;

/** KO'd ninjas sit out this long before respawning, then are invulnerable for a further window. */
export const RESPAWN_DELAY_SECONDS = 3;
export const RESPAWN_DELAY_TICKS = RESPAWN_DELAY_SECONDS * SIM_TICK_RATE_HZ;
export const RESPAWN_INVULN_SECONDS = 2;
export const RESPAWN_INVULN_TICKS = RESPAWN_INVULN_SECONDS * SIM_TICK_RATE_HZ;

/** Fraction of max HP a respawned ninja comes back with. */
export const RESPAWN_HP_FRACTION = 0.5;

/** Regulation match length; sudden death (next KO wins) kicks in if the leaderboard is tied when this expires. */
export const MATCH_DURATION_SECONDS = 120;
export const MATCH_DURATION_TICKS = MATCH_DURATION_SECONDS * SIM_TICK_RATE_HZ;

/** Pre-match freeze: the arena is visible but the sim is held, so nobody dashes at a player still reading "3". */
export const COUNTDOWN_SECONDS = 3;
/** How long "FIGHT!" holds after the last number, before the sim actually starts. */
export const COUNTDOWN_FIGHT_TICKS = Math.round(0.6 * SIM_TICK_RATE_HZ);
export const COUNTDOWN_TICKS = COUNTDOWN_SECONDS * SIM_TICK_RATE_HZ + COUNTDOWN_FIGHT_TICKS;

/** Bounciness of ninja-vs-ninja collisions. Walls and obstacles hard-stop a dash instead of bouncing it. */
export const NINJA_RESTITUTION = 0.55;

/** Knockback added along the contact normal on top of the elastic exchange, to make hits read as hits. */
export const KNOCKBACK_BONUS = 90;

/** Impact speed below which a contact is treated as a nudge: no event, no damage. */
export const MIN_IMPACT_SPEED = 120;

/**
 * Destructible tiers. Starting HP lives per-obstacle in map data rather than globally, so a corner of hay
 * clears in a single hit while a crate takes a committed dash; these are just the two authored defaults.
 */
export const CRATE_HP = 100;
/**
 * S17 balance pass: was 40. FR-10 promises hay "clears in 1-2 hits", which only held for the longsword (2
 * hits) — kunai needed 5 and the fan 4. Lowered so every weapon clears a hay bale in 1-2 hits as designed;
 * a dash impact already one-shots it regardless (unchanged, per S12).
 */
export const HAY_HP = 16;
export const OBSTACLE_DAMAGE_PER_IMPACT_SPEED = 0.22;

/** Extra separation applied when resolving overlap, to stop bodies re-colliding on the next tick. */
export const SEPARATION_SLOP = 0.01;
