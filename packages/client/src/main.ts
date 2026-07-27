import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { arenaById } from "@ougi-arena/shared";
import { GameScene } from "./scenes/GameScene.js";
import { initLobby } from "./lobby.js";

/** The one live match, if any. The room and the game are created together and torn down together. */
let game: Phaser.Game | null = null;
let activeRoom: Room | null = null;

// The match renders the room's authoritative state; the scene is created once the host starts.
const lobby = initLobby((room) => {
  activeRoom = room;
  // The host's map choice is locked in by the time a match starts, so the canvas is sized from it exactly once.
  const map = arenaById((room.state as { mapId: string }).mapId);

  game = new Phaser.Game({
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
    scene: [new GameScene(room, map, quitToHome)],
  });
});

/**
 * The app's only teardown path: everything a match built has to go, because the player can start a fresh one
 * straight afterwards. Order matters — the room's listeners are dropped first so a state patch arriving
 * mid-teardown can't reach a scene that is already on its way out.
 */
function quitToHome(): void {
  const room = activeRoom;
  activeRoom = null;

  if (room) {
    room.removeAllListeners();
    // Consented, so the server removes the seat now rather than holding it open for the reconnection grace
    // window — a quit is a decision, not a dropped connection.
    void room.leave(true);
  }

  // `true` removes the canvas too, leaving `#app` empty for the next match to mount into.
  game?.destroy(true);
  game = null;

  lobby.reset();
}
