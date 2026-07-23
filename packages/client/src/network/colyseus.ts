import { Client } from "colyseus.js";

/** Local dev server; env-based config for deployed hosts lands in S11. */
export const SERVER_URL = "ws://localhost:2567";

/** Same host, HTTP scheme — the public room list is a plain GET alongside Colyseus's own matchmaking routes. */
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/, "http");

export const ARENA_ROOM_NAME = "arena";

export const colyseusClient = new Client(SERVER_URL);
