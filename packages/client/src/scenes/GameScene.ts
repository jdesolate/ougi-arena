import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  DOJO_ARENA,
  MAX_DASH_DISTANCE,
  NINJA_RADIUS,
  OBSTACLE_HP,
  SIM_DT,
  clamp,
  createSimState,
  lengthOf,
  step,
  type LaunchCommand,
  type SimState,
} from "@ougi-arena/shared";
import { skinFor } from "../skins.js";

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

/** Loosely-typed view of the server schema — the client bundle doesn't share the schema classes. */
interface NinjaView {
  id: string;
  x: number;
  y: number;
  active: boolean;
}
interface ObstacleView {
  hp: number;
  alive: boolean;
}
interface ArenaStateView {
  phase: string;
  players: { get(id: string): { characterId: string } | undefined };
  ninjas: NinjaView[];
  obstacles: ObstacleView[];
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

  private snapshots: Snapshot[] = [];

  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;

  private worldGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;

  constructor(room: Room) {
    super("game");
    this.room = room;
    this.localId = room.sessionId;
  }

  create(): void {
    this.worldGfx = this.add.graphics();
    this.aimGfx = this.add.graphics();

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);

    this.room.onStateChange(() => this.onServerState());

    this.onServerState();
    this.drawWorld();
  }

  update(_time: number, deltaMs: number): void {
    if (this.localSim) {
      this.accumulatorMs += deltaMs;
      let steps = 0;
      while (this.accumulatorMs >= SIM_DT_MS && steps < MAX_STEPS_PER_FRAME) {
        const commands = this.pendingLocalCommand ? [this.pendingLocalCommand] : [];
        this.pendingLocalCommand = null;
        step(this.localSim, commands);
        this.accumulatorMs -= SIM_DT_MS;
        steps++;
      }
    }

    this.drawWorld();
    if (this.dragging) this.drawAimLine();
  }

  private state(): ArenaStateView {
    return this.room.state as unknown as ArenaStateView;
  }

  private serverNinja(): NinjaView | undefined {
    return this.state().ninjas.find((n) => n.id === this.localId);
  }

  private localNinja() {
    return this.localSim?.ninjas.find((n) => n.id === this.localId);
  }

  /** Captures a snapshot, seeds the local prediction sim, and reconciles the local ninja against the server. */
  private onServerState(): void {
    const now = performance.now();
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
  }

  private ensureLocalSim(): void {
    if (this.localSim) return;
    const mine = this.serverNinja();
    if (!mine) return;

    this.localSim = createSimState([this.localId], DOJO_ARENA);
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
    const atRest = ninja.dashBudget <= 0 && ninja.vx === 0 && ninja.vy === 0;
    if (atRest && !this.pendingLocalCommand) {
      ninja.x = mine.x;
      ninja.y = mine.y;
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
    if (!ninja) return;

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
    this.room.send("launch", { dirX: dir.x, dirY: dir.y, power });
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
    const previewLen = power * MAX_DASH_DISTANCE;
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

    for (const serverNinja of state.ninjas) {
      const isLocal = serverNinja.id === this.localId;
      const pos = isLocal ? this.localNinja() : this.interpolated(serverNinja.id);
      if (!pos || !pos.active) continue;

      const characterId = state.players.get(serverNinja.id)?.characterId ?? "default";
      const skin = skinFor(characterId);
      g.fillStyle(skin.bodyColor, 1);
      g.fillCircle(pos.x, pos.y, NINJA_RADIUS);
      g.lineStyle(2, skin.outlineColor, 1);
      g.strokeCircle(pos.x, pos.y, NINJA_RADIUS);
    }
  }
}
