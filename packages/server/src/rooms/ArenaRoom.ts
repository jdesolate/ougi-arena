import { Room, Client } from "@colyseus/core";
import { Schema, type } from "@colyseus/schema";

// Placeholder state; real player/obstacle schema lands in S4/S5.
class ArenaState extends Schema {
  @type("number") tick = 0;
}

export class ArenaRoom extends Room<ArenaState> {
  onCreate(): void {
    this.setState(new ArenaState());
  }

  onJoin(client: Client): void {
    console.log(`${client.sessionId} joined`);
  }

  onLeave(client: Client): void {
    console.log(`${client.sessionId} left`);
  }
}
