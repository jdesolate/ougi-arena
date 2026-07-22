import Phaser from "phaser";
import { DOJO_ARENA } from "@ougi-arena/shared";
import { GameScene } from "./scenes/GameScene.js";
import { initLobby } from "./lobby.js";

// GameScene still runs its own local sim; wiring the room's authoritative state in is S5.
initLobby(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: DOJO_ARENA.width,
    height: DOJO_ARENA.height,
    backgroundColor: "#1a1a2e",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [GameScene],
  });
});
