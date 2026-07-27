import Phaser from "phaser";
import { COLOR_SWING_BLADE, COLOR_SWING_STEEL, COLOR_SWING_WIND } from "../world-palette.js";

/** Generated at runtime rather than shipped — a soft dot is the only particle shape the juice pass needs. */
const SPARK_TEXTURE_KEY = "spark";
/** A hard-edged chip, so a shattered crate throws debris rather than more of the same soft glow. */
const SHARD_TEXTURE_KEY = "shard";
/** The cut a landed hit leaves behind: a lens laid across the swing, brightest at its middle. */
const SLASH_TEXTURE_KEY = "slash-mark";

export const DEPTH_WORLD = 0;
export const DEPTH_PARTICLES = 5;
/**
 * Ninjas and pillars share one depth band ordered by world y, so a pillar occludes whoever is standing behind
 * it. The band is wide enough for the tallest arena, and everything above it is screen-space furniture.
 */
export const DEPTH_YSORT_BASE = 100;
export const DEPTH_OVERLAY = 1000;
export const DEPTH_AIM = 1010;
/** Swings and slash marks draw over the whole Y-sort band: a weapon in front of you must never be occluded by you. */
export const DEPTH_SWING = 900;

/**
 * How each weapon's swing is drawn, keyed by the shared weapon id. `sweep` is the arc the visual travels while
 * it plays — zero for the kunai, because a thrust is a line, not a slash — and the scales carry the motion the
 * rotation can't: the kunai's streak extends, the two arcs bloom outward.
 */
interface SwingStyle {
  key: string;
  originX: number;
  sweepRad: number;
  from: { scaleX: number; scaleY: number };
  to: { scaleX: number; scaleY: number };
  durationMs: number;
}

const SWING_STYLES = {
  kunai: {
    key: "swing-kunai",
    originX: 0,
    sweepRad: 0,
    from: { scaleX: 0.45, scaleY: 1 },
    to: { scaleX: 1.15, scaleY: 0.7 },
    durationMs: 150,
  },
  fan: {
    key: "swing-fan",
    originX: 0.5,
    sweepRad: 0.9,
    from: { scaleX: 0.85, scaleY: 0.85 },
    to: { scaleX: 1.08, scaleY: 1.08 },
    durationMs: 200,
  },
  longsword: {
    key: "swing-longsword",
    originX: 0.5,
    sweepRad: 1.3,
    from: { scaleX: 0.9, scaleY: 0.9 },
    to: { scaleX: 1.06, scaleY: 1.06 },
    durationMs: 260,
  },
} satisfies Record<string, SwingStyle>;

/** Falls back to the kunai's thrust, mirroring how the shared weapon table resolves an unknown id. */
function swingStyle(weaponId: string): SwingStyle {
  const styles: Record<string, SwingStyle | undefined> = SWING_STYLES;
  return styles[weaponId] ?? SWING_STYLES.kunai;
}

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
  /** Debris from a shattered destructible: hard chips that fall, unlike the soft smoke they land in. */
  private shards!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Kicked off the floor by a body being shoved across it. */
  private dustCloud!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Freezes the sim briefly so a hit lands with weight; wall-clock time keeps accruing so it catches straight back up. */
  private hitPauseUntil = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(): void {
    this.makeTexture(SPARK_TEXTURE_KEY, 8, 8, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
    });
    this.makeTexture(SHARD_TEXTURE_KEY, 6, 6, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 6, 6);
    });
    // A lens rather than a bar: a cut is thickest where the edge bit and tapers off at both ends.
    this.makeTexture(SLASH_TEXTURE_KEY, 56, 16, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(0, 8, 28, 0, 56, 8);
      g.fillTriangle(0, 8, 28, 16, 56, 8);
    });
    this.createSwingTextures();

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

    this.shards = this.scene.add.particles(0, 0, SHARD_TEXTURE_KEY, {
      speed: { min: 90, max: 280 },
      lifespan: { min: 380, max: 700 },
      scale: { start: 1, end: 0.5 },
      alpha: { start: 1, end: 0.2 },
      rotate: { start: 0, end: 220 },
      // Chips arc and fall; without gravity they read as another spark burst.
      gravityY: 420,
      emitting: false,
    });
    this.shards.setDepth(DEPTH_PARTICLES);

    this.dustCloud = this.scene.add.particles(0, 0, SPARK_TEXTURE_KEY, {
      speed: { min: 15, max: 70 },
      lifespan: { min: 260, max: 520 },
      scale: { start: 0.7, end: 1.8 },
      alpha: { start: 0.45, end: 0 },
      emitting: false,
    });
    this.dustCloud.setDepth(DEPTH_PARTICLES);
  }

  /**
   * The three swing shapes, generated once. Each is drawn in its own colour rather than tinted at play time so
   * the longsword can carry two (an ember body under a silver edge) — the read the brief asked for.
   */
  private createSwingTextures(): void {
    this.makeTexture(SWING_STYLES.kunai.key, 96, 16, (g) => {
      // Widest at the fist and tapering to the point: a thrust, drawn as the line it travels.
      g.fillStyle(COLOR_SWING_STEEL, 0.85);
      g.fillTriangle(0, 1, 0, 15, 96, 8);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 7, 86, 2);
    });

    this.makeTexture(SWING_STYLES.fan.key, 240, 240, (g) => {
      g.lineStyle(26, COLOR_SWING_WIND, 0.45);
      g.beginPath();
      g.arc(120, 120, 88, -1.0, 1.0);
      g.strokePath();
      g.lineStyle(9, 0xffffff, 0.85);
      g.beginPath();
      g.arc(120, 120, 88, -0.92, 0.92);
      g.strokePath();
    });

    this.makeTexture(SWING_STYLES.longsword.key, 340, 340, (g) => {
      g.lineStyle(34, COLOR_SWING_BLADE, 0.45);
      g.beginPath();
      g.arc(170, 170, 142, -0.62, 0.62);
      g.strokePath();
      g.lineStyle(11, COLOR_SWING_STEEL, 0.95);
      g.beginPath();
      g.arc(170, 170, 142, -0.58, 0.58);
      g.strokePath();
    });
  }

  private makeTexture(
    key: string,
    width: number,
    height: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void {
    if (this.scene.textures.exists(key)) return;
    const g = this.scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(key, width, height);
    g.destroy();
  }

  /**
   * The swing itself, played at the attacker and rotated to the cardinal it was aimed down. Cosmetic only —
   * the pattern it suggests is the weapon's, but what actually got hit is whatever the server says it did.
   */
  swing(weaponId: string, x: number, y: number, angleRad: number): void {
    const style = swingStyle(weaponId);
    const image = this.scene.add
      .image(x, y, style.key)
      .setOrigin(style.originX, 0.5)
      .setDepth(DEPTH_SWING)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(angleRad - style.sweepRad / 2)
      .setScale(style.from.scaleX, style.from.scaleY);

    this.scene.tweens.add({
      targets: image,
      rotation: angleRad + style.sweepRad / 2,
      scaleX: style.to.scaleX,
      scaleY: style.to.scaleY,
      alpha: { from: 1, to: 0 },
      duration: style.durationMs,
      ease: "Quad.easeOut",
      onComplete: () => image.destroy(),
    });
  }

  /** The mark a landed hit leaves: laid across the direction of the blow, so it reads as a cut and not a flash. */
  slash(x: number, y: number, angleRad: number, color: number): void {
    const image = this.scene.add
      .image(x, y, SLASH_TEXTURE_KEY)
      .setDepth(DEPTH_SWING)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(angleRad)
      .setTint(color)
      .setScale(0.5, 1);

    this.scene.tweens.add({
      targets: image,
      scaleX: 1.35,
      scaleY: 0.5,
      alpha: { from: 1, to: 0 },
      duration: 190,
      ease: "Quad.easeOut",
      onComplete: () => image.destroy(),
    });
  }

  /** Debris from a destructible that just came apart, thrown in the box's own colour so it reads as that box. */
  shatter(x: number, y: number, color: number, count = 14): void {
    this.shards.setParticleTint(color);
    this.shards.emitParticleAt(x, y, count);
  }

  /** Floor kicked up under a body being shoved — the ground truth that a knockback is movement, not a teleport. */
  dust(x: number, y: number, color: number, count = 6): void {
    this.dustCloud.setParticleTint(color);
    this.dustCloud.emitParticleAt(x, y, count);
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
