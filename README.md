# Notas

A local-first notebook for handwriting, maths, and working together.

Draw with a pen, type notes, recognise handwriting, and insert calculations on the page. Notes are saved in your browser. Once the app reports **available offline**, the notebook and local recognition work without a connection.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm start
```

Open **http://localhost:4173/notas.html**. Models and browser assets are included in this repository, so the checkout is relatively large. The first launch loads and caches the recognition models; choose **start writing now** to open the notebook while setup finishes.

Keep the same address and browser profile to return to your notes. Export important notes before clearing browser storage. Serve over HTTPS when hosting for other devices; opening the HTML file directly is not supported.

## Features

- Pen and typed notes, pictures, selection, undo/redo, and note import/export.
- Local handwriting recognition, maths calculations, and Quick Maths insertion.
- Offline use after the app and required models have been cached.
- Optional on-device image background removal; its larger model loads when needed.

| Optional feature | Setup |
| --- | --- |
| Live collaboration | Deploy the included [Cloudflare backend](deploy/cloudflare/README.md). |
| “hey nota” AI answers | Configure your own Cerebras key using the [AI setup guide](docs/ai.md). |

Neither is required to use the local notebook. The public source does not provide a shared AI key or use the author's production collaboration server.

## Self-host collaboration

The optional Cloudflare Worker serves the notebook and collaboration backend together on your own domain. Shared notes use Yjs and a Durable Object for each room. The app connects to the backend at its own origin.

Follow **[the deployment guide](deploy/cloudflare/README.md)** for setup, local backend testing, and deployment. Collaboration works without an AI key.

## Development

The text reader checks each handwriting line before background maths recognition. Plain text skips the formula decoder, and uncertain ink stays quiet. Automatic calculation requires independent math evidence and an equals sign supported by actual strokes. Explicit **Solve** remains available for ambiguous ink. Text stays searchable.

Run `npm run test:handwriting` for the routing and browser regressions. Set `NOTAS_IAM_CORPUS` to a local IAM image directory with `labels.json` to test the text gate on genuine handwriting. See [handwriting intent checks](HANDWRITING-INTENT.md) for results and limitations.

```sh
npm test
npx playwright install chromium
npm run test:edges
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for browser tests, the project layout, and asset updates. Model provenance and limitations are documented in [the slide model card](docs/models/slide.md) and the notices under `assets/`.

## License

Original project source is licensed under [MIT](LICENSE). Bundled third-party libraries, fonts, and model weights retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
