import { Client } from "colyseus.js";

/**
 * Deployed builds set `VITE_SERVER_URL` to the Render service; dev falls back to the local server.
 * An `https://` value is accepted too, since that's the form you copy out of a hosting dashboard.
 */
function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (!configured) return "ws://localhost:2567";
  return configured.replace(/^http/, "ws").replace(/\/+$/, "");
}

export const SERVER_URL = resolveServerUrl();

/** Same host, HTTP scheme — the room list and health check are plain GETs alongside Colyseus's own routes. */
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/, "http");

export const ARENA_ROOM_NAME = "arena";

export const colyseusClient = new Client(SERVER_URL);
