import type { Room } from "colyseus.js";
import { colyseusClient } from "./network/colyseus.js";

const NICKNAME_MAX_LENGTH = 16;
const RECONNECT_STORAGE_KEY = "ougi-arena:reconnect";

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
      const tags = [player.isHost ? "host" : null, player.spectating ? "spectating" : null].filter(Boolean);
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

  function enterRoom(room: Room): void {
    persistReconnect(room);
    formEl.hidden = true;
    roomEl.hidden = false;
    roomCodeEl.textContent = room.roomId;
    history.replaceState(null, "", `/r/${room.roomId}`);

    room.onStateChange(() => renderPlayers(room));
    startBtn.addEventListener("click", () => room.send("start"));
    copyLinkBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(window.location.href);
    });
  }

  const codeFromUrl = matchRoomCodeInPath(window.location.pathname);
  if (codeFromUrl) joinCodeInput.value = codeFromUrl;

  createBtn.addEventListener("click", () => {
    showError("");
    colyseusClient
      .create("arena", {
        nickname: nicknameInput.value.slice(0, NICKNAME_MAX_LENGTH),
        isPrivate: privateToggle.checked,
      })
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
      .joinById(code, { nickname: nicknameInput.value.slice(0, NICKNAME_MAX_LENGTH) })
      .then(enterRoom)
      .catch(() => showError("Could not join that room — check the code."));
  });

  void tryReconnect().then((room) => {
    if (room) enterRoom(room);
  });
}
