import { Client } from "colyseus.js";

/** Local dev server; env-based config for deployed hosts lands in S11. */
const SERVER_URL = "ws://localhost:2567";

export const colyseusClient = new Client(SERVER_URL);
