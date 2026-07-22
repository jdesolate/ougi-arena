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

/** Launch speed range mapped from drag power 0..1. */
export const LAUNCH_SPEED_MIN = 220;
export const LAUNCH_SPEED_MAX = 900;

/** Bounciness of ninja-vs-ninja, ninja-vs-wall and ninja-vs-obstacle collisions. */
export const NINJA_RESTITUTION = 0.55;
export const WALL_RESTITUTION = 0.6;
export const OBSTACLE_RESTITUTION = 0.5;

/** Knockback added along the contact normal on top of the elastic exchange, to make hits read as hits. */
export const KNOCKBACK_BONUS = 90;

/** Impact speed below which a contact is treated as a nudge: no event, no damage. */
export const MIN_IMPACT_SPEED = 120;

/** Destructible obstacle tuning. */
export const OBSTACLE_HP = 100;
export const OBSTACLE_DAMAGE_PER_IMPACT_SPEED = 0.22;

/** Extra separation applied when resolving overlap, to stop bodies re-colliding on the next tick. */
export const SEPARATION_SLOP = 0.01;
