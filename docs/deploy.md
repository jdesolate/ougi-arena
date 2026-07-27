# Deploy

Two free services: the Colyseus server on **Render**, the Phaser client on **Cloudflare Pages**. Total cost $0/month.

The two are deployed independently and only know about each other through two env vars:

| Where | Variable | Value |
|-------|----------|-------|
| Cloudflare Pages | `VITE_SERVER_URL` | the Render service URL, e.g. `wss://ougi-arena-server.onrender.com` |
| Render | `ALLOWED_ORIGINS` | the Pages origin, e.g. `https://ougi-arena.pages.dev` |

That's a chicken-and-egg pair, so deploy the server first, then the client, then come back and set `ALLOWED_ORIGINS`.

---

## 1. Server on Render

Push the repo to GitHub first — Render deploys from a connected repo.

**With the blueprint (easiest):** Render → *New* → *Blueprint* → pick this repo. It reads [`render.yaml`](../render.yaml) and creates the service with the build/start commands and health check already set.

**Manually**, if you'd rather click through: *New* → *Web Service* → connect the repo, then:

- **Runtime:** Node
- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ougi-arena/server build`
- **Start command:** `pnpm --filter @ougi-arena/server start`
- **Health check path:** `/health`
- **Instance type:** Free

Leave `ALLOWED_ORIGINS` unset for now. Render injects `PORT` itself — don't set it.

When the deploy finishes, check it:

```bash
curl https://<your-service>.onrender.com/health
```

Expect `{"status":"ok"}`. `/rooms` should return `[]`.

> **Why the build bundles instead of `tsc`.** `@ougi-arena/shared` is consumed as TypeScript source (its `main` points at `src/index.ts`), which every other consumer — vitest, tsx, Vite — handles natively. Plain `tsc` output would keep a bare `@ougi-arena/shared` import that Node can't resolve at runtime, so the server build runs esbuild instead and inlines `shared` into one file. Colyseus stays external and is resolved from `node_modules` as normal.

## 2. Client on Cloudflare Pages

Pages → *Create a project* → *Connect to Git* → pick this repo:

- **Framework preset:** None
- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ougi-arena/client build`
- **Build output directory:** `packages/client/dist`
- **Environment variable:** `VITE_SERVER_URL` = `wss://<your-service>.onrender.com`

`VITE_SERVER_URL` is inlined at build time, so changing it later needs a fresh deploy, not just a settings save.

[`packages/client/public/_redirects`](../packages/client/public/_redirects) is already in the repo — it makes Pages serve the app shell for `/r/<code>` room links instead of 404ing.

## 3. Lock the server down to the client's origin

Back on Render, set `ALLOWED_ORIGINS` to the Pages origin and redeploy:

```
ALLOWED_ORIGINS=https://ougi-arena.pages.dev
```

Add any other origins you use, comma-separated — a custom domain, or `http://localhost:5173` if you want a local client to talk to the deployed server. Note that Pages gives every branch/commit a preview subdomain; those origins are *not* covered by the production hostname, so either add them explicitly or accept that previews can't reach the server.

The allowlist is enforced in two places (both in [`packages/server/src/index.ts`](../packages/server/src/index.ts)): CORS headers on `/rooms` and `/health`, and — because CORS doesn't apply to WebSockets — an origin check at the socket handshake, which rejects a disallowed origin with a 401. Requests with no `Origin` header at all (curl, Render's health check) are allowed through, since CORS is a browser-enforced policy and blocking them would just break monitoring.

## 4. Cold starts

Render's free tier sleeps after ~15 minutes idle and takes ~30–60s to boot. The client pings `/health` the moment the landing page loads, so the server is usually already awake by the time a player has picked a ninja. If the ping takes more than a second, the lobby shows "Waking the dojo…" and every join path waits for the server to answer instead of failing. See `packages/client/src/network/wake.ts`.

Upgrading to Render's $7/mo tier removes cold starts entirely; nothing in the code needs to change.

## 5. Smoke test

Against the deployed pair, in a browser:

1. Load the Pages URL — no console errors, the lobby renders.
2. Room list loads (empty is fine) — confirms CORS is right.
3. Quick Play creates a room and starts a match against bots.
4. Copy the room link, open it in a second browser/device, join, and confirm both see each other move.
5. Reload mid-match to confirm reconnection still works.
6. Check a phone: lobby readable, drag-to-dash works without the page scrolling.

## Local development

Unchanged — no env vars needed:

```bash
pnpm install
pnpm dev
```

The client falls back to `ws://localhost:2567` and the server allows any origin when `ALLOWED_ORIGINS` is unset. See `.env.example` in each package for the full list of variables.
