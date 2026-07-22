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
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Inactive ninjas (KO'd, spectating, disconnected) are skipped entirely by the sim. */
  active: boolean;
}

export interface ObstacleState extends Aabb {
  id: number;
  hp: number;
  alive: boolean;
}

export interface ArenaMap {
  id: string;
  width: number;
  height: number;
  /** Indestructible geometry, including the arena border. */
  walls: Aabb[];
  /** Destructible grid, reset from this template at match start. */
  obstacles: Aabb[];
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

export type SimCommand = LaunchCommand;

export type SimEvent =
  | { type: "launch"; ninjaId: string; speed: number }
  | { type: "ninjaHit"; aId: string; bId: string; impact: number }
  | { type: "wallHit"; ninjaId: string; impact: number }
  | { type: "obstacleHit"; ninjaId: string; obstacleId: number; impact: number; damage: number }
  | { type: "obstacleDestroyed"; ninjaId: string; obstacleId: number };
