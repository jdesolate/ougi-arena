import Phaser from "phaser";
import { COLOR_SWING_BLADE, COLOR_SWING_STEEL, COLOR_SWING_WIND } from "../world-palette.js";

/** Generated at runtime rather than shipped — a soft dot is the only particle shape the juice pass needs. */
const SPARK_TEXTURE_KEY = "spark";
/** A hard-edged chip, so a shattered crate throws debris rather than more of the same soft glow. */
const SHARD_TEXTURE_KEY = "shard";
/** The cut a landed hit leaves behind: a lens laid across the swing, brightest at its middle. */
const SLASH_TEXTURE_KEY = "slash-mark";
/** One lane of an Ougi beam, stretched to whatever reach the sim measured for it. */
const BEAM_TEXTURE_KEY = "ougi-beam";

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
 * it plays — zero for the two thrusts, because a line down one lane is not a slash — and the scales carry the
 * motion the rotation can't: the kunai and longsword streaks extend, the fan's arc blooms outward.
 *
 * The shapes have to match the cell patterns in `weapon.ts` or the visual lies about reach: only the fan covers
 * the cells beside it, so only the fan sweeps.
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
    originX: 0,
    sweepRad: 0,
    from: { scaleX: 0.4, scaleY: 1.1 },
    to: { scaleX: 1.05, scaleY: 0.8 },
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
    // Bright core with a taper at the far end, so a beam reads as thrown outward rather than as a placed bar.
    this.makeTexture(BEAM_TEXTURE_KEY, 64, 24, (g) => {
      g.fillStyle(0xffffff, 0.55);
      g.fillTriangle(0, 1, 0, 23, 64, 12);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 9, 58, 6);
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
  }

  /**
   * The three swing shapes, generated once. Each is drawn in its own colour rather than tinted at play time so
   * the longsword can carry two (an ember body under a silver edge) — the read the brief asked for.
   *
   * The two thrusts are sized to the cells they actually hit: the kunai reaches one cell, the longsword two.
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

    // Twice the kunai's reach and heavier with it: the same thrust, carried a cell further.
    this.makeTexture(SWING_STYLES.longsword.key, 190, 28, (g) => {
      g.fillStyle(COLOR_SWING_BLADE, 0.5);
      g.fillTriangle(0, 2, 0, 26, 190, 14);
      g.fillStyle(COLOR_SWING_STEEL, 0.9);
      g.fillTriangle(0, 7, 0, 21, 190, 14);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 12, 176, 4);
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

  /**
   * An Ougi's blast front, expanding to exactly the radius the sim damages within — the whole point is that a
   * player can see how far Shockwave reached and where they were standing in it.
   *
   * Drawn into a Graphics tweened through a proxy rather than scaled from a texture, because a scaled ring
   * thickens as it grows and would overstate the rim; the line width has to stay put while the radius moves.
   */
  ring(x: number, y: number, maxRadius: number, color: number, durationMs = 340): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_SWING).setBlendMode(Phaser.BlendModes.ADD);
    const front = { r: maxRadius * 0.18, a: 1 };

    this.scene.tweens.add({
      targets: front,
      r: maxRadius,
      a: 0,
      duration: durationMs,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        g.clear();
        g.lineStyle(7, color, front.a);
        g.strokeCircle(x, y, front.r);
        g.lineStyle(2, 0xffffff, front.a);
        g.strokeCircle(x, y, front.r * 0.92);
      },
      onComplete: () => g.destroy(),
    });
  }

  /** One lane of a beam Ougi, drawn to the reach the sim measured so it stops on the cover that blocked it. */
  beam(x: number, y: number, angleRad: number, length: number, color: number, durationMs = 280): void {
    const image = this.scene.add
      .image(x, y, BEAM_TEXTURE_KEY)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH_SWING)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setRotation(angleRad)
      .setScale(length / 64, 0.4);

    this.scene.tweens.add({
      targets: image,
      scaleY: 1.15,
      alpha: { from: 1, to: 0 },
      duration: durationMs,
      ease: "Quad.easeOut",
      onComplete: () => image.destroy(),
    });
  }

  /** Debris from a destructible that just came apart, thrown in the box's own colour so it reads as that box. */
  shatter(x: number, y: number, color: number, count = 14): void {
    this.shards.setParticleTint(color);
    this.shards.emitParticleAt(x, y, count);
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
