# Deploy

Two free services: the Colyseus server on **Render**, the Phaser client on **Cloudflare** (Workers static assets, or Pages). Total cost $0/month.

The two are deployed independently and only know about each other through two env vars:

| Where | Variable | Value |
|-------|----------|-------|
| Cloudflare | `VITE_SERVER_URL` | the Render service URL, e.g. `wss://ougi-arena-server.onrender.com` |
| Render | `ALLOWED_ORIGINS` | the client origin, e.g. `https://ougi-arena.<subdomain>.workers.dev` |

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

## 2. Client on Cloudflare

Cloudflare now steers repo imports into **Workers Builds** (a static-asset Worker) rather than classic Pages. Both work; the Workers path is what this repo is configured for.

Workers & Pages → *Import a repository* → pick this repo:

- **Root directory:** `/`
- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ougi-arena/client build`
- **Deploy command:** `npx wrangler deploy --config wrangler.jsonc`
- **Build variable:** `VITE_SERVER_URL` = `wss://<your-service>.onrender.com`

Two things bite here:

- **The deploy command needs `--config`.** Plain `npx wrangler deploy` fails at the root of a pnpm workspace with *"The Cloudflare application detection logic has been run in the root of a workspace instead of targeting a specific project"* — wrangler won't guess which package to deploy. [`wrangler.jsonc`](../wrangler.jsonc) names it explicitly, pointing `assets.directory` at `packages/client/dist` with `not_found_handling: "single-page-application"` so `/r/<code>` room links serve the app shell instead of 404ing.
- **`name` in `wrangler.jsonc` must match your Worker's name.** It's `ougi-arena` in the repo; a mismatch silently creates a *second* Worker rather than updating the one the dashboard is showing you.

`VITE_SERVER_URL` must be set as a **build** variable, not a runtime one — Vite inlines it into the bundle at build time, so a client built without it ships pointing at `ws://localhost:2567` and will never connect. Changing it later needs a fresh build, not just a settings save.

<details>
<summary>Classic Pages instead</summary>

If you'd rather use Pages: build command and output directory as above (`packages/client/dist`), no deploy command. Pages has no `not_found_handling`, so room-link routing needs a `packages/client/public/_redirects` file containing `/r/*  /index.html  200`. **Don't add that file while deploying to Workers** — Workers static assets normalize `/index.html` to `/`, so it reads that rule as an infinite redirect loop and rejects the whole deploy. It's omitted from the repo for that reason.

</details>

## 3. Lock the server down to the client's origin

Back on Render, set `ALLOWED_ORIGINS` to the client's origin and redeploy:

```
ALLOWED_ORIGINS=https://ougi-arena.<subdomain>.workers.dev
```

Add any other origins you use, comma-separated — a custom domain, or `http://localhost:5173` if you want a local client to talk to the deployed server. Note that Cloudflare gives preview builds their own subdomains; those origins are *not* covered by the production hostname, so either add them explicitly or accept that previews can't reach the server.

The allowlist is enforced in two places (both in [`packages/server/src/index.ts`](../packages/server/src/index.ts)): CORS headers on `/rooms` and `/health`, and — because CORS doesn't apply to WebSockets — an origin check at the socket handshake, which rejects a disallowed origin with a 401. Requests with no `Origin` header at all (curl, Render's health check) are allowed through, since CORS is a browser-enforced policy and blocking them would just break monitoring.

## 4. Cold starts

Render's free tier sleeps after ~15 minutes idle and takes ~30–60s to boot. The client pings `/health` the moment the landing page loads, so the server is usually already awake by the time a player has picked a ninja. If the ping takes more than a second, the lobby shows "Waking the dojo…" and every join path waits for the server to answer instead of failing. See `packages/client/src/network/wake.ts`.

Upgrading to Render's $7/mo tier removes cold starts entirely; nothing in the code needs to change.

## 5. Smoke test

Against the deployed pair, in a browser:

1. Load the client URL — no console errors, the lobby renders.
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
