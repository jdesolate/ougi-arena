import type { Room } from "colyseus.js";
import { CHARACTERS, ougiForCharacter } from "@ougi-arena/shared";
import { ARENA_ROOM_NAME, colyseusClient } from "./network/colyseus.js";
import { fetchRooms, isJoinable, type RoomListing } from "./network/rooms.js";
import { playUiSfx } from "./audio/sfx.js";
import { skinFor } from "./skins.js";
import { drawPortrait } from "./ui/portrait.js";

const NICKNAME_MAX_LENGTH = 16;
const RECONNECT_STORAGE_KEY = "ougi-arena:reconnect";
/** Room list refresh cadence while the landing page is up; cheap GET, and stale lobbies are the whole problem. */
const ROOM_LIST_POLL_MS = 4000;

interface StoredReconnect {
  token: string;
}

/**
 * Server state isn't shared with the client bundle (schema classes live in `@ougi-arena/server`),
 * so colyseus.js decodes it via reflection and we read it loosely here.
 */
interface PlayerView {
  nickname: string;
  isHost: boolean;
  spectating: boolean;
  isBot: boolean;
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function matchRoomCodeInPath(pathname: string): string | null {
  const match = /^\/r\/([A-Za-z0-9]+)$/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/** Quick Play clumps players into the busiest room rather than scattering them across half-empty ones. */
function byFullest(a: RoomListing, b: RoomListing): number {
  return b.players - a.players;
}

function persistReconnect(room: Room): void {
  const payload: StoredReconnect = { token: room.reconnectionToken };
  localStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(payload));
}

async function tryReconnect(): Promise<Room | null> {
  const raw = localStorage.getItem(RECONNECT_STORAGE_KEY);
  if (!raw) return null;
  localStorage.removeItem(RECONNECT_STORAGE_KEY);

  try {
    const stored = JSON.parse(raw) as StoredReconnect;
    return await colyseusClient.reconnect(stored.token);
  } catch {
    return null;
  }
}

/** Runs the pre-match lobby (create/join by link code, nickname, host start, spectate). Calls `onStart` once the match begins. */
export function initLobby(onStart: (room: Room) => void): void {
  const lobbyEl = el<HTMLDivElement>("lobby");
  const formEl = el<HTMLDivElement>("lobby-form");
  const roomEl = el<HTMLDivElement>("lobby-room");
  const nicknameInput = el<HTMLInputElement>("nickname-input");
  const characterSelectEl = el<HTMLDivElement>("character-select");
  const characterOugiEl = el<HTMLParagraphElement>("character-ougi");
  const privateToggle = el<HTMLInputElement>("private-toggle");
  const createBtn = el<HTMLButtonElement>("create-btn");
  const joinCodeInput = el<HTMLInputElement>("join-code-input");
  const joinBtn = el<HTMLButtonElement>("join-btn");
  const errorEl = el<HTMLParagraphElement>("lobby-error");
  const roomCodeEl = el<HTMLSpanElement>("room-code");
  const copyLinkBtn = el<HTMLButtonElement>("copy-link-btn");
  const playerListEl = el<HTMLUListElement>("player-list");
  const spectateNoteEl = el<HTMLParagraphElement>("spectate-note");
  const startBtn = el<HTMLButtonElement>("start-btn");
  const waitingNoteEl = el<HTMLParagraphElement>("waiting-note");
  const quickPlayBtn = el<HTMLButtonElement>("quick-play-btn");
  const roomListEl = el<HTMLUListElement>("room-list");
  const roomListEmptyEl = el<HTMLParagraphElement>("room-list-empty");

  // Guards against `onStart` re-firing: once playing, state syncs ~30x/sec and each change re-renders.
  let matchStarted = false;

  function showError(message: string): void {
    errorEl.textContent = message;
  }

  function renderPlayers(room: Room): void {
    const state = room.state as { phase: string; players: Map<string, PlayerView> };
    playerListEl.innerHTML = "";

    let me: PlayerView | undefined;
    for (const [sessionId, player] of state.players.entries()) {
      const li = document.createElement("li");
      const tags = [
        player.isHost ? "host" : null,
        player.isBot ? "bot" : null,
        player.spectating ? "spectating" : null,
      ].filter(Boolean);
      li.textContent = tags.length ? `${player.nickname} (${tags.join(", ")})` : player.nickname;
      playerListEl.appendChild(li);
      if (sessionId === room.sessionId) me = player;
    }

    spectateNoteEl.hidden = !me?.spectating;
    startBtn.hidden = !me?.isHost;
    waitingNoteEl.hidden = Boolean(me?.isHost);

    if (state.phase === "playing" && !matchStarted) {
      matchStarted = true;
      lobbyEl.hidden = true;
      onStart(room);
    }
  }

  /** Nickname and character, shared by every join path (create, join-by-code, Quick Play, room list). */
  function joinOptions(): { nickname: string; characterId: string } {
    return {
      nickname: nicknameInput.value.slice(0, NICKNAME_MAX_LENGTH),
      characterId: selectedCharacterId,
    };
  }

  function enterRoom(room: Room): void {
    persistReconnect(room);
    window.clearInterval(roomListTimer);
    formEl.hidden = true;
    roomEl.hidden = false;
    roomCodeEl.textContent = room.roomId;
    // Keep the query string: the room code goes in the path, but `?debug` has to survive into the match.
    history.replaceState(null, "", `/r/${room.roomId}${window.location.search}`);

    room.onStateChange(() => renderPlayers(room));
    startBtn.addEventListener("click", () => room.send("start"));
    copyLinkBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(window.location.href);
    });
  }

  /** Character select: a card per ninja, showing the sprite in that character's colour and the Ougi it brings. */
  let selectedCharacterId = CHARACTERS[0]?.id ?? "";
  const characterCards = new Map<string, HTMLButtonElement>();

  function selectCharacter(characterId: string, silent = false): void {
    selectedCharacterId = characterId;
    for (const [id, card] of characterCards) {
      card.setAttribute("aria-pressed", String(id === characterId));
    }
    const ougi = ougiForCharacter(characterId);
    characterOugiEl.textContent = `${ougi.name} — ${ougi.description}`;
    if (!silent) playUiSfx("select");
  }

  for (const character of CHARACTERS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "character-card";
    card.setAttribute("aria-pressed", "false");

    const canvas = document.createElement("canvas");
    void drawPortrait(canvas, skinFor(character.id).bodyColor);

    const name = document.createElement("span");
    name.textContent = character.name;

    card.append(canvas, name);
    card.addEventListener("click", () => selectCharacter(character.id));
    characterSelectEl.appendChild(card);
    characterCards.set(character.id, card);
  }
  selectCharacter(selectedCharacterId, true);

  /** Renders the public room list, and keeps it fresh so a lobby that just filled up isn't still advertised. */
  async function refreshRoomList(): Promise<void> {
    const rooms = await fetchRooms();
    roomListEl.innerHTML = "";
    roomListEmptyEl.hidden = rooms.length > 0;

    for (const room of rooms) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      const host = room.hostName || "Someone";
      const status = room.phase === "lobby" ? "in lobby" : "in a match — you'd spectate";
      label.textContent = `${host}'s room · ${room.players}/${room.maxPlayers} · ${status}`;

      const joinRoomBtn = document.createElement("button");
      joinRoomBtn.textContent = "Join";
      joinRoomBtn.addEventListener("click", () => {
        showError("");
        colyseusClient
          .joinById(room.roomId, joinOptions())
          .then(enterRoom)
          .catch(() => showError("That room is no longer joinable."));
      });

      li.append(label, joinRoomBtn);
      roomListEl.appendChild(li);
    }
  }

  /**
   * Quick Play: drop into the fullest joinable public lobby, else open a new one. Two players quick-playing at
   * the same instant can race for the last slot, so a failed join just falls through to the next candidate.
   */
  async function quickPlay(): Promise<Room> {
    const candidates = (await fetchRooms()).filter(isJoinable).sort(byFullest);

    for (const room of candidates) {
      try {
        return await colyseusClient.joinById(room.roomId, joinOptions());
      } catch {
        // raced by another joiner, or the room just started — try the next one
      }
    }

    return colyseusClient.create(ARENA_ROOM_NAME, { ...joinOptions(), isPrivate: false });
  }

  const codeFromUrl = matchRoomCodeInPath(window.location.pathname);
  if (codeFromUrl) joinCodeInput.value = codeFromUrl;

  const roomListTimer = window.setInterval(() => void refreshRoomList(), ROOM_LIST_POLL_MS);
  void refreshRoomList();

  quickPlayBtn.addEventListener("click", () => {
    showError("");
    quickPlayBtn.disabled = true;
    quickPlay()
      .then(enterRoom)
      .catch(() => showError("Could not find or create a room. Is the server running?"))
      .finally(() => {
        quickPlayBtn.disabled = false;
      });
  });

  createBtn.addEventListener("click", () => {
    showError("");
    colyseusClient
      .create(ARENA_ROOM_NAME, { ...joinOptions(), isPrivate: privateToggle.checked })
      .then(enterRoom)
      .catch(() => showError("Could not create a room. Is the server running?"));
  });

  joinBtn.addEventListener("click", () => {
    showError("");
    const code = joinCodeInput.value.trim();
    if (!code) {
      showError("Enter a room code to join.");
      return;
    }

    colyseusClient
      .joinById(code, joinOptions())
      .then(enterRoom)
      .catch(() => showError("Could not join that room — check the code."));
  });

  void tryReconnect().then((room) => {
    if (room) enterRoom(room);
  });
}
