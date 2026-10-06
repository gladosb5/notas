# Optional Cloudflare backend

This deployment serves the notebook and collaboration backend from your own Cloudflare account. Local notes and recognition do not require it. AI is separately optional.

## Set up

1. Install the root dependencies with `npm ci`.
2. From the project root, install the backend dependencies:

   ```sh
   npm --prefix deploy/cloudflare ci
   ```

3. Edit `deploy/cloudflare/wrangler.jsonc` and choose your Worker `name` (default: `notas-selfhosted`). No production account ID or custom domain is configured.
4. Log into your own account and deploy:

   ```sh
   cd deploy/cloudflare
   npx wrangler login
   npm run deploy
   ```

Wrangler prints your `https://<worker-name>.<account-subdomain>.workers.dev` URL. Open it and use **share** to invite another browser. The notebook and `/collab/*` endpoints share that origin, so there is no frontend URL to configure. Both participants must use the same deployment.

You can add your own custom domain in Cloudflare. Keep the address stable after sharing links. Cloudflare service usage belongs to your account and plan.

## Test locally

After installing both sets of dependencies, from `deploy/cloudflare` run:

```sh
npm run sync
npm run dev
```

Open the localhost URL printed by Wrangler. This runs the actual Worker and Durable Objects locally. Root `npm start` serves the notebook and optional AI proxy only; it does not run collaboration.

From the project root, the collaboration integration test starts its own local Worker:

```sh
npx playwright install chromium
npm run test:collab
```

## Optional AI

Collaboration works without a provider key. To enable hosted Nota answers, run this from `deploy/cloudflare`:

```sh
npx wrangler secret put CEREBRAS_API_KEY
```

For local Wrangler development, create an ignored `.dev.vars` file in this directory with `CEREBRAS_API_KEY=your-own-key`.

See [AI setup](../../docs/ai.md). Never commit a real key. The AI endpoint is public on your deployment; per-address limits and a daily budget bound its use. Origin checks are not user authentication. Adjust `NOTA_DAILY_REQUESTS` and `NOTA_DAILY_TOKENS` for your budget.

## Files

- `worker.js`: routing, AI proxy, and rate limits.
- `room.js`: Yjs rooms, invitations, and SQLite persistence.
- `wrangler.jsonc`: bindings, migrations, assets, and limits.
- `sync.mjs`: copies app assets into ignored `public/`, checks model integrity, and generates headers.
- `../../server/`: shared request validation and content security policy, also used by the local Node server.

The `ROOMS` binding and `NoteRoom` class name must agree. Preserve existing migrations when updating a deployment with data. Shared note contents are stored in your Cloudflare account. Anyone with a valid invitation can join that note.

## Updates

From the project root, run `npm run deploy` after app or backend changes. It synchronises assets before deploying. Ship the browser collaboration bundle and server together. Close existing app tabs and reopen them to activate a new service worker.

To check packaging without publishing:

```sh
cd deploy/cloudflare
npm run sync
npx wrangler deploy --dry-run
```
