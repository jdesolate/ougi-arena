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

/**
 * Deployed origins allowed to reach this server, comma-separated (`https://ougi-arena.pages.dev,...`).
 * Unset means allow anything — that's the dev default, since the Vite client runs on a different port.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) return true;
  // A missing Origin header means a non-browser caller (curl, health checks), which CORS doesn't govern.
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

/** Echoes the caller's origin when it's on the list, so the response is usable but not world-open. */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (allowedOrigins.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const httpServer = createServer();

/**
 * Our own routes: the public room list (Colyseus only exposes matchmaking over POST) and a health check the
 * client pings to wake a sleeping free-tier instance. Both must be registered *before* the Server below,
 * which snapshots existing request listeners.
 */
httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  const path = req.url?.split("?")[0];
  if (path !== "/rooms" && path !== "/health") return;

  applyCors(req, res);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

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
  transport: new WebSocketTransport({
    server: httpServer,
    // CORS headers don't apply to WebSockets, so the same allowlist is enforced at the handshake.
    verifyClient: (info, next) => next(isAllowedOrigin(info.origin)),
  }),
});

gameServer.define(ARENA_ROOM_NAME, ArenaRoom);

if (simulatedLatencyMs > 0) gameServer.simulateLatency(simulatedLatencyMs);

httpServer.listen(port, () => {
  const scope = allowedOrigins.length === 0 ? "any origin" : allowedOrigins.join(", ");
  console.log(`Ougi Arena server listening on port ${port} (allowing ${scope})`);
});
