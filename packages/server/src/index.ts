import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const port = Number(process.env.PORT ?? 2567);

const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("arena", ArenaRoom);

httpServer.listen(port, () => {
  console.log(`Ougi Arena server listening on ws://localhost:${port}`);
});
