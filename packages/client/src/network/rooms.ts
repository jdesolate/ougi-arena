import { SERVER_HTTP_URL } from "./colyseus.js";

/** Mirrors the server's `RoomListing`; the two packages don't share types, so this is the wire contract. */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  phase: "lobby" | "playing" | "finished";
  hostName: string;
  players: number;
  maxPlayers: number;
}

function isRoomListing(value: unknown): value is RoomListing {
  const room = value as Partial<RoomListing> | null;
  return typeof room?.roomId === "string" && typeof room.players === "number";
}

/** Public, joinable rooms. Never throws — an unreachable server just means an empty list on the landing page. */
export async function fetchRooms(): Promise<RoomListing[]> {
  try {
    const response = await fetch(`${SERVER_HTTP_URL}/rooms`);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return Array.isArray(body) ? body.filter(isRoomListing) : [];
  } catch {
    return [];
  }
}

/** A room worth dropping a Quick Play player into: still in its lobby, with a combat slot free. */
export function isJoinable(room: RoomListing): boolean {
  return room.phase === "lobby" && room.players < room.maxPlayers && room.clients < room.maxClients;
}
