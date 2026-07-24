import Phaser from "phaser";
import { DOJO_ARENA } from "@ougi-arena/shared";
import { GameScene } from "./scenes/GameScene.js";
import { initLobby } from "./lobby.js";

// The match renders the room's authoritative state; the scene is created once the host starts.
initLobby((room) => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: DOJO_ARENA.width,
    height: DOJO_ARENA.height,
    backgroundColor: "#1a1a2e",
    // The ninja sprite is 16x16 art drawn at 2.5x; smoothing would turn it to mush.
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new GameScene(room)],
  });
});
