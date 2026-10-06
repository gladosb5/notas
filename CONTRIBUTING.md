# Contributing

Use Node.js 22.13 or newer. Run `npm ci`, then `npm start`. Runtime assets required for ordinary use are included.

## Project layout

| Path | Purpose |
| --- | --- |
| `notas.html`, root JavaScript | Notebook UI, storage, recognition, collaboration and AI clients |
| `assets/` | Runtime libraries, fonts, model weights, and notices |
| `server/` | Shared request validation and security headers |
| `scripts/` | Local serving, asset preparation, and builds |
| `tests/` | Unit and browser regression tests with fixtures |
| `deploy/cloudflare/` | Optional self-hosted backend |
| `docs/` | Setup and model documentation |

Training datasets, checkpoints, experiment reports, and development logs are outside this app repository's scope.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:edges
```

Browser tests use Playwright's Chromium instead of a machine-specific browser. On Linux, `npx playwright install --with-deps chromium` also installs required system libraries.

`npm run test:browser` runs the broader UI suite. `npm run test:collab` needs `npm --prefix deploy/cloudflare ci` and starts a local Worker without publishing. Image-model tests can require substantial memory and take longer than UI checks.

## Assets

Keep weights, vocabulary, notices, and manifests together. `npm test` checks the recognition contract. After an intentional recognition code or asset change, run `node scripts/model-contract.mjs`, then test again. Do not disable integrity checks to hide mismatches.

`npm run build:collab` rebuilds the browser collaboration library. `npm run assets` downloads pinned UI dependencies; review its changes before committing. The package is marked private to prevent accidental npm publication, not to restrict the source license.

Update the cache version in `sw.js` when changing cached runtime files. Keep `notas.html` as the entry point: offline caching and model contracts refer to it.

## Pull requests

Explain the problem, resulting behavior, and checks run. Keep unrelated experiments and generated output out of the change. Preserve third-party notices. Never include provider keys or personal deployment credentials.

To use an existing browser instead of downloading Chromium, set `PLAYWRIGHT_CHANNEL` to a supported installed channel such as `msedge` or `chrome` before running browser tests. The default remains Playwright Chromium.
