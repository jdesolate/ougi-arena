import Phaser from "phaser";
import {
  DOJO_ARENA,
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

const PLAYER_ID = "player";

export class GameScene extends Phaser.Scene {
  private sim!: SimState;
  private accumulatorMs = 0;
  private pendingCommand: LaunchCommand | null = null;

  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;

  private worldGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super("game");
  }

  create(): void {
    this.sim = createSimState([PLAYER_ID], DOJO_ARENA);

    this.worldGfx = this.add.graphics();
    this.aimGfx = this.add.graphics();

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);

    this.drawWorld();
  }

  update(_time: number, deltaMs: number): void {
    this.accumulatorMs += deltaMs;
    let steps = 0;

    while (this.accumulatorMs >= SIM_DT_MS && steps < MAX_STEPS_PER_FRAME) {
      const commands = this.pendingCommand ? [this.pendingCommand] : [];
      this.pendingCommand = null;
      step(this.sim, commands);
      this.accumulatorMs -= SIM_DT_MS;
      steps++;
    }

    this.drawWorld();
    if (this.dragging) this.drawAimLine();
  }

  private player(): { x: number; y: number } {
    const ninja = this.sim.ninjas.find((n) => n.id === PLAYER_ID);
    return ninja ?? { x: this.sim.map.width / 2, y: this.sim.map.height / 2 };
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const player = this.player();
    const dist = lengthOf(pointer.worldX - player.x, pointer.worldY - player.y);
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

    const player = this.player();
    const dragX = this.pointerX - player.x;
    const dragY = this.pointerY - player.y;
    const dragDist = lengthOf(dragX, dragY);
    if (dragDist === 0) return;

    // Slingshot: pull back, release launches the opposite way.
    const power = clamp(dragDist / MAX_DRAG_DISTANCE, 0, 1);
    this.pendingCommand = {
      type: "launch",
      ninjaId: PLAYER_ID,
      dirX: -dragX,
      dirY: -dragY,
      power,
    };
  }

  private drawAimLine(): void {
    const player = this.player();
    const dragX = this.pointerX - player.x;
    const dragY = this.pointerY - player.y;
    const dragDist = lengthOf(dragX, dragY);
    const power = clamp(dragDist / MAX_DRAG_DISTANCE, 0, 1);

    this.aimGfx.clear();
    // Pull-back handle, drawn toward the pointer.
    this.aimGfx.lineStyle(3, 0xffffff, 0.6);
    this.aimGfx.lineBetween(player.x, player.y, this.pointerX, this.pointerY);

    // Launch preview, drawn the opposite way and scaled with power.
    const previewLen = 40 + power * 120;
    const dist = dragDist || 1;
    const launchX = player.x + (-dragX / dist) * previewLen;
    const launchY = player.y + (-dragY / dist) * previewLen;
    this.aimGfx.lineStyle(4, 0xffd166, 0.9);
    this.aimGfx.lineBetween(player.x, player.y, launchX, launchY);
  }

  private drawWorld(): void {
    const g = this.worldGfx;
    g.clear();

    g.fillStyle(0x0f3460, 1);
    g.fillRect(0, 0, this.sim.map.width, this.sim.map.height);

    g.fillStyle(0x16213e, 1);
    for (const wall of this.sim.map.walls) {
      g.fillRect(wall.x - wall.halfW, wall.y - wall.halfH, wall.halfW * 2, wall.halfH * 2);
    }

    for (const obstacle of this.sim.obstacles) {
      if (!obstacle.alive) continue;
      const healthFrac = clamp(obstacle.hp / OBSTACLE_HP, 0, 1);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        new Phaser.Display.Color(120, 40, 40),
        new Phaser.Display.Color(200, 170, 60),
        1,
        healthFrac,
      );
      g.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      g.fillRect(
        obstacle.x - obstacle.halfW,
        obstacle.y - obstacle.halfH,
        obstacle.halfW * 2,
        obstacle.halfH * 2,
      );
    }

    for (const ninja of this.sim.ninjas) {
      if (!ninja.active) continue;
      const skin = skinFor("default");
      g.fillStyle(skin.bodyColor, 1);
      g.fillCircle(ninja.x, ninja.y, ninja.radius);
      g.lineStyle(2, skin.outlineColor, 1);
      g.strokeCircle(ninja.x, ninja.y, ninja.radius);
    }
  }
}
