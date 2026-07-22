import Phaser from "phaser";

class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Ougi Arena", {
        fontFamily: "sans-serif",
        fontSize: "32px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 960,
  height: 540,
  backgroundColor: "#1a1a2e",
  scene: [BootScene],
});
