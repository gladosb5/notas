# notas on Cloudflare

One Worker, free plan: the notebook and its models as static assets, the
"hey nota" forward with its key kept as a secret, and a Durable Object per
shared note that relays live edits.

Live at https://notas.glados.pro, a custom domain on the glados.pro zone
(`routes` in `wrangler.jsonc`; the deploy creates the DNS record and
certificate), and at https://notas.m-12443042.workers.dev.

The app files under `public/` are copies made by `sync.mjs` from the
project root (git-ignored; run `npm run sync` to refresh). The folder's own
files are:

- `wrangler.jsonc` — the Worker: `public/` as assets with `html_handling`
  off (the page must stay at `/notas.html`, which `sw.js`, the manifest and
  the model contract all name), observability on. `run_worker_first` lists
  the only paths `worker.js` runs for (`/collab/*`, `/nota/chat`);
  everything else is the assets alone, a stray URL included
  (`not_found_handling` serves the `404.html` `sync.mjs` writes), so bot
  scans and mistyped links never count as Worker requests.
- `worker.js` — what assets cannot serve: the `/nota/chat` forward (refused
  when a browser on another origin calls it; non-browser clients remain
  subject to the public budget and rate limits) and `/collab/<note id>` handed to the note's room. The `/` rule stays as a fallback for a deployment made
  without `_redirects`.
- `room.js` — `NoteRoom`, the Durable Object behind a shared note. It
  speaks the y-websocket protocol with a batched browser provider,
  relays every update to the others on the note, and keeps the merged Yjs
  document in its SQLite storage (a snapshot in 512 KiB pieces plus the
  merged delta rows since, compacted every 200 rows). Small updates reuse
  a delta row up to 64 KiB, reducing compaction reads and deletes. Updates
  are relayed at once but written in 5 s windows, one row write per window
  (and on any socket closing); see below for why that is safe. Websockets
  use the hibernation API; the server disables the Yjs awareness interval
  so idle rooms are eligible for hibernation, and the page's keepalive is
  a text `ping` answered by the runtime's auto-response, which neither
  wakes the room nor counts as a request. Presence is restored from
  bounded socket attachments, without reading the note or writing SQLite
  on each cursor update, and is stale after 15 minutes without news. A
  frame that is not protocol bytes closes that socket alone (1003) rather
  than throwing, since an uncaught exception resets the object and would
  drop the write window merged in memory.
  `migrations` in `wrangler.jsonc` makes it a SQLite-backed
  class, which the free plan requires.
- `sync.mjs` — copies the current app into `public/` (the stroke reader,
  the text reader and the ONNX runtime included; every file fits the 25 MiB
  static asset limit) and writes `public/_headers`:
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` so the
  recognition workers may run multi-threaded, `no-cache` on the shell so
  updates arrive, a year's immutable cache on the content-addressed model
  files. Also `public/_redirects`, one 200 rewrite of `/` to `/notas.html`,
  so opening the notebook is served by the assets and never runs
  `worker.js`, and `public/404.html` for every other unknown path. Refuses
  any file over the 25 MiB static asset limit.

## What the free plan is spent on

Static assets are free and unlimited; `worker.js` runs only for the nota
forward and the room. What counts is the room, per day:
100,000 SQLite rows written, 100,000 requests (an incoming websocket
message is a twentieth of one), 13,000 GB-s of duration (128 MB while the
room is awake, so about 29 room-hours). Over any of them, that operation
fails until 00:00 UTC. In order of which runs out first:

- **Rows written.** The page flushes edits every 500 ms, so two people
  editing were four row writes a second, about seven pair-hours a day.
  `room.js` now merges received updates into the tail row in memory and
  writes it when a 5 s window closes, when a new tail row starts, or when
  a socket closes: one write per window. It is safe because every page
  keeps the document in IndexedDB and the Yjs handshake on the next
  connection re-sends whatever the room lacks; a room evicted inside a
  window loses nothing the editor does not still have. A pending window
  keeps the room awake up to 5 s longer, which is far cheaper.
- **Requests.** The pointer was sent every 60 ms while it moved. Now
  nothing about the pointer, selection or focus goes out while nobody
  else is on the note (the common case: shared, waiting), the first
  arrival is told everything at once, and a bare cursor goes every 120 ms
  while a stroke or drag being made keeps 60 ms.
- **Duration and idle tabs.** y-protocols re-sent presence every 15 s and
  y-websocket dropped a connection silent for 30 s, so an idle tab woke
  the room four times a minute. `../collab-provider.mjs` clears both
  intervals: it sends a text `ping` every 20 s, which the runtime's
  auto-response answers as `pong` without waking the room or counting as
  a request, and closes a link silent for 75 s (a hidden tab's timers run
  once a minute). Presence is re-sent every 5 minutes, never from a hidden
  tab, and again when the tab is shown; the room treats presence as stale
  after 15 minutes. An idle tab now costs nothing.
- **Reconnect storms.** y-websocket's reconnect backoff capped at 2.5 s,
  and every reconnect reads the whole note and sends it. The cap is 30 s.
- **`/`.** Served by `_redirects` instead of the Worker.
- **Unknown paths.** `run_worker_first` + `not_found_handling` in
  `wrangler.jsonc` answer them from the assets; before, every scan of
  `/wp-login.php` or `/.env` ran `worker.js` for a 404.

The page batches outgoing document updates over 500 ms (or 128 KiB) and
flushes when disconnecting, hiding the page, or leaving it; local Yjs
changes and IndexedDB persistence stay immediate.

Clearing y-protocols' interval on the page also removed its 30 s purge of
peers gone silent, so `../collab-provider.mjs` runs its own: a peer
unheard from for six minutes (presence is refreshed every five) is let go
locally, at no cost to the room.

The page's copy about a link that is down says why (`../collab.js`):
offline, or the room out of reach (down, or over its day's allowance),
rather than blaming the host. A guest whose note ends, or who leaves it,
is offered a copy of it as a note of their own before it leaves the
device. The host's share sheet has a second link carrying their token,
for their own other devices, so they are the host there too. "Hey nota"
on a shared note whose room is not up waits and says so, rather than
reporting that someone else is asking.

The provider uses y-websocket's `_updateHandler`, `_checkInterval` and
`WebSocketPolyfill`, and y-protocols' `_checkInterval` on both sides;
rerun the tests when upgrading either library. From the project root:

```sh
npm run test:collab-usage       # Node 22.13+: SQLite, write windows, presence, keepalive
npm run build:collab           # regenerate assets/collab.js after adapter edits
npm run test:collab            # real browsers against local Wrangler
```

The project root also supports `npm run deploy`; it forwards to this directory.
Both folders target the same Worker and domain, so deploy the intended source once.
Deployment syncs automatically, stamps the recognition contract, and verifies all
slide-model chunks before uploading. For a local preview, run `npm run sync`
in this directory. The service-worker
cache version is bumped with browser changes so existing users get the new
bundle. The server can read existing snapshots and update logs without a
storage migration. Use a Wrangler dry run to validate the deployment bundle;
production duration/CPU savings must be verified in Cloudflare metrics.

## First deployment

```sh
cd cloudflare-deploy
npm install
npx wrangler login                                   # once, opens the browser
```

```sh
npx wrangler secret put CEREBRAS_API_KEY             # prompts for the key
npm run deploy                                       # sync + wrangler deploy
```

The URL is `https://notas.<account-subdomain>.workers.dev`, plus the custom
domain in `routes` once its zone is on the account. Every later
change to the app is `npm run deploy` again; unchanged files, the models
included, are not uploaded twice.

## The nota key

The key never sits in the page. `wrangler secret put CEREBRAS_API_KEY`
stores it on the Worker; `worker.js` adds it to each forwarded call.
Without the secret the forward answers 501, and the page falls back to
calling Cerebras directly with a key from `localStorage`
(`notas.nota.key`), or tells the user it needs one.

The dev server (`npm start` in the project root) reads the same variable,
so `CEREBRAS_API_KEY=… npm start` behaves exactly like the deployment.

## Local run

```sh
npm run sync
npm run dev             # http://localhost:8787
```

For the forward locally, put `CEREBRAS_API_KEY=…` in `.dev.vars` (ignored
by git).

## The models are plain assets

Static assets are limited to 25 MiB per file. The stroke reader is two
files of 11 and 7 MB, the text reader 20 MB and the ONNX runtime 12 MB, so
all of them are served by the assets with a year's immutable caching and
`worker.js` never sees a model request. (The retired 80 MB Smart image
model was the one file over the limit; it used to be split into chunks the
Worker joined on the way out, at a few ms of cpu per download.)

`wrangler dev` does not enforce the free plan's 10 ms cpu limit, so a
change to `worker.js` is only proven by `wrangler tail --format json`
against the deployed Worker, reading `cpuTime` and `outcome`.

## Edge-case hardening deployment notes

Ship the browser bundle (including `assets/collab.js`), Worker, and room implementation together. Initial sync now uses bounded binary fragments for large messages; invitation generations retire old links after sharing stops. Re-sharing produces a new generation. Host links put the secret in a URL fragment; the client authenticates its socket through a WebSocket subprotocol.

`NOTA_DAILY_REQUESTS` and `NOTA_DAILY_TOKENS` in `wrangler.jsonc` default to 1,000 requests and 2,000,000 budget units per UTC day. The shared budget reserves message UTF-8 bytes plus overhead and maximum output tokens before calling upstream; it is a conservative allowance, not measured provider billing. Per-address throttles also apply. Origin checks do not authenticate non-browser clients; the endpoint remains public.

`sync.mjs` writes a hashed script CSP and additional response headers. Regenerate assets after changing inline scripts. The service worker no longer forces takeover of active tabs; close existing app tabs to allow the new worker to activate. The previous cache and older immutable payloads are retained to support existing clients.

Trash is retained until explicitly deleted. Local recovery and collaboration safety copies consume browser storage and remain subject to its quota. Rotate any provider credentials previously exposed in logs/transcripts before deploying with them.
