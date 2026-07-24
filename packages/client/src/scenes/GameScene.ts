import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  DOJO_ARENA,
  MAX_HP,
  MAX_SP,
  MAX_TP,
  NINJA_RADIUS,
  OBSTACLE_HP,
  SIM_DT,
  clamp,
  createSimState,
  lengthOf,
  maxDashDistanceOf,
  ougiForCharacter,
  step,
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
import {
  DEPTH_AIM,
  DEPTH_NINJA,
  DEPTH_OVERLAY,
  DEPTH_WORLD,
  MatchEffects,
} from "./effects.js";

const SIM_DT_MS = SIM_DT * 1000;
/** Caps how many fixed steps run in one frame, so a tab-switch stall can't spiral into a freeze. */
const MAX_STEPS_PER_FRAME = 5;

/** Drag distance, in world units, that maps to full launch power. Input feel, not sim physics. */
const MAX_DRAG_DISTANCE = 160;
/** Generous grab radius so the drag doesn't need pixel-perfect precision on the ninja. */
const GRAB_RADIUS = NINJA_RADIUS * 2.5;

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

/** Nindou-style movement: dashes only go up/down/left/right, never diagonal. */
function snapToCardinal(x: number, y: number): { x: number; y: number } {
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  return Math.abs(x) >= Math.abs(y) ? { x: Math.sign(x), y: 0 } : { x: 0, y: Math.sign(y) };
}

/**
 * Renders the authoritative match: remote ninjas via ~100ms snapshot interpolation, the local ninja via a
 * small prediction sim so its dash starts at 0ms (optimistic launch) and reconciles to the server when at rest.
 */
export class GameScene extends Phaser.Scene {
  private readonly room: Room;
  private readonly localId: string;

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

  private worldGfx!: Phaser.GameObjects.Graphics;
  /** Drawn above the ninja sprites: HP bars and the Ougi aura. */
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;

  private readonly effects = new MatchEffects(this);
  /** One sprite per ninja, created on first sight and reused; `drawWorld` only repositions them. */
  private readonly ninjaSprites = new Map<string, Phaser.GameObjects.Sprite>();
  /** Drives the countdown beep off whole-second changes rather than every state sync. */
  private lastTimeRemaining = -1;

  private readonly hudEl = el<HTMLDivElement>("hud");
  private readonly hudTimerEl = el<HTMLSpanElement>("hud-timer");
  private readonly hudTpFillEl = el<HTMLDivElement>("hud-tp-fill");
  private readonly hudSpFillEl = el<HTMLDivElement>("hud-sp-fill");
  private readonly hudOugiBtn = el<HTMLButtonElement>("hud-ougi-btn");
  private readonly hudScoreboardEl = el<HTMLUListElement>("hud-scoreboard");
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

  constructor(room: Room) {
    super("game");
    this.room = room;
    this.localId = room.sessionId;
  }

  preload(): void {
    this.load.image(NINJA_TEXTURE_KEY, NINJA_TEXTURE_PATH);
    preloadSfx(this.load);
  }

  create(): void {
    this.worldGfx = this.add.graphics().setDepth(DEPTH_WORLD);
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
        case "wallHit": {
          const pos = this.renderPos(event.ninjaId);
          if (!pos) break;
          this.effects.burst(pos.x, pos.y, 0xffffff, 6);
          playSfx(this, "wall", this.involvesLocal(event.ninjaId) ? 0.45 : 0.25);
          break;
        }
        case "obstacleHit": {
          const box = DOJO_ARENA.obstacles[event.obstacleId];
          if (!box) break;
          this.effects.burst(box.x, box.y, 0xd8a83c, 8);
          break;
        }
        case "obstacleDestroyed": {
          const box = DOJO_ARENA.obstacles[event.obstacleId];
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

  /** Timer, TP/SP meters, and the live scoreboard — plain DOM, matching the lobby overlay's approach. */
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

    const mine = this.serverNinja();
    this.hudTpFillEl.style.width = `${clamp(((mine?.tp ?? 0) / MAX_TP) * 100, 0, 100)}%`;
    this.hudSpFillEl.style.width = `${clamp(((mine?.sp ?? 0) / MAX_SP) * 100, 0, 100)}%`;

    const characterId = state.players.get(this.localId)?.characterId ?? "";
    const ougi = ougiForCharacter(characterId);
    const ready = (mine?.sp ?? 0) >= MAX_SP;
    this.hudOugiBtn.textContent = ready ? `${ougi.name} — Space` : ougi.name;
    this.hudOugiBtn.disabled = !ready || !mine?.active;
    this.hudOugiBtn.title = ougi.description;

    this.hudScoreboardEl.innerHTML = "";
    const rows = state.ninjas
      .map((n) => ({ id: n.id, player: state.players.get(n.id) }))
      .filter((row): row is { id: string; player: PlayerView } => row.player !== undefined)
      .sort((a, b) => b.player.score - a.player.score);
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${row.player.nickname}${row.player.isBot ? " (bot)" : ""}: ${row.player.score}`;
      this.hudScoreboardEl.appendChild(li);
    }
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
    this.localSim = createSimState([this.localId], DOJO_ARENA, characterId ? [characterId] : []);
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
    if (dist > GRAB_RADIUS) return;

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

  private onPointerUp(): void {
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
    if (dragDist === 0) return;

    // Slingshot: pull back, release launches the opposite way, snapped to an axis.
    const power = clamp(dragDist / MAX_DRAG_DISTANCE, 0, 1);
    const dir = snapToCardinal(-dragX, -dragY);
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
    // Gated on TP because a dash with an empty tank is refused by both sims and should stay silent.
    if (ninja.tp > 0) this.dashEffect(this.localId, ninja.x, ninja.y, 0.5);
  }

  private drawAimLine(): void {
    const ninja = this.localNinja();
    if (!ninja) return;

    const dragX = this.pointerX - ninja.x;
    const dragY = this.pointerY - ninja.y;
    const dragDist = lengthOf(dragX, dragY);
    const power = clamp(dragDist / MAX_DRAG_DISTANCE, 0, 1);

    this.aimGfx.clear();
    // Pull-back handle, drawn toward the pointer.
    this.aimGfx.lineStyle(3, 0xffffff, 0.6);
    this.aimGfx.lineBetween(ninja.x, ninja.y, this.pointerX, this.pointerY);

    // Launch preview: exactly where the dash will land, so the arrow shows the real destination, not just a direction.
    // Capped by current TP too — as the hold charges TP, the preview grows in real time to match.
    const previewLen = Math.min(power * maxDashDistanceOf(ninja), ninja.tp);
    const dir = snapToCardinal(-dragX, -dragY);
    const launchX = ninja.x + dir.x * previewLen;
    const launchY = ninja.y + dir.y * previewLen;
    this.aimGfx.lineStyle(4, 0xffd166, 0.9);
    this.aimGfx.lineBetween(ninja.x, ninja.y, launchX, launchY);
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
    const map = DOJO_ARENA;
    const state = this.state();
    g.clear();

    g.fillStyle(0x0f3460, 1);
    g.fillRect(0, 0, map.width, map.height);

    g.fillStyle(0x16213e, 1);
    for (const wall of map.walls) {
      g.fillRect(wall.x - wall.halfW, wall.y - wall.halfH, wall.halfW * 2, wall.halfH * 2);
    }

    for (let i = 0; i < map.obstacles.length; i++) {
      const box = map.obstacles[i];
      const obstacle = state.obstacles[i];
      if (!box || !obstacle || !obstacle.alive) continue;
      const healthFrac = clamp(obstacle.hp / OBSTACLE_HP, 0, 1);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        new Phaser.Display.Color(120, 40, 40),
        new Phaser.Display.Color(200, 170, 60),
        1,
        healthFrac,
      );
      g.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      g.fillRect(box.x - box.halfW, box.y - box.halfH, box.halfW * 2, box.halfH * 2);
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
        continue;
      }

      // Invulnerable (just-respawned) ninjas flicker so a hit-them-now-or-wait decision reads at a glance.
      const invulnerable = serverNinja.invulnerableTicks > 0;
      const alpha = invulnerable ? 0.5 + 0.5 * Math.sin(performance.now() / 80) : 1;

      sprite.setVisible(true);
      sprite.setPosition(pos.x, pos.y);
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
    }

    // A rematch can drop a player entirely; their sprite would otherwise linger where they were last drawn.
    for (const [id, sprite] of this.ninjaSprites) {
      if (!seen.has(id)) sprite.setVisible(false);
    }
  }

  private spriteFor(ninjaId: string): Phaser.GameObjects.Sprite {
    const existing = this.ninjaSprites.get(ninjaId);
    if (existing) return existing;

    const sprite = this.add
      .sprite(0, 0, NINJA_TEXTURE_KEY)
      .setScale(NINJA_SPRITE_SCALE)
      .setDepth(DEPTH_NINJA);
    this.ninjaSprites.set(ninjaId, sprite);
    return sprite;
  }
}
