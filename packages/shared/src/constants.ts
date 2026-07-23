/** Fixed simulation rate; server and client must both step at exactly this rate. */
export const SIM_TICK_RATE_HZ = 30;

/** Fixed timestep in seconds. Never derive this from wall-clock delta — determinism depends on it. */
export const SIM_DT = 1 / SIM_TICK_RATE_HZ;

/** Ninja body radius in world units. */
export const NINJA_RADIUS = 18;

/** Velocity retained per tick; a per-tick constant rather than a per-second rate so no pow() enters the sim. */
export const LINEAR_DAMPING_PER_TICK = 0.93;

/** Below this speed a ninja is snapped to rest, so dashes end at the same tick everywhere. */
export const REST_SPEED = 6;

/** Launch speed range mapped from drag power 0..1; travel distance is separately capped by MAX_DASH_DISTANCE. */
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

/** Bounciness of ninja-vs-ninja collisions. Walls and obstacles hard-stop a dash instead of bouncing it. */
export const NINJA_RESTITUTION = 0.55;

/** Knockback added along the contact normal on top of the elastic exchange, to make hits read as hits. */
export const KNOCKBACK_BONUS = 90;

/** Impact speed below which a contact is treated as a nudge: no event, no damage. */
export const MIN_IMPACT_SPEED = 120;

/** Destructible obstacle tuning. */
export const OBSTACLE_HP = 100;
export const OBSTACLE_DAMAGE_PER_IMPACT_SPEED = 0.22;

/** Extra separation applied when resolving overlap, to stop bodies re-colliding on the next tick. */
export const SEPARATION_SLOP = 0.01;
