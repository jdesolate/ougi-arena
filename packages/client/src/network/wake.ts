import { SERVER_HTTP_URL } from "./colyseus.js";

/** A responsive server answers in well under this; anything slower is a cold start worth telling the player about. */
const SLOW_RESPONSE_MS = 1000;
/** Render's free tier takes ~30–60s to boot, so keep retrying past the point a normal fetch would give up. */
const WAKE_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 2000;

let wakePromise: Promise<boolean> | null = null;

async function pingHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_HTTP_URL}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Pings the server until it answers, reporting whether it's still waking so the UI can say so.
 * Shared by every join path via a single in-flight promise: the landing page starts this on load, so by the
 * time a player has picked a ninja the free-tier instance is usually already up.
 */
export function wakeServer(onWaking?: (waking: boolean) => void): Promise<boolean> {
  if (wakePromise) return wakePromise;

  wakePromise = (async () => {
    const startedAt = Date.now();
    let announced = false;

    while (Date.now() - startedAt < WAKE_TIMEOUT_MS) {
      const ok = await pingHealth();
      if (ok) {
        if (announced) onWaking?.(false);
        return true;
      }

      // Only speak up once the wait is long enough to notice — a fast failure is usually just a dev server that's off.
      if (!announced && Date.now() - startedAt >= SLOW_RESPONSE_MS) {
        announced = true;
        onWaking?.(true);
      }
      await delay(RETRY_DELAY_MS);
    }

    onWaking?.(false);
    return false;
  })();

  return wakePromise;
}

/** Lets a failed match attempt re-check a server that may have gone back to sleep since the last ping. */
export function resetWake(): void {
  wakePromise = null;
}
