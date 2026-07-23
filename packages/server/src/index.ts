import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  ARENA_ROOM_NAME,
  ArenaRoom,
  type RoomListing,
  type RoomMetadata,
} from "./rooms/ArenaRoom.js";

const port = Number(process.env.PORT ?? 2567);
/** Round-trip latency to fake, for the S9 feel pass: `SIMULATE_LATENCY_MS=200 pnpm dev`. */
const simulatedLatencyMs = Number(process.env.SIMULATE_LATENCY_MS ?? 0);

const httpServer = createServer();

/**
 * Public room list. Colyseus only exposes matchmaking over POST, so the landing page gets its own read-only
 * route — and it must be registered *before* the Server below, which snapshots existing request listeners.
 */
httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.startsWith("/rooms")) return;

  // Dev client runs on a different port; the real deployed origin is S11's job.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  void matchMaker
    .query({ name: ARENA_ROOM_NAME, private: false })
    .then((rooms) => {
      const listings: RoomListing[] = rooms
        .filter((room) => !room.locked && !room.unlisted)
        .map((room) => {
          const metadata = (room.metadata ?? {}) as Partial<RoomMetadata>;
          return {
            roomId: room.roomId,
            clients: room.clients,
            maxClients: room.maxClients,
            phase: metadata.phase ?? "lobby",
            hostName: metadata.hostName ?? "",
            players: metadata.players ?? 0,
            maxPlayers: metadata.maxPlayers ?? 0,
          };
        });
      res.writeHead(200);
      res.end(JSON.stringify(listings));
    })
    .catch(() => {
      res.writeHead(500);
      res.end(JSON.stringify([]));
    });
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ARENA_ROOM_NAME, ArenaRoom);

if (simulatedLatencyMs > 0) gameServer.simulateLatency(simulatedLatencyMs);

httpServer.listen(port, () => {
  console.log(`Ougi Arena server listening on ws://localhost:${port}`);
});
