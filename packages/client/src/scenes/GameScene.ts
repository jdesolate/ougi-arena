import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  CELL,
  MAX_HP,
  MAX_SP,
  MAX_TP,
  NINJA_RADIUS,
  SIM_DT,
  clamp,
  createSimState,
  dashDistanceFor,
  laneDistance,
  lengthOf,
  maxDashDistanceOf,
  ougiForCharacter,
  snapToCardinal,
  snapToCellCentre,
  step,
  weaponFor,
  type Aabb,
  type ArenaMap,
  type LaunchCommand,
  type SimEvent,
  type SimState,
} from "@ougi-arena/shared";
import {
  NINJA_SPRITE_SCALE,
  NINJA_TEXTURE_KEY,
  NINJA_TEXTURE_PATH,
  skinFor,
} from "../skins.js";
import { ougiSfxKey, playSfx, preloadSfx } from "../audio/sfx.js";
import { drawWeaponIcon } from "../ui/weapon-icon.js";
import {
  DEPTH_AIM,
  DEPTH_OVERLAY,
  DEPTH_WORLD,
  MatchEffects,
  ySortDepth,
} from "./effects.js";
import {
  COLOR_BORDER,
  COLOR_BORDER_FACE,
  COLOR_FLOOR,
  COLOR_FLOOR_LINE,
  COLOR_FLOOR_TILE,
  COLOR_OBSTACLE_BROKEN,
  COLOR_OBSTACLE_EDGE,
  COLOR_OBSTACLE_FRESH,
  COLOR_PILLAR_BODY,
  COLOR_PILLAR_BODY_DARK,
  COLOR_PILLAR_EDGE,
  COLOR_PILLAR_TOP,
  COLOR_PILLAR_TOP_LIT,
  COLOR_SHADOW,
  SHADOW_ALPHA,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Y,
} from "../world-palette.js";

const SIM_DT_MS = SIM_DT * 1000;
/** Caps how many fixed steps run in one frame, so a tab-switch stall can't spiral into a freeze. */
const MAX_STEPS_PER_FRAME = 5;

/** Generous grab radius so the drag doesn't need pixel-perfect precision on the ninja. */
const GRAB_RADIUS = NINJA_RADIUS * 2.5;
/** A release within this many world units of the press point on your own ninja is too small to count as a dash. */
const TAP_DRAG_THRESHOLD = 10;
/**
 * No dedicated swing SFX is shipped yet (S15 adds no new audio assets) — "wall" (a light impact) is the
 * closest fit already in the pack, leveled per weapon so a longsword reads heavier than a kunai poke.
 */
const WEAPON_SFX_VOLUME: Record<string, number> = { kunai: 0.35, fan: 0.45, longsword: 0.55 };

/** Render remote ninjas this far in the past so there's always a pair of snapshots to interpolate between. */
const INTERP_DELAY_MS = 100;
/** How long to keep snapshots around; comfortably longer than the interpolation delay. */
const SNAPSHOT_BUFFER_MS = 1000;

/** Round-trip probe cadence for the debug overlay's latency readout. */
const PING_INTERVAL_MS = 1000;
/** Reconciliation snaps below this are rounding, not a misprediction worth counting as a correction. */
const CORRECTION_THRESHOLD_PX = 2;
/** Give up waiting for a launch receipt after this long, so a lost ack can't strand prediction off-server forever. */
const LAUNCH_ACK_TIMEOUT_MS = 1500;

/** Long enough to feel the hit land, short enough that one frame of catch-up absorbs it. */
const HIT_PAUSE_MS = 55;
const KO_HIT_PAUSE_MS = 110;
/** The match clock ticks audibly over the closing seconds. */
const COUNTDOWN_FROM_SECONDS = 5;

/** Runtime-generated, like the spark: a pillar is a flat-shaded block, not art worth shipping a file for. */
const PILLAR_TEXTURE_KEY = "pillar";
/** How far a pillar rises above its own cell. This overhang is the whole point of Y-sorting them. */
const PILLAR_RISE = 52;
/** How much of the top face catches the ember key light before it falls off into the body's tone. */
const PILLAR_TOP_LIT_BAND = 14;

/** Tiled across the arena on the sim's own grid, so the cells a dash snaps to are visible while standing still. */
const FLOOR_TEXTURE_KEY = "floor-tile";
/** The floor sits below `DEPTH_WORLD` so obstacles, shadows and the border still draw over it. */
const DEPTH_FLOOR = -10;

/** Loosely-typed view of the server schema — the client bundle doesn't share the schema classes. */
interface NinjaView {
  id: string;
  x: number;
  y: number;
  active: boolean;
  /** True while the server still has this ninja mid-dash — reconciling against it would rubber-band. */
  dashing: boolean;
  hp: number;
  tp: number;
  charging: boolean;
  sp: number;
  ougiTicks: number;
  dashRangeMultiplier: number;
  invulnerableTicks: number;
  weaponId: string;
  facingX: number;
  facingY: number;
  attackCooldown: number;
}
interface ObstacleView {
  hp: number;
  alive: boolean;
}
interface PlayerView {
  characterId: string;
  nickname: string;
  isHost: boolean;
  isBot: boolean;
  score: number;
}
interface ArenaStateView {
  phase: string;
  mapId: string;
  tick: number;
  matchTimeRemaining: number;
  suddenDeath: boolean;
  winnerId: string;
  players: { get(id: string): PlayerView | undefined };
  ninjas: NinjaView[];
  obstacles: ObstacleView[];
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

interface Snapshot {
  t: number;
  ninjas: Map<string, { x: number; y: number; active: boolean }>;
}

/**
 * Renders the authoritative match: remote ninjas via ~100ms snapshot interpolation, the local ninja via a
 * small prediction sim so its dash starts at 0ms (optimistic launch) and reconciles to the server when at rest.
 */
export class GameScene extends Phaser.Scene {
  private readonly room: Room;
  private readonly localId: string;
  /** The arena the host picked, resolved once from the synced `mapId` — it can't change while a match runs. */
  private readonly map: ArenaMap;

  /** Predicts the local ninja only; remote ninjas come straight from interpolated snapshots. */
  private localSim: SimState | null = null;
  private accumulatorMs = 0;
  private pendingLocalCommand: LaunchCommand | null = null;

  /** Launches sent vs. launches the server has confirmed applying; unequal means our dash isn't in its world yet. */
  private launchSeq = 0;
  private ackedSeq = 0;
  private launchSentAt = 0;

  private snapshots: Snapshot[] = [];
  /** Detects the "finished" → "playing" transition on rematch, so prediction state gets rebuilt from scratch. */
  private lastPhase = "";

  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  /** Set on a press outside the grab radius; the matching release swings toward that point instead of dashing. */
  private awayTapArmed = false;

  private worldGfx!: Phaser.GameObjects.Graphics;
  /** Drawn above the ninja sprites: HP bars and the Ougi aura. */
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;

  private readonly effects = new MatchEffects(this);
  /** One sprite per ninja, created on first sight and reused; `drawWorld` only repositions them. */
  private readonly ninjaSprites = new Map<string, Phaser.GameObjects.Sprite>();
  /** One nameplate per ninja — characters repeat in a room, so this is the only way to tell ninjas apart mid-fight. */
  private readonly nameplates = new Map<string, Phaser.GameObjects.Text>();
  /** Drives the countdown beep off whole-second changes rather than every state sync. */
  private lastTimeRemaining = -1;

  private readonly hudEl = el<HTMLDivElement>("hud");
  private readonly hudTimerEl = el<HTMLSpanElement>("hud-timer");
  private readonly hudAliveEl = el<HTMLSpanElement>("hud-alive");
  private readonly hudHpFillEl = el<HTMLDivElement>("hud-hp-fill");
  private readonly hudTpFillEl = el<HTMLDivElement>("hud-tp-fill");
  private readonly hudSpFillEl = el<HTMLDivElement>("hud-sp-fill");
  private readonly hudWeaponFrameEl = el<HTMLDivElement>("hud-weapon-frame");
  private readonly hudWeaponIconEl = el<HTMLCanvasElement>("hud-weapon-icon");
  private readonly hudWeaponFillEl = el<HTMLDivElement>("hud-weapon-fill");
  private readonly hudOugiBtn = el<HTMLButtonElement>("hud-ougi-btn");
  /** Tracks which weapon's icon is currently painted onto the canvas, so it's only redrawn on change. */
  private lastDrawnWeaponId = "";
  private readonly matchEndEl = el<HTMLDivElement>("match-end");
  private readonly matchEndTitleEl = el<HTMLHeadingElement>("match-end-title");
  private readonly matchEndResultsEl = el<HTMLUListElement>("match-end-results");
  private readonly matchEndRematchBtn = el<HTMLButtonElement>("match-end-rematch-btn");
  private readonly matchEndNoteEl = el<HTMLParagraphElement>("match-end-note");
  private readonly debugEl = el<HTMLDivElement>("debug");

  /** Latency diagnostics (FR-21), off unless toggled with F3 or opened with `?debug`. */
  private rttMs = 0;
  private lastStateAt = 0;
  private corrections = 0;
  private lastCorrectionPx = 0;

  constructor(room: Room, map: ArenaMap) {
    super("game");
    this.room = room;
    this.localId = room.sessionId;
    this.map = map;
  }

  preload(): void {
    this.load.image(NINJA_TEXTURE_KEY, NINJA_TEXTURE_PATH);
    preloadSfx(this.load);
  }

  create(): void {
    this.worldGfx = this.add.graphics().setDepth(DEPTH_WORLD);
    this.createFloor();
    this.createPillars();
    this.effects.create();
    this.overlayGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);
    this.aimGfx = this.add.graphics().setDepth(DEPTH_AIM);

    this.room.onMessage("events", (events: SimEvent[]) => this.handleSimEvents(events));

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);

    this.matchEndRematchBtn.addEventListener("click", () => this.room.send("rematch"));
    this.hudOugiBtn.addEventListener("click", () => this.fireOugi());
    this.input.keyboard?.on("keydown-SPACE", () => this.fireOugi());

    this.room.onMessage("pong", (sentAt: number) => {
      this.rttMs = performance.now() - sentAt;
    });
    this.room.onMessage("launchAck", (seq: number) => {
      this.ackedSeq = Math.max(this.ackedSeq, seq);
    });
    this.time.addEvent({
      delay: PING_INTERVAL_MS,
      loop: true,
      callback: () => this.room.send("ping", performance.now()),
    });
    this.input.keyboard?.on("keydown-F3", () => this.toggleDebug());
    if (new URLSearchParams(window.location.search).has("debug")) this.toggleDebug();

    this.hudEl.hidden = false;
    this.room.onStateChange(() => this.onServerState());

    this.onServerState();
    this.drawWorld();
  }

  update(_time: number, deltaMs: number): void {
    if (this.localSim) {
      // The accumulator keeps filling through a hit-pause, so the freeze is purely visual: the steps it holds
      // back all run on the frame it ends, and the local sim stays aligned with wall-clock time.
      this.accumulatorMs += deltaMs;
      let steps = 0;
      while (!this.effects.isPaused() && this.accumulatorMs >= SIM_DT_MS && steps < MAX_STEPS_PER_FRAME) {
        const commands = this.pendingLocalCommand ? [this.pendingLocalCommand] : [];
        this.pendingLocalCommand = null;
        step(this.localSim, commands);
        this.accumulatorMs -= SIM_DT_MS;
        steps++;
      }
    }

    this.drawWorld();
    if (this.dragging) this.drawAimLine();
    if (!this.debugEl.hidden) this.renderDebug();
  }

  /**
   * Pillars are static, so they're placed once as images rather than redrawn every frame. Each sits on the
   * bottom edge of its own cell and rises `PILLAR_RISE` above it, depth-sorted by that bottom edge — which is
   * what lets a ninja walk behind one and be occluded instead of sliding over the top of it.
   */
  private createPillars(): void {
    const height = CELL + PILLAR_RISE;
    if (!this.textures.exists(PILLAR_TEXTURE_KEY)) {
      const g = this.make.graphics({}, false);
      // Body darkens toward the floor, top face brightens toward its front lip — two bands each, no gradients,
      // because the rest of the arena is flat-shaded and a smooth ramp would read as a different game.
      g.fillStyle(COLOR_PILLAR_BODY_DARK, 1);
      g.fillRect(0, PILLAR_RISE, CELL, CELL);
      g.fillStyle(COLOR_PILLAR_BODY, 1);
      g.fillRect(0, PILLAR_RISE, CELL, CELL * 0.45);
      g.fillStyle(COLOR_PILLAR_TOP, 1);
      g.fillRect(0, 0, CELL, PILLAR_RISE);
      g.fillStyle(COLOR_PILLAR_TOP_LIT, 1);
      g.fillRect(0, PILLAR_RISE - PILLAR_TOP_LIT_BAND, CELL, PILLAR_TOP_LIT_BAND);
      // A heavy dark keyline separates two adjacent pillars into two blocks, and echoes the logo's outlines.
      g.lineStyle(3, COLOR_PILLAR_EDGE, 1);
      g.strokeRect(1.5, 1.5, CELL - 3, height - 3);
      g.lineBetween(0, PILLAR_RISE, CELL, PILLAR_RISE);
      g.generateTexture(PILLAR_TEXTURE_KEY, CELL, height);
      g.destroy();
    }

    for (const pillar of this.map.pillars) {
      const bottom = pillar.y + pillar.halfH;
      this.add.image(pillar.x, bottom, PILLAR_TEXTURE_KEY).setOrigin(0.5, 1).setDepth(ySortDepth(bottom));
    }
  }

  /**
   * The floor is one tiled sprite rather than per-frame fills: it never changes, and tiling it on `CELL` makes
   * the sim's grid legible, so a player can see the tiles a dash will snap to before they start dragging.
   */
  private createFloor(): void {
    if (!this.textures.exists(FLOOR_TEXTURE_KEY)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(COLOR_FLOOR, 1);
      g.fillRect(0, 0, CELL, CELL);
      // An inset panel plus seam lines: enough texture to feel like flagstones, quiet enough to stay a floor.
      g.fillStyle(COLOR_FLOOR_TILE, 1);
      g.fillRect(4, 4, CELL - 8, CELL - 8);
      g.lineStyle(2, COLOR_FLOOR_LINE, 1);
      g.strokeRect(1, 1, CELL - 2, CELL - 2);
      g.generateTexture(FLOOR_TEXTURE_KEY, CELL, CELL);
      g.destroy();
    }

    this.add
      .tileSprite(0, 0, this.map.width, this.map.height, FLOOR_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDepth(DEPTH_FLOOR);
  }

  /**
   * The border is drawn as a wall rather than a flat frame: the edge turned toward the arena gets a lit face
   * and a hard keyline, so the playfield reads as sunk inside walls instead of painted onto a rectangle.
   */
  private drawBorderFace(g: Phaser.GameObjects.Graphics, wall: Aabb): void {
    const face = 12;
    const left = wall.x - wall.halfW;
    const top = wall.y - wall.halfH;
    const w = wall.halfW * 2;
    const h = wall.halfH * 2;
    const horizontal = w >= h;

    g.fillStyle(COLOR_BORDER_FACE, 1);
    g.lineStyle(3, COLOR_PILLAR_EDGE, 1);
    if (horizontal) {
      const inner = wall.y < this.map.height / 2 ? top + h - face : top;
      g.fillRect(left, inner, w, face);
      const edgeY = wall.y < this.map.height / 2 ? top + h : top;
      g.lineBetween(left, edgeY, left + w, edgeY);
    } else {
      const inner = wall.x < this.map.width / 2 ? left + w - face : left;
      g.fillRect(inner, top, face, h);
      const edgeX = wall.x < this.map.width / 2 ? left + w : left;
      g.lineBetween(edgeX, top, edgeX, top + h);
    }
  }

  /** One light for the whole arena: everything standing above the floor drops the same offset shadow. */
  private dropShadow(g: Phaser.GameObjects.Graphics, box: Aabb): void {
    g.fillStyle(COLOR_SHADOW, SHADOW_ALPHA);
    g.fillRect(
      box.x - box.halfW + SHADOW_OFFSET_X,
      box.y - box.halfH + SHADOW_OFFSET_Y,
      box.halfW * 2,
      box.halfH * 2,
    );
  }

  private toggleDebug(): void {
    this.debugEl.hidden = !this.debugEl.hidden;
  }

  /** FR-21's diagnostics: what the connection is doing, and how often prediction had to be corrected. */
  private renderDebug(): void {
    const stateAge = this.lastStateAt > 0 ? performance.now() - this.lastStateAt : 0;
    this.debugEl.textContent = [
      `rtt        ${this.rttMs.toFixed(0)}ms`,
      `interp     ${INTERP_DELAY_MS}ms`,
      `tick       ${this.state().tick}`,
      `state age  ${stateAge.toFixed(0)}ms`,
      `snapshots  ${this.snapshots.length}`,
      `launch ack ${this.ackedSeq}/${this.launchSeq}`,
      `corrections ${this.corrections} (last ${this.lastCorrectionPx.toFixed(1)}px)`,
    ].join("\n");
  }

  private state(): ArenaStateView {
    return this.room.state as unknown as ArenaStateView;
  }

  private characterIdOf(ninjaId: string): string {
    return this.state().players.get(ninjaId)?.characterId ?? "default";
  }

  /** Where a ninja is being drawn right now — predicted for the local one, interpolated for everyone else. */
  private renderPos(ninjaId: string): { x: number; y: number } | null {
    if (ninjaId === this.localId) {
      const ninja = this.localNinja();
      return ninja ? { x: ninja.x, y: ninja.y } : null;
    }
    return this.interpolated(ninjaId);
  }

  /** A hit only stops the screen for the players in it — a bot trading KOs across the map shouldn't freeze your dash. */
  private involvesLocal(...ids: string[]): boolean {
    return ids.includes(this.localId);
  }

  /**
   * Turns a tick's sim events into juice. Purely presentational: nothing here feeds back into the sim, so a
   * dropped or duplicated event costs an effect, never desync.
   */
  private handleSimEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "launch": {
          // The local dash already played on release (optimistic, like the launch itself); this is everyone else's.
          if (event.ninjaId === this.localId) break;
          const pos = this.renderPos(event.ninjaId);
          if (pos) this.dashEffect(event.ninjaId, pos.x, pos.y, 0.3);
          break;
        }
        case "ninjaAttacked": {
          // The local swing already played at 0ms on the tap (optimistic, like the dash); this is everyone else's.
          if (event.ninjaId === this.localId) break;
          const pos = this.renderPos(event.ninjaId);
          if (pos) this.weaponEffect(event.ninjaId, event.weaponId, pos.x, pos.y, event.dirX, event.dirY);
          break;
        }
        case "wallHit": {
          const pos = this.renderPos(event.ninjaId);
          if (!pos) break;
          this.effects.burst(pos.x, pos.y, 0xffffff, 6);
          playSfx(this, "wall", this.involvesLocal(event.ninjaId) ? 0.45 : 0.25);
          break;
        }
        case "obstacleHit": {
          const box = this.map.obstacles[event.obstacleId];
          if (!box) break;
          this.effects.burst(box.x, box.y, 0xd8a83c, 8);
          break;
        }
        case "obstacleDestroyed": {
          const box = this.map.obstacles[event.obstacleId];
          if (!box) break;
          this.effects.burst(box.x, box.y, 0xd8a83c, 24);
          this.effects.puff(box.x, box.y, 0x8a6b30, 8);
          this.effects.shake(120, 0.004);
          playSfx(this, "break", 0.5);
          break;
        }
        case "ninjaDamaged": {
          const pos = this.renderPos(event.targetId);
          if (pos) this.effects.burst(pos.x, pos.y, 0xff5252, 10);
          playSfx(this, "hit", 0.5);
          if (this.involvesLocal(event.targetId, event.sourceId)) {
            this.effects.hitPause(HIT_PAUSE_MS);
            this.effects.shake(90, 0.005);
          }
          break;
        }
        case "ninjaHit": {
          const pos = this.renderPos(event.aId);
          if (pos) this.effects.burst(pos.x, pos.y, 0xffffff, 5);
          playSfx(this, "hit", 0.25);
          break;
        }
        case "ninjaKO": {
          const pos = this.renderPos(event.targetId);
          if (pos) {
            // The smoke puff the dash design has called for since S3, finally attached to the KO that earns it.
            this.effects.puff(pos.x, pos.y, 0xdddddd, 18);
            this.effects.burst(pos.x, pos.y, 0xff5252, 22);
          }
          playSfx(this, "ko", 0.7);
          const involved = this.involvesLocal(event.targetId, event.killerId);
          this.effects.hitPause(involved ? KO_HIT_PAUSE_MS : HIT_PAUSE_MS);
          this.effects.shake(220, involved ? 0.012 : 0.006);
          if (event.targetId === this.localId) this.effects.flash(180, 120, 0, 0);
          break;
        }
        case "ougiFired": {
          const pos = this.renderPos(event.ninjaId);
          const skin = skinFor(this.characterIdOf(event.ninjaId));
          if (pos) {
            this.effects.burst(pos.x, pos.y, skin.bodyColor, 40);
            this.effects.puff(pos.x, pos.y, skin.bodyColor, 12);
          }
          playSfx(this, ougiSfxKey(this.characterIdOf(event.ninjaId)), 0.7, false);
          this.effects.shake(300, this.involvesLocal(event.ninjaId) ? 0.014 : 0.008);
          break;
        }
      }
    }
  }

  /** Launch juice: a burst at the take-off point plus a stretch on the sprite that eases back as it travels. */
  private dashEffect(ninjaId: string, x: number, y: number, volume: number): void {
    const skin = skinFor(this.characterIdOf(ninjaId));
    this.effects.burst(x, y, skin.bodyColor, 8);
    playSfx(this, "dash", volume);

    const sprite = this.ninjaSprites.get(ninjaId);
    if (!sprite) return;
    this.tweens.killTweensOf(sprite);
    sprite.setScale(NINJA_SPRITE_SCALE * 1.3, NINJA_SPRITE_SCALE * 0.75);
    this.tweens.add({
      targets: sprite,
      scaleX: NINJA_SPRITE_SCALE,
      scaleY: NINJA_SPRITE_SCALE,
      duration: 220,
      ease: "Back.easeOut",
    });
  }

  /**
   * Swing juice: a burst at each cell the weapon's pattern would hit (cover isn't checked here — it's cosmetic,
   * the server resolves the real damage) plus a squash-tween on the sprite and a per-weapon leveled SFX.
   */
  private weaponEffect(ninjaId: string, weaponId: string, x: number, y: number, dirX: number, dirY: number): void {
    const weapon = weaponFor(weaponId);
    const skin = skinFor(this.characterIdOf(ninjaId));
    const rightX = -dirY;
    const rightY = dirX;
    for (const cell of weapon.cells) {
      const cx = x + (dirX * cell.forward + rightX * cell.lateral) * CELL;
      const cy = y + (dirY * cell.forward + rightY * cell.lateral) * CELL;
      this.effects.burst(cx, cy, skin.bodyColor, 5);
    }
    playSfx(this, "wall", WEAPON_SFX_VOLUME[weaponId] ?? 0.4);

    const sprite = this.ninjaSprites.get(ninjaId);
    if (!sprite) return;
    this.tweens.killTweensOf(sprite);
    sprite.setScale(NINJA_SPRITE_SCALE * 1.15, NINJA_SPRITE_SCALE * 0.9);
    this.tweens.add({
      targets: sprite,
      scaleX: NINJA_SPRITE_SCALE,
      scaleY: NINJA_SPRITE_SCALE,
      duration: 140,
      ease: "Quad.easeOut",
    });
  }

  /** Aimed swing: a tap away from your own ninja swings toward that point, snapped to the nearest cardinal axis. */
  private tryAttack(dirX: number, dirY: number): void {
    const ninja = this.localNinja();
    const mine = this.serverNinja();
    if (!ninja || !ninja.active || !mine || mine.attackCooldown > 0) return;

    const dir = snapToCardinal(dirX, dirY);
    this.room.send("attack", { dirX, dirY });
    this.weaponEffect(this.localId, mine.weaponId, ninja.x, ninja.y, dir.x, dir.y);
  }

  /** Ougis run server-side only — nothing is predicted locally, so the effect lands a round trip later. */
  private fireOugi(): void {
    const mine = this.serverNinja();
    if (!mine || !mine.active || mine.sp < MAX_SP) return;
    this.room.send("ougi");
  }

  private serverNinja(): NinjaView | undefined {
    return this.state().ninjas.find((n) => n.id === this.localId);
  }

  private localNinja() {
    return this.localSim?.ninjas.find((n) => n.id === this.localId);
  }

  /** Captures a snapshot, seeds the local prediction sim, and reconciles the local ninja against the server. */
  private onServerState(): void {
    const state = this.state();
    if (this.lastPhase === "finished" && state.phase === "playing") {
      // Rematch restarted the match under our feet — throw away prediction state built for the last one.
      this.localSim = null;
      this.snapshots = [];
      this.accumulatorMs = 0;
      this.pendingLocalCommand = null;
      this.corrections = 0;
      this.lastCorrectionPx = 0;
      this.launchSeq = 0;
      this.ackedSeq = 0;
      this.effects.reset();
      this.lastTimeRemaining = -1;
      // A rematch rebuilds the bot roster under new ids, so last match's sprites would otherwise pile up unused.
      for (const sprite of this.ninjaSprites.values()) {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
      }
      this.ninjaSprites.clear();
      for (const nameplate of this.nameplates.values()) nameplate.destroy();
      this.nameplates.clear();
    }
    if (this.lastPhase !== state.phase) {
      if (state.phase === "playing") playSfx(this, "match-start", 0.5, false);
      if (state.phase === "finished") playSfx(this, "match-end", 0.5, false);
    }
    this.lastPhase = state.phase;

    const now = performance.now();
    this.lastStateAt = now;
    const ninjas = new Map<string, { x: number; y: number; active: boolean }>();
    for (const n of this.state().ninjas) {
      ninjas.set(n.id, { x: n.x, y: n.y, active: n.active });
    }
    this.snapshots.push({ t: now, ninjas });

    const cutoff = now - SNAPSHOT_BUFFER_MS;
    while (this.snapshots.length > 2 && (this.snapshots[0]?.t ?? now) < cutoff) {
      this.snapshots.shift();
    }

    this.ensureLocalSim();
    this.syncLocalObstacles();
    this.reconcileLocal();
    this.renderHud();
    this.renderMatchEnd();
  }

  /** Timer, alive count, HP/TP/SP gauges, and the weapon cooldown frame — plain DOM, matching the lobby overlay's approach. */
  private renderHud(): void {
    const state = this.state();
    const minutes = Math.floor(state.matchTimeRemaining / 60);
    const seconds = state.matchTimeRemaining % 60;
    this.hudTimerEl.textContent =
      `${minutes}:${String(seconds).padStart(2, "0")}` + (state.suddenDeath ? " (Sudden Death)" : "");

    // Beat out the closing seconds, once per whole second rather than on every state sync.
    const remaining = state.matchTimeRemaining;
    if (remaining !== this.lastTimeRemaining) {
      if (state.phase === "playing" && remaining > 0 && remaining <= COUNTDOWN_FROM_SECONDS) {
        playSfx(this, "countdown", 0.5, false);
      }
      this.lastTimeRemaining = remaining;
    }
    this.hudTimerEl.classList.toggle(
      "urgent",
      state.phase === "playing" && remaining > 0 && remaining <= COUNTDOWN_FROM_SECONDS,
    );

    const aliveCount = state.ninjas.filter((n) => n.active).length;
    this.hudAliveEl.textContent = `${aliveCount}/${state.ninjas.length} alive`;

    const mine = this.serverNinja();
    this.hudHpFillEl.style.width = `${clamp(((mine?.hp ?? 0) / MAX_HP) * 100, 0, 100)}%`;
    this.hudTpFillEl.style.width = `${clamp(((mine?.tp ?? 0) / MAX_TP) * 100, 0, 100)}%`;
    this.hudSpFillEl.style.width = `${clamp(((mine?.sp ?? 0) / MAX_SP) * 100, 0, 100)}%`;

    const weaponId = mine?.weaponId ?? "";
    if (weaponId && weaponId !== this.lastDrawnWeaponId) {
      drawWeaponIcon(this.hudWeaponIconEl, weaponId);
      this.lastDrawnWeaponId = weaponId;
    }
    const weaponCooldown = weaponFor(weaponId).cooldownTicks;
    const weaponReadyFrac = weaponCooldown > 0 ? 1 - (mine?.attackCooldown ?? 0) / weaponCooldown : 1;
    this.hudWeaponFillEl.style.height = `${clamp((1 - weaponReadyFrac) * 100, 0, 100)}%`;
    this.hudWeaponFrameEl.classList.toggle("ready", weaponReadyFrac >= 1);

    const characterId = state.players.get(this.localId)?.characterId ?? "";
    const ougi = ougiForCharacter(characterId);
    const ready = (mine?.sp ?? 0) >= MAX_SP;
    this.hudOugiBtn.textContent = ready ? `${ougi.name} — Space` : ougi.name;
    this.hudOugiBtn.disabled = !ready || !mine?.active;
    this.hudOugiBtn.title = ougi.description;
  }

  /** Shows the final scoreboard once the match ends; host gets a rematch button, everyone else waits on them. */
  private renderMatchEnd(): void {
    const state = this.state();
    const finished = state.phase === "finished";
    this.matchEndEl.hidden = !finished;
    if (!finished) return;

    const isHost = state.players.get(this.localId)?.isHost ?? false;
    this.matchEndTitleEl.textContent = state.winnerId
      ? `${state.players.get(state.winnerId)?.nickname ?? "Someone"} wins!`
      : "Draw!";

    this.matchEndResultsEl.innerHTML = "";
    const rows = state.ninjas
      .map((n) => ({ id: n.id, player: state.players.get(n.id) }))
      .filter((row): row is { id: string; player: PlayerView } => row.player !== undefined)
      .sort((a, b) => b.player.score - a.player.score);
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${row.player.nickname}${row.player.isBot ? " (bot)" : ""}: ${row.player.score}`;
      if (row.id === state.winnerId) li.classList.add("winner");
      this.matchEndResultsEl.appendChild(li);
    }

    this.matchEndRematchBtn.hidden = !isHost;
    this.matchEndNoteEl.hidden = isHost;
  }

  private ensureLocalSim(): void {
    if (this.localSim) return;
    const mine = this.serverNinja();
    if (!mine) return;

    const characterId = this.state().players.get(this.localId)?.characterId;
    this.localSim = createSimState([this.localId], this.map, characterId ? [characterId] : []);
    const ninja = this.localNinja();
    if (ninja) {
      ninja.x = mine.x;
      ninja.y = mine.y;
      ninja.active = mine.active;
    }
  }

  /** Keeps the prediction sim's destructible grid in step with the authoritative one. */
  private syncLocalObstacles(): void {
    if (!this.localSim) return;
    const serverObstacles = this.state().obstacles;
    for (let i = 0; i < this.localSim.obstacles.length; i++) {
      const local = this.localSim.obstacles[i];
      const server = serverObstacles[i];
      if (!local || !server) continue;
      local.hp = server.hp;
      local.alive = server.alive;
    }
  }

  /** Snaps the predicted ninja to the server only while it's at rest, so a correction never interrupts a live dash. */
  private reconcileLocal(): void {
    const ninja = this.localNinja();
    const mine = this.serverNinja();
    if (!ninja) return;

    if (!mine) {
      ninja.active = false;
      return;
    }

    ninja.active = mine.active;
    // Ougi buffs are server-owned, so take them straight from the wire rather than predicting them.
    ninja.ougiTicks = mine.ougiTicks;
    ninja.dashRangeMultiplier = mine.dashRangeMultiplier;

    // Snapping is only safe once *both* worlds have finished the dash. Before the ack the server position
    // predates our launch; while it reports `dashing` the server is mid-dash and we'd be dragged backwards.
    // Either way the fix is to wait, not to predict harder — the two sims agree on where a dash ends.
    const awaitingAck =
      this.ackedSeq < this.launchSeq && performance.now() - this.launchSentAt < LAUNCH_ACK_TIMEOUT_MS;
    const atRest = ninja.dashBudget <= 0 && ninja.vx === 0 && ninja.vy === 0;
    if (atRest && !this.pendingLocalCommand && !awaitingAck && !mine.dashing) {
      const drift = lengthOf(mine.x - ninja.x, mine.y - ninja.y);
      if (drift > CORRECTION_THRESHOLD_PX) {
        this.corrections++;
        this.lastCorrectionPx = drift;
      }
      ninja.x = mine.x;
      ninja.y = mine.y;
      // TP is predicted while dashing, but an Ougi can refill it server-side, so resync it at rest.
      ninja.tp = mine.tp;
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const ninja = this.localNinja();
    if (!ninja || !ninja.active) return;

    const dist = lengthOf(pointer.worldX - ninja.x, pointer.worldY - ninja.y);
    if (dist > GRAB_RADIUS) {
      // Press landed away from your own ninja — the release below aims a swing instead of grabbing for a dash.
      this.awayTapArmed = true;
      return;
    }
    this.awayTapArmed = false;

    this.dragging = true;
    this.pointerX = pointer.worldX;
    this.pointerY = pointer.worldY;

    // Press-and-hold charges TP; it keeps charging through the drag below, right up to release.
    ninja.charging = true;
    this.room.send("charge", { active: true });
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.pointerX = pointer.worldX;
    this.pointerY = pointer.worldY;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.awayTapArmed) {
      this.awayTapArmed = false;
      const ninja = this.localNinja();
      if (ninja) this.tryAttack(pointer.worldX - ninja.x, pointer.worldY - ninja.y);
      return;
    }

    if (!this.dragging) return;
    this.dragging = false;
    this.aimGfx.clear();

    const ninja = this.localNinja();
    this.room.send("charge", { active: false });
    if (!ninja) return;
    ninja.charging = false;

    const dragX = this.pointerX - ninja.x;
    const dragY = this.pointerY - ninja.y;
    const dragDist = lengthOf(dragX, dragY);

    // A release with barely any drag on your own ninja is neither an aim nor a dash — nothing happens.
    if (dragDist < TAP_DRAG_THRESHOLD) return;

    // Drag-toward: release launches toward the pointer, 1:1 with drag distance (capped at full range), snapped to an axis.
    const power = clamp(dragDist / maxDashDistanceOf(ninja), 0, 1);
    const dir = snapToCardinal(dragX, dragY);
    const command: LaunchCommand = {
      type: "launch",
      ninjaId: this.localId,
      dirX: dir.x,
      dirY: dir.y,
      power,
    };

    // Optimistic: start the dash locally now; the server applies the same command authoritatively.
    this.pendingLocalCommand = command;
    this.launchSeq++;
    this.launchSentAt = performance.now();
    this.room.send("launch", { dirX: dir.x, dirY: dir.y, power, seq: this.launchSeq });

    // Own dash plays at 0ms rather than waiting for the server's event, matching the optimistic launch itself.
    // Gated on the real landing distance, since both sims refuse a dash that can't reach the next cell.
    if (dashDistanceFor(ninja, dir, power, this.map.grid) > 0) {
      this.dashEffect(this.localId, ninja.x, ninja.y, 0.5);
    }
  }

  private drawAimLine(): void {
    const ninja = this.localNinja();
    if (!ninja) return;

    const dragX = this.pointerX - ninja.x;
    const dragY = this.pointerY - ninja.y;
    const dragDist = lengthOf(dragX, dragY);
    const power = clamp(dragDist / maxDashDistanceOf(ninja), 0, 1);

    this.aimGfx.clear();
    // Raw drag, drawn toward the pointer — this is the direction and (uncapped) distance being requested.
    this.aimGfx.lineStyle(3, 0xffffff, 0.6);
    this.aimGfx.lineBetween(ninja.x, ninja.y, this.pointerX, this.pointerY);

    // Launch preview: the sim's own landing distance, so the arrow ends on the cell the dash will actually
    // reach. Capped by current TP too — as the hold charges TP, the preview grows a cell at a time to match.
    // Also capped by cover, since a dash hard-stops on contact: without this the highlight could sit on a tile
    // behind a pillar, or outside the arena entirely.
    const dir = snapToCardinal(dragX, dragY);
    const previewLen = Math.min(
      dashDistanceFor(ninja, dir, power, this.map.grid),
      this.clearLaneDistance(ninja.x, ninja.y, dir),
    );
    const launchX = ninja.x + dir.x * previewLen;
    const launchY = ninja.y + dir.y * previewLen;
    this.aimGfx.lineStyle(4, 0xffd166, 0.9);
    this.aimGfx.lineBetween(ninja.x, ninja.y, launchX, launchY);

    // The tile you'll land on, since a dash resolves to a cell centre. Nothing is highlighted when the drag is
    // too short to reach the next cell, which is the honest read: that release is a no-op.
    if (previewLen <= 0) return;
    // Only the launch axis is snapped by the sim, so the other one comes from whichever cell the landing is in.
    const tileX = snapToCellCentre(launchX, this.map.grid.originX);
    const tileY = snapToCellCentre(launchY, this.map.grid.originY);
    this.aimGfx.fillStyle(0xffd166, 0.18);
    this.aimGfx.fillRect(tileX - CELL / 2, tileY - CELL / 2, CELL, CELL);
    this.aimGfx.lineStyle(2, 0xffd166, 0.85);
    this.aimGfx.strokeRect(tileX - CELL / 2, tileY - CELL / 2, CELL, CELL);
  }

  /**
   * How far the ninja can travel along `dir` before its body touches the nearest wall or live obstacle — the
   * same reach the bots measure, minus the body radius the sim stops it at. Presentation only: the sim decides
   * where a dash really ends, this just stops the preview promising a tile it can't deliver.
   */
  private clearLaneDistance(x: number, y: number, dir: { x: number; y: number }): number {
    let limit = Infinity;

    const consider = (box: Parameters<typeof laneDistance>[3]): void => {
      const gap = laneDistance(x, y, dir, box, NINJA_RADIUS);
      if (gap !== null) limit = Math.min(limit, gap - NINJA_RADIUS);
    };

    for (const wall of this.map.walls) consider(wall);
    const live = this.state().obstacles;
    for (let i = 0; i < this.map.obstacles.length; i++) {
      const box = this.map.obstacles[i];
      if (box && live[i]?.alive) consider(box);
    }

    return Math.max(limit, 0);
  }

  /** Interpolates a remote ninja ~100ms in the past between the two straddling snapshots. */
  private interpolated(id: string): { x: number; y: number; active: boolean } | null {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    const snaps = this.snapshots;
    if (snaps.length === 0) return null;

    let s0: Snapshot | null = null;
    let s1: Snapshot | null = null;
    for (const snap of snaps) {
      if (snap.t <= renderTime) s0 = snap;
      else {
        s1 = snap;
        break;
      }
    }

    if (!s0) return snaps[0]?.ninjas.get(id) ?? null;
    const a = s0.ninjas.get(id);
    if (!a) return null;
    if (!s1) return a;
    const b = s1.ninjas.get(id);
    if (!b) return a;

    const span = s1.t - s0.t;
    const f = span > 0 ? clamp((renderTime - s0.t) / span, 0, 1) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, active: b.active };
  }

  private drawWorld(): void {
    const g = this.worldGfx;
    const map = this.map;
    const state = this.state();
    g.clear();

    // The floor is a tile sprite placed once in `createFloor`; pillars are images from `createPillars`.
    for (const wall of map.border) {
      g.fillStyle(COLOR_BORDER, 1);
      g.fillRect(wall.x - wall.halfW, wall.y - wall.halfH, wall.halfW * 2, wall.halfH * 2);
      this.drawBorderFace(g, wall);
    }

    // Pillars are static, but their shadows fall on the floor beneath every sprite, so they belong here.
    for (const pillar of map.pillars) this.dropShadow(g, pillar);

    for (let i = 0; i < map.obstacles.length; i++) {
      const box = map.obstacles[i];
      const obstacle = state.obstacles[i];
      if (!box || !obstacle || !obstacle.alive) continue;
      // Faded against the box's own starting HP, so hay and crates both read as fresh-to-broken.
      const healthFrac = clamp(obstacle.hp / box.hp, 0, 1);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(COLOR_OBSTACLE_BROKEN),
        Phaser.Display.Color.IntegerToColor(COLOR_OBSTACLE_FRESH),
        1,
        healthFrac,
      );
      this.dropShadow(g, box);
      g.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      g.fillRect(box.x - box.halfW, box.y - box.halfH, box.halfW * 2, box.halfH * 2);
      // A lit top strip plus the same heavy keyline the pillars carry, so cover reads as a solid object.
      g.fillStyle(0xffffff, 0.14);
      g.fillRect(box.x - box.halfW, box.y - box.halfH, box.halfW * 2, box.halfH * 0.4);
      g.lineStyle(3, COLOR_OBSTACLE_EDGE, 1);
      g.strokeRect(box.x - box.halfW, box.y - box.halfH, box.halfW * 2, box.halfH * 2);
    }

    const overlay = this.overlayGfx;
    overlay.clear();
    const seen = new Set<string>();

    for (const serverNinja of state.ninjas) {
      const isLocal = serverNinja.id === this.localId;
      const pos = isLocal ? this.localNinja() : this.interpolated(serverNinja.id);
      const sprite = this.spriteFor(serverNinja.id);
      seen.add(serverNinja.id);

      if (!pos || !pos.active) {
        sprite.setVisible(false);
        this.nameplates.get(serverNinja.id)?.setVisible(false);
        continue;
      }

      // Invulnerable (just-respawned) ninjas flicker so a hit-them-now-or-wait decision reads at a glance.
      const invulnerable = serverNinja.invulnerableTicks > 0;
      const alpha = invulnerable ? 0.5 + 0.5 * Math.sin(performance.now() / 80) : 1;

      // Grounds the sprite: without it a ninja sliding past a tall pillar reads as floating over the floor.
      g.fillStyle(COLOR_SHADOW, SHADOW_ALPHA);
      g.fillEllipse(
        pos.x + SHADOW_OFFSET_X * 0.5,
        pos.y + NINJA_RADIUS * 0.7,
        NINJA_RADIUS * 1.9,
        NINJA_RADIUS * 0.8,
      );

      sprite.setVisible(true);
      sprite.setPosition(pos.x, pos.y);
      // Re-sorted every frame against the pillars: a ninja's feet decide whether cover is in front of it.
      sprite.setDepth(ySortDepth(pos.y + NINJA_RADIUS));
      sprite.setAlpha(alpha);
      sprite.setTint(skinFor(this.characterIdOf(serverNinja.id)).bodyColor);

      // A running duration Ougi gets a pulsing aura so opponents can see the buff is live.
      if (serverNinja.ougiTicks > 0) {
        overlay.lineStyle(3, 0xffd166, 0.8);
        overlay.strokeCircle(pos.x, pos.y, NINJA_RADIUS + 6 + 3 * Math.sin(performance.now() / 100));
      }

      const hpFrac = clamp(serverNinja.hp / MAX_HP, 0, 1);
      const barW = NINJA_RADIUS * 2;
      const barX = pos.x - NINJA_RADIUS;
      const barY = pos.y - NINJA_RADIUS - 10;
      overlay.fillStyle(0x000000, 0.5);
      overlay.fillRect(barX, barY, barW, 4);
      overlay.fillStyle(hpFrac > 0.5 ? 0x4caf50 : hpFrac > 0.25 ? 0xffb300 : 0xe53935, 1);
      overlay.fillRect(barX, barY, barW * hpFrac, 4);

      const player = state.players.get(serverNinja.id);
      const nameplate = this.nameplateFor(serverNinja.id);
      nameplate.setText(`${player?.nickname ?? "???"}${player?.isBot ? " (bot)" : ""}`);
      nameplate.setColor(isLocal ? "#ffd166" : "#e8e8e8");
      nameplate.setVisible(true);
      nameplate.setPosition(pos.x, barY - 4);
    }

    // A rematch can drop a player entirely; their sprite would otherwise linger where they were last drawn.
    for (const [id, sprite] of this.ninjaSprites) {
      if (!seen.has(id)) {
        sprite.setVisible(false);
        this.nameplates.get(id)?.setVisible(false);
      }
    }
  }

  private spriteFor(ninjaId: string): Phaser.GameObjects.Sprite {
    const existing = this.ninjaSprites.get(ninjaId);
    if (existing) return existing;

    // Depth is set per frame from the ninja's y in `drawWorld`; this is only its starting place in the band.
    const sprite = this.add
      .sprite(0, 0, NINJA_TEXTURE_KEY)
      .setScale(NINJA_SPRITE_SCALE)
      .setDepth(ySortDepth(0));
    this.ninjaSprites.set(ninjaId, sprite);
    return sprite;
  }

  private nameplateFor(ninjaId: string): Phaser.GameObjects.Text {
    const existing = this.nameplates.get(ninjaId);
    if (existing) return existing;

    const text = this.add
      .text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#e8e8e8" })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_OVERLAY);
    this.nameplates.set(ninjaId, text);
    return text;
  }
}
