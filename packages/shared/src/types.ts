export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box described by its centre and half extents. */
export interface Aabb {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

export interface NinjaState {
  id: string;
  /** Picks the Ougi this ninja fires; base stats are identical across characters. */
  characterId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** World units left to travel in the current dash; movement is clipped to this so a launch stops exactly where its drag reached, never overshooting. */
  dashBudget: number;
  /** True only for a player-launched dash — knockback moves a ninja on the same budget but must not shatter anyone. */
  dashLethal: boolean;
  /** Inactive ninjas (KO'd, spectating, disconnected) are skipped entirely by the sim. */
  active: boolean;
  hp: number;
  /** Also the hard cap on dash range — a launch costs 1 TP per world unit dashed. */
  tp: number;
  /** True while the player is pressing-and-holding this ninja; TP only refills during this window. */
  charging: boolean;
  /** Ougi meter; charges by dealing damage and is spent in full to fire this character's Ougi. */
  sp: number;
  /** Ticks left of a duration Ougi; 0 when none is running. */
  ougiTicks: number;
  /** Generic dash-reach buff an Ougi may set; 1 normally. Ougi buffs live in fields like this so a KO can clear them. */
  dashRangeMultiplier: number;
  /** Picks the melee attack this ninja swings; an independent choice from `characterId`. */
  weaponId: string;
  /** Last cardinal this ninja dashed or swung in. The attack pattern rotates with it, and the renderer orients the sprite by it. */
  facingX: number;
  facingY: number;
  /** Ticks left before this ninja may swing again; an attack arriving during it is dropped, never buffered. */
  attackCooldown: number;
  /** Ticks left of post-respawn invulnerability; 0 when vulnerable. */
  invulnerableTicks: number;
  /** Ticks left before a KO'd ninja respawns; 0 while alive. */
  respawnTicks: number;
}

/** A destructible box as authored in map data; `hp` is what tells a hay bale from a crate. */
export interface ObstacleTemplate extends Aabb {
  hp: number;
}

export interface ObstacleState extends ObstacleTemplate {
  id: number;
  /** What this obstacle started with, so a renderer can show damage without knowing its tier. */
  maxHp: number;
  alive: boolean;
}

/** The cell grid a map is authored on; `CELL` is the size, so only the placement varies per map. */
export interface ArenaGrid {
  /** World position of the top-left corner of cell (0, 0) — the inside face of the border wall. */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
}

export interface ArenaMap {
  id: string;
  /** Display name for the lobby's map picker; the id is what syncs. */
  name: string;
  width: number;
  height: number;
  /** Dash destinations snap to this grid's cell centres, which is what keeps the board self-aligning. */
  grid: ArenaGrid;
  /** Indestructible geometry the sim collides against: `border` and `pillars` concatenated. */
  walls: Aabb[];
  /** The arena's outer frame. Split out from `pillars` only because the two render differently. */
  border: Aabb[];
  /** Stone pillars, the cover that forms the choke points. Tall enough that the renderer Y-sorts them. */
  pillars: Aabb[];
  /** Destructible boxes, reset from this template at match start. */
  obstacles: ObstacleTemplate[];
  spawns: Vec2[];
}

export interface SimState {
  tick: number;
  map: ArenaMap;
  /** Stable order — iteration order is part of the determinism contract. */
  ninjas: NinjaState[];
  obstacles: ObstacleState[];
}

/** A released slingshot drag. `power` is clamped to 0..1; `dirX`/`dirY` need not be normalised. */
export interface LaunchCommand {
  type: "launch";
  ninjaId: string;
  dirX: number;
  dirY: number;
  power: number;
}

/** Fire this ninja's Ougi. Ignored unless the meter is full; the server is the only thing that issues it. */
export interface OugiCommand {
  type: "ougi";
  ninjaId: string;
}

/** Swing this ninja's weapon. `dirX`/`dirY` snap to a cardinal; a zero vector swings where the ninja already faces. */
export interface AttackCommand {
  type: "attack";
  ninjaId: string;
  dirX: number;
  dirY: number;
}

export type SimCommand = LaunchCommand | OugiCommand | AttackCommand;

export type SimEvent =
  | { type: "launch"; ninjaId: string; speed: number }
  | { type: "ougiFired"; ninjaId: string; ougiId: string }
  | { type: "ninjaAttacked"; ninjaId: string; weaponId: string; dirX: number; dirY: number }
  | { type: "ninjaDamaged"; targetId: string; sourceId: string; amount: number }
  | { type: "ninjaHit"; aId: string; bId: string; impact: number }
  | { type: "wallHit"; ninjaId: string; impact: number }
  /** `impact` is the closing speed of the dash that caused it, and 0 for a weapon hit — a swing has no speed. */
  | { type: "obstacleHit"; ninjaId: string; obstacleId: number; impact: number; damage: number }
  | { type: "obstacleDestroyed"; ninjaId: string; obstacleId: number }
  | { type: "ninjaKO"; targetId: string; killerId: string };
