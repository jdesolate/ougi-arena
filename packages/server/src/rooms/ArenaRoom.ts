import { Room, Client } from "@colyseus/core";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import {
  ARENAS,
  CHARACTERS,
  DEFAULT_ARENA_ID,
  DEFAULT_CHARACTER_ID,
  MATCH_DURATION_TICKS,
  SIM_DT,
  SIM_TICK_RATE_HZ,
  arenaById,
  createSimState,
  step,
  type SimCommand,
  type SimEvent,
  type SimState,
} from "@ougi-arena/shared";
import { BOT_ID_PREFIX, decideBotCommand, isBotId } from "../bot.js";

export const ARENA_ROOM_NAME = "arena";

/** Active combatants are capped at 4; the room stays open past that so late joiners can still spectate. */
const MAX_ACTIVE_PLAYERS = 4;
const MAX_CLIENTS = 8;
const NICKNAME_MAX_LENGTH = 16;
const RECONNECTION_GRACE_SECONDS = 20;

const SIM_DT_MS = SIM_DT * 1000;
/** Caps fixed steps per simulation callback so a stalled event loop can't spiral into a catch-up freeze. */
const MAX_STEPS_PER_TICK = 5;

/**
 * What the public room list needs to know without opening a socket. Kept on the room's matchmaking metadata
 * so `matchMaker.query` can serve it; bots are excluded from `players` since a bot-filled room isn't full.
 */
export interface RoomMetadata {
  phase: "lobby" | "playing" | "finished";
  hostName: string;
  players: number;
  maxPlayers: number;
}

export interface RoomListing extends RoomMetadata {
  roomId: string;
  clients: number;
  maxClients: number;
}

interface JoinOptions {
  nickname?: string;
  characterId?: string;
}

interface CreateOptions {
  isPrivate?: boolean;
}

interface LaunchMessage {
  dirX?: number;
  dirY?: number;
  power?: number;
  /** Client-chosen sequence number, echoed back once the launch has actually been applied to the sim. */
  seq?: number;
}

interface ChargeMessage {
  active?: boolean;
}

interface MapMessage {
  mapId?: string;
}

export class PlayerState extends Schema {
  @type("string") nickname = "";
  @type("string") characterId = DEFAULT_CHARACTER_ID;
  @type("boolean") isHost = false;
  /** Mid-match joiners (or joiners past the active-player cap) watch until the next match. */
  @type("boolean") spectating = false;
  /** KO count for the current match; reset on every match start (including rematch). */
  @type("number") score = 0;
  /** True for a slot filled by AI rather than a real client; bots are visibly labeled and yield to humans. */
  @type("boolean") isBot = false;
}

/** Authoritative ninja state streamed to clients; id is the owner's sessionId so a client finds its own. */
export class NinjaSchema extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") active = true;
  /** Lets a client tell "the server hasn't moved me yet" from "the server is still moving me" when reconciling. */
  @type("boolean") dashing = false;
  @type("number") hp = 0;
  @type("number") tp = 0;
  @type("boolean") charging = false;
  @type("number") sp = 0;
  /** Non-zero while a duration Ougi is running, so the client can show it's active. */
  @type("number") ougiTicks = 0;
  /** Synced so the client's aim preview reflects an Ougi reach buff instead of re-deriving it. */
  @type("number") dashRangeMultiplier = 1;
  @type("number") invulnerableTicks = 0;
}

/** Only the mutable fields sync — obstacle geometry is static map data the client already has. */
export class ObstacleSchema extends Schema {
  @type("number") hp = 0;
  @type("boolean") alive = true;
}

export class LobbyState extends Schema {
  @type("string") phase: "lobby" | "playing" | "finished" = "lobby";
  /** Host's map choice; clients resolve the geometry from the shared registry rather than syncing it. */
  @type("string") mapId = DEFAULT_ARENA_ID;
  @type("number") tick = 0;
  @type("number") matchTimeRemaining = 0;
  @type("boolean") suddenDeath = false;
  /** Winning player's sessionId once `phase` is "finished"; empty string on an unresolved draw. */
  @type("string") winnerId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([NinjaSchema]) ninjas = new ArraySchema<NinjaSchema>();
  @type([ObstacleSchema]) obstacles = new ArraySchema<ObstacleSchema>();
}

/**
 * Lobby plus the authoritative match: once the host starts, the room advances the shared sim at a fixed 30Hz
 * and mirrors it into the schema so every client renders the same world.
 */
export class ArenaRoom extends Room<LobbyState> {
  maxClients = MAX_CLIENTS;

  /** Join order, tracked separately from `players` so host migration always picks the oldest remaining player. */
  private joinOrder: string[] = [];

  private sim: SimState | null = null;
  /** Launches and Ougi fires received since the last tick; drained into the next fixed step. */
  private commandQueue: SimCommand[] = [];
  /** Launch receipts owed to clients, flushed the moment the step that consumed the command has run. */
  private pendingAcks: { client: Client; seq: number }[] = [];
  private accumulatorMs = 0;
  /** Source of truth for the match clock; `state.matchTimeRemaining` is just its seconds display. */
  private matchTicksRemaining = 0;
  /** Never reused within a room's lifetime, so a stale reference from a just-removed bot can't collide. */
  private botCounter = 0;

  onCreate(options: CreateOptions = {}): void {
    this.setState(new LobbyState());
    this.setPrivate(options.isPrivate === true);
    this.onMessage("start", (client) => this.handleStart(client));
    this.onMessage("map", (client, message: MapMessage) => this.handleMap(client, message));
    this.onMessage("launch", (client, message: LaunchMessage) => this.handleLaunch(client, message));
    this.onMessage("charge", (client, message: ChargeMessage) => this.handleCharge(client, message));
    this.onMessage("ougi", (client) => this.handleOugi(client));
    this.onMessage("rematch", (client) => this.handleRematch(client));
    // Round-trip probe for the client's latency readout; echoes the client's own timestamp back untouched.
    this.onMessage("ping", (client, sentAt: number) => client.send("pong", sentAt));
    this.publishMetadata();
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    player.nickname = sanitizeNickname(options.nickname);
    player.characterId = sanitizeCharacterId(options.characterId);
    player.spectating = this.state.phase === "playing" || this.activePlayerCount() >= MAX_ACTIVE_PLAYERS;
    player.isHost = !this.hasHost();

    this.joinOrder.push(client.sessionId);
    this.state.players.set(client.sessionId, player);
    this.publishMetadata();
  }

  /**
   * Keeps the public room list's view of this room current — player count, host, and phase, so Quick Play can
   * tell a joinable lobby from a match already in progress without opening a socket.
   */
  private publishMetadata(): void {
    let hostName = "";
    let players = 0;
    for (const player of this.state.players.values()) {
      if (player.isBot) continue;
      players++;
      if (player.isHost) hostName = player.nickname;
    }

    const metadata: RoomMetadata = {
      phase: this.state.phase,
      hostName,
      players,
      maxPlayers: MAX_ACTIVE_PLAYERS,
    };
    void this.setMetadata(metadata);
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
    this.startMatch();
  }

  /**
   * Lobby-only on purpose: clients size their canvas from the map once the match starts, so letting the host
   * swap arenas mid-match (or between rematches) would mean rebuilding the whole scene for no design gain.
   */
  private handleMap(client: Client, message: MapMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost || this.state.phase !== "lobby") return;
    if (!ARENAS.some((arena) => arena.id === message?.mapId)) return;
    this.state.mapId = message.mapId!;
  }

  private handleRematch(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost || this.state.phase !== "finished") return;
    this.startMatch();
  }

  private handleLaunch(client: Client, message: LaunchMessage): void {
    if (this.state.phase !== "playing") return;
    const dirX = Number(message?.dirX);
    const dirY = Number(message?.dirY);
    const power = Number(message?.power);
    if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || !Number.isFinite(power)) return;

    this.commandQueue.push({ type: "launch", ninjaId: client.sessionId, dirX, dirY, power });

    // The sequence number is client bookkeeping, not sim input, so it rides alongside the command rather than in it.
    const seq = Number(message?.seq);
    if (Number.isFinite(seq)) this.pendingAcks.push({ client, seq });
  }

  /** The sim ignores this unless the meter is actually full, so no server-side SP check is needed here. */
  private handleOugi(client: Client): void {
    if (this.state.phase !== "playing") return;
    this.commandQueue.push({ type: "ougi", ninjaId: client.sessionId });
  }

  /** Continuous hold state, not a queued command — TP accrues tick over tick for as long as this stays true. */
  private handleCharge(client: Client, message: ChargeMessage): void {
    if (!this.sim || this.state.phase !== "playing") return;
    const ninja = this.sim.ninjas.find((n) => n.id === client.sessionId);
    if (!ninja || !ninja.active) return;
    ninja.charging = message?.active === true;
  }

  /**
   * Builds the sim from the current active players and starts advancing it at a fixed 30Hz. Also used for
   * rematch. Bots are rebuilt from scratch every time this runs, which is what makes them yield their slot to
   * any human who joined (and was spectating) since the last match started.
   */
  private startMatch(): void {
    this.clearBots();

    const humanIds = this.joinOrder.filter((id) => this.state.players.has(id));
    const activeHumanIds = humanIds.slice(0, MAX_ACTIVE_PLAYERS);
    for (const id of humanIds) {
      const player = this.state.players.get(id);
      if (player) player.spectating = !activeHumanIds.includes(id);
    }

    const botIds = this.addBots(MAX_ACTIVE_PLAYERS - activeHumanIds.length);
    const activeIds = [...activeHumanIds, ...botIds];

    const characterIds = activeIds.map((id) => this.state.players.get(id)?.characterId ?? DEFAULT_CHARACTER_ID);

    this.sim = createSimState(activeIds, arenaById(this.state.mapId), characterIds);
    this.commandQueue = [];
    this.pendingAcks = [];
    this.accumulatorMs = 0;
    this.matchTicksRemaining = MATCH_DURATION_TICKS;

    for (const player of this.state.players.values()) player.score = 0;

    this.state.ninjas.clear();
    for (const ninja of this.sim.ninjas) {
      const schema = new NinjaSchema();
      schema.id = ninja.id;
      schema.x = ninja.x;
      schema.y = ninja.y;
      schema.active = ninja.active;
      schema.dashing = ninja.dashBudget > 0;
      schema.hp = ninja.hp;
      schema.tp = ninja.tp;
      schema.charging = ninja.charging;
      schema.sp = ninja.sp;
      schema.ougiTicks = ninja.ougiTicks;
      schema.dashRangeMultiplier = ninja.dashRangeMultiplier;
      schema.invulnerableTicks = ninja.invulnerableTicks;
      this.state.ninjas.push(schema);
    }

    this.state.obstacles.clear();
    for (const obstacle of this.sim.obstacles) {
      const schema = new ObstacleSchema();
      schema.hp = obstacle.hp;
      schema.alive = obstacle.alive;
      this.state.obstacles.push(schema);
    }

    this.state.phase = "playing";
    this.state.suddenDeath = false;
    this.state.winnerId = "";
    this.state.matchTimeRemaining = Math.ceil(this.matchTicksRemaining / SIM_TICK_RATE_HZ);
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), SIM_DT_MS);
    this.publishMetadata();
  }

  private tick(deltaMs: number): void {
    if (!this.sim || this.state.phase !== "playing") return;

    this.runBotAI();

    this.accumulatorMs += deltaMs;
    let steps = 0;
    let suddenDeathKO = false;
    const tickEvents: SimEvent[] = [];
    while (this.accumulatorMs >= SIM_DT_MS && steps < MAX_STEPS_PER_TICK) {
      // Queued commands apply on the first step only, so a catch-up burst can't fire the same dash repeatedly.
      const commands = steps === 0 ? this.commandQueue : [];
      const events = step(this.sim, commands);
      tickEvents.push(...events);
      for (const event of events) {
        if (event.type !== "ninjaKO") continue;
        const killer = this.state.players.get(event.killerId);
        if (killer) killer.score++;
        if (this.state.suddenDeath) suddenDeathKO = true;
      }
      this.accumulatorMs -= SIM_DT_MS;
      steps++;
    }
    // Schema diffs say what the world looks like now, not what just happened to it — hits, breaks and KOs are
    // instants the client can't recover from state alone, so the effects/audio pass gets them as events.
    if (tickEvents.length > 0) this.broadcast("events", tickEvents);
    // Only the first step consumes the queue, so clear it only if a step actually ran — a callback that
    // arrives before a full timestep has accrued must leave those commands queued, not drop them.
    if (steps > 0) {
      this.commandQueue = [];
      // Sent only now, so an ack always means "your dash is in the authoritative world" — the client can
      // safely resume reconciling against a server position that finally includes the launch.
      for (const ack of this.pendingAcks) ack.client.send("launchAck", ack.seq);
      this.pendingAcks = [];
    }

    this.syncState();

    if (suddenDeathKO) {
      this.endMatch();
      return;
    }

    this.matchTicksRemaining = Math.max(0, this.matchTicksRemaining - steps);
    this.state.matchTimeRemaining = Math.ceil(this.matchTicksRemaining / SIM_TICK_RATE_HZ);
    if (!this.state.suddenDeath && this.matchTicksRemaining <= 0) {
      if (this.leaderIds().length > 1) this.state.suddenDeath = true;
      else this.endMatch();
    }
  }

  /** Regulation time is up (or sudden death just resolved) with a clear winner — freeze the match. */
  private endMatch(): void {
    this.state.phase = "finished";
    const leaders = this.leaderIds();
    this.state.winnerId = leaders.length === 1 ? leaders[0]! : "";
    this.publishMetadata();
  }

  /** SessionIds tied for the highest score among this match's participants (`sim.ninjas`), spectators excluded. */
  private leaderIds(): string[] {
    if (!this.sim) return [];
    let best = -1;
    let leaders: string[] = [];
    for (const ninja of this.sim.ninjas) {
      const score = this.state.players.get(ninja.id)?.score ?? 0;
      if (score > best) {
        best = score;
        leaders = [ninja.id];
      } else if (score === best) {
        leaders.push(ninja.id);
      }
    }
    return leaders;
  }

  /** Mirrors the plain sim into the synced schema; arrays stay index-aligned with the sim. */
  private syncState(): void {
    if (!this.sim) return;

    for (let i = 0; i < this.sim.ninjas.length; i++) {
      const ninja = this.sim.ninjas[i];
      const schema = this.state.ninjas[i];
      if (!ninja || !schema) continue;
      schema.x = ninja.x;
      schema.y = ninja.y;
      schema.active = ninja.active;
      schema.dashing = ninja.dashBudget > 0;
      schema.hp = ninja.hp;
      schema.tp = ninja.tp;
      schema.charging = ninja.charging;
      schema.sp = ninja.sp;
      schema.ougiTicks = ninja.ougiTicks;
      schema.dashRangeMultiplier = ninja.dashRangeMultiplier;
      schema.invulnerableTicks = ninja.invulnerableTicks;
    }

    for (let i = 0; i < this.sim.obstacles.length; i++) {
      const obstacle = this.sim.obstacles[i];
      const schema = this.state.obstacles[i];
      if (!obstacle || !schema) continue;
      schema.hp = obstacle.hp;
      schema.alive = obstacle.alive;
    }

    this.state.tick = this.sim.tick;
  }

  /** One decision per callback (not per fixed step), same cadence real player input arrives at. */
  private runBotAI(): void {
    if (!this.sim) return;
    for (const ninja of this.sim.ninjas) {
      if (!isBotId(ninja.id)) continue;
      const { command, charging } = decideBotCommand(this.sim, ninja);
      ninja.charging = charging;
      if (command) this.commandQueue.push(command);
    }
  }

  /** Fills `count` empty active slots with bots, round-robining characters so they're not all identical. */
  private addBots(count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      this.botCounter++;
      const id = `${BOT_ID_PREFIX}${this.botCounter}`;
      const player = new PlayerState();
      player.nickname = `Bot ${this.botCounter}`;
      player.characterId = CHARACTERS[(this.botCounter - 1) % CHARACTERS.length]!.id;
      player.isBot = true;
      player.spectating = false;
      this.state.players.set(id, player);
      this.joinOrder.push(id);
      ids.push(id);
    }
    return ids;
  }

  private clearBots(): void {
    for (const id of [...this.state.players.keys()]) {
      if (isBotId(id)) this.state.players.delete(id);
    }
    this.joinOrder = this.joinOrder.filter((id) => !isBotId(id));
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

    // Drop the ninja from the live match so it stops updating and rendering.
    if (this.sim) {
      const ninja = this.sim.ninjas.find((n) => n.id === sessionId);
      if (ninja) ninja.active = false;
    }

    if (wasHost) this.migrateHost();
    this.publishMetadata();
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

function sanitizeCharacterId(raw: string | undefined): string {
  return CHARACTERS.some((c) => c.id === raw) ? raw! : DEFAULT_CHARACTER_ID;
}
