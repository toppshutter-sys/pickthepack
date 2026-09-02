# Deploying the server to the cloud

This lets everyone join from anywhere — not just people on the same wifi as whoever's running the
server on their laptop. It only affects `server/`; the mobile app doesn't change at all, you just
point it at a real address instead of a LAN IP (see the last section below).

**Money still never touches the app either way** — this only changes *where the server runs*, not
what it does. Pot totals are still just numbers on screen; nothing here adds payment processing.

Two options below — pick one. Render is the simplest to get started with (all in a browser, no
command line). Fly.io is better once you actually want the low-latency Miami region for Caribbean
players specifically, and is comfortable if you're okay with a CLI.

## Option A — Render (easiest, browser-only)

1. Push this repo to a GitHub (or GitLab) repository, if it isn't already.
2. Go to [render.com](https://render.com), sign up, and click **New → Web Service**.
3. Connect the repo. When asked for settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Region:** pick the one closest to your players (for the Caribbean, Render's **Virginia**
     region is the shortest hop of the ones it offers).
   - **Instance type:** the free tier works to try it out — see the caveat below before using it
     for a real game night.
4. Deploy. Render gives you a URL like `https://pick-the-pack-server.onrender.com` — that's your
   new server address.
5. Visit `https://your-app.onrender.com/health` — you should see `{"ok":true,...}`.

**Free-tier caveat:** Render's free web services spin down after 15 minutes of no traffic, and the
next request wakes it back up — which can take 30–60 seconds. For a quick test that's a mild
annoyance (the first "Create Room" tap after a while just hangs briefly). For an actual game night
you don't want that delay, so a paid instance (their cheapest paid tier keeps it always-on) is worth
it once this is more than a test — and that's exactly the kind of cost a hosting subscription is
meant to cover.

If you'd rather not click through the dashboard, `render.yaml` at the repo root describes this same
setup as a "Blueprint" Render can read automatically when you connect the repo.

## Option B — Fly.io (CLI, lower latency to the Caribbean)

1. Install the Fly CLI: `curl -L https://fly.io/install.sh | sh` (see fly.io/docs for
   Windows/other options), then `fly auth login`.
2. From the `server/` directory:
   ```bash
   cd server
   fly launch
   ```
   It'll detect the included `fly.toml` and `Dockerfile`. When it asks for an app name, either
   accept a suggestion or pick your own (must be globally unique on Fly). When it asks about a
   region, `mia` (Miami) is already set in `fly.toml` and is Fly's lowest-latency region for
   Caribbean players — keep it unless you have a reason not to.
3. `fly deploy` — this builds the Docker image and deploys it. Fly gives you a URL like
   `https://pick-the-pack-server.fly.dev`.
4. Visit `https://your-app.fly.dev/health` to confirm it's up.

Fly's free allowance is limited (a small number of shared-CPU machines) but, unlike Render's free
tier, a `min_machines_running = 1` app (already set in `fly.toml`) stays up rather than sleeping —
worth checking Fly's current pricing before committing if you expect real traffic.

## Pointing the app at your new server

Whichever option you used, you now have a real `https://...` address instead of a LAN IP. In the
mobile app, that's just what you type into the **Server address** field on the home screen — it
works exactly the same as a LAN IP did, no code changes needed. If you want it to be the default
so people don't have to type it, change the initial value of `serverUrl` in
`mobile/src/screens/HomeScreen.js`.

For the standalone browser demo (`pick-the-pack-demo.html`) — that one runs entirely client-side
with no server at all, so this doesn't apply to it; it stays a local preview either way.

## What this doesn't do yet

This gets the server running somewhere everyone can reach — it does *not* add accounts, a paid
tier, or any billing. Anyone with the URL can still create unlimited rooms for free, same as today.
That gating is a separate, later step (see `claude/hosted-subscription-scope.md` in the project for
the fuller plan) — deliberately kept separate so "playable from anywhere" doesn't have to wait on
"how do we charge for it" being settled first.
