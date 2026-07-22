import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";

/** Active combatants are capped at 4; the room stays open past that so late joiners can still spectate. */
const MAX_ACTIVE_PLAYERS = 4;
const MAX_CLIENTS = 8;
const NICKNAME_MAX_LENGTH = 16;
const RECONNECTION_GRACE_SECONDS = 20;

interface JoinOptions {
  nickname?: string;
  characterId?: string;
}

interface CreateOptions {
  isPrivate?: boolean;
}

export class PlayerState extends Schema {
  @type("string") nickname = "";
  @type("string") characterId = "default";
  @type("boolean") isHost = false;
  /** Mid-match joiners (or joiners past the active-player cap) watch until the next match. */
  @type("boolean") spectating = false;
}

export class LobbyState extends Schema {
  @type("string") phase: "lobby" | "playing" = "lobby";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

/** Handles the pre-match lobby: join by the room's own id as the link code, nickname, host start, spectate, reconnection. */
export class ArenaRoom extends Room<LobbyState> {
  maxClients = MAX_CLIENTS;

  /** Join order, tracked separately from `players` so host migration always picks the oldest remaining player. */
  private joinOrder: string[] = [];

  onCreate(options: CreateOptions = {}): void {
    this.setState(new LobbyState());
    this.setPrivate(options.isPrivate === true);
    this.onMessage("start", (client) => this.handleStart(client));
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    player.nickname = sanitizeNickname(options.nickname);
    player.characterId = options.characterId ?? "default";
    player.spectating = this.state.phase === "playing" || this.activePlayerCount() >= MAX_ACTIVE_PLAYERS;
    player.isHost = !this.hasHost();

    this.joinOrder.push(client.sessionId);
    this.state.players.set(client.sessionId, player);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    if (!this.state.players.has(client.sessionId)) return;

    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
        return;
      } catch {
        // grace window expired without a reconnect; fall through and remove the player
      }
    }

    this.removePlayer(client.sessionId);
  }

  private handleStart(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost || this.state.phase === "playing") return;
    this.state.phase = "playing";
  }

  private activePlayerCount(): number {
    let count = 0;
    for (const player of this.state.players.values()) {
      if (!player.spectating) count++;
    }
    return count;
  }

  private hasHost(): boolean {
    for (const player of this.state.players.values()) {
      if (player.isHost) return true;
    }
    return false;
  }

  private removePlayer(sessionId: string): void {
    const wasHost = this.state.players.get(sessionId)?.isHost ?? false;
    this.state.players.delete(sessionId);
    this.joinOrder = this.joinOrder.filter((id) => id !== sessionId);

    if (wasHost) this.migrateHost();
  }

  private migrateHost(): void {
    const nextHostId = this.joinOrder[0];
    if (!nextHostId) return;
    const nextHost = this.state.players.get(nextHostId);
    if (nextHost) nextHost.isHost = true;
  }
}

function sanitizeNickname(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  return (trimmed || "Ninja").slice(0, NICKNAME_MAX_LENGTH);
}
