import Phaser from "phaser";
import { arenaById } from "@ougi-arena/shared";
import { GameScene } from "./scenes/GameScene.js";
import { initLobby } from "./lobby.js";

// The match renders the room's authoritative state; the scene is created once the host starts.
initLobby((room) => {
  // The host's map choice is locked in by the time a match starts, so the canvas is sized from it exactly once.
  const map = arenaById((room.state as { mapId: string }).mapId);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: map.width,
    height: map.height,
    backgroundColor: "#1a1a2e",
    // The ninja sprite is 16x16 art drawn at 2.5x; smoothing would turn it to mush.
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new GameScene(room, map)],
  });
});
