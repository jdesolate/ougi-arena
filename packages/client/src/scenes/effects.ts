import Phaser from "phaser";

/** Generated at runtime rather than shipped — a soft dot is the only particle shape the juice pass needs. */
const SPARK_TEXTURE_KEY = "spark";

export const DEPTH_WORLD = 0;
export const DEPTH_PARTICLES = 5;
/**
 * Ninjas and pillars share one depth band ordered by world y, so a pillar occludes whoever is standing behind
 * it. The band is wide enough for the tallest arena, and everything above it is screen-space furniture.
 */
export const DEPTH_YSORT_BASE = 100;
export const DEPTH_OVERLAY = 1000;
export const DEPTH_AIM = 1010;

/** Depth for a y-sorted object, keyed off the bottom of its footprint rather than its centre. */
export function ySortDepth(bottomY: number): number {
  return DEPTH_YSORT_BASE + bottomY;
}

/**
 * The juice layer: particle bursts, camera shake and hit-pause. Kept out of `GameScene` so the scene stays
 * about state and rendering, and so an effect can be retuned without touching netcode.
 */
export class MatchEffects {
  private readonly scene: Phaser.Scene;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Freezes the sim briefly so a hit lands with weight; wall-clock time keeps accruing so it catches straight back up. */
  private hitPauseUntil = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(): void {
    if (!this.scene.textures.exists(SPARK_TEXTURE_KEY)) {
      const g = this.scene.make.graphics({}, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture(SPARK_TEXTURE_KEY, 8, 8);
      g.destroy();
    }

    this.sparks = this.scene.add.particles(0, 0, SPARK_TEXTURE_KEY, {
      speed: { min: 60, max: 220 },
      lifespan: { min: 200, max: 450 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.sparks.setDepth(DEPTH_PARTICLES);

    this.smoke = this.scene.add.particles(0, 0, SPARK_TEXTURE_KEY, {
      speed: { min: 10, max: 60 },
      lifespan: { min: 500, max: 900 },
      scale: { start: 1.6, end: 3.2 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    });
    this.smoke.setDepth(DEPTH_PARTICLES);
  }

  /** Sharp directional-ish spray for impacts: dash landings, wall hits, obstacle chips. */
  burst(x: number, y: number, color: number, count: number): void {
    this.sparks.setParticleTint(color);
    this.sparks.emitParticleAt(x, y, count);
  }

  /** The KO/respawn smoke puff the movement design called for since S3. */
  puff(x: number, y: number, color: number, count = 14): void {
    this.smoke.setParticleTint(color);
    this.smoke.emitParticleAt(x, y, count);
  }

  shake(durationMs: number, intensity: number): void {
    this.scene.cameras.main.shake(durationMs, intensity);
  }

  flash(durationMs: number, r: number, g: number, b: number): void {
    this.scene.cameras.main.flash(durationMs, r, g, b);
  }

  hitPause(durationMs: number): void {
    this.hitPauseUntil = Math.max(this.hitPauseUntil, performance.now() + durationMs);
  }

  isPaused(): boolean {
    return performance.now() < this.hitPauseUntil;
  }

  reset(): void {
    this.hitPauseUntil = 0;
  }
}
