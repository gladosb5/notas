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

The text reader checks each handwriting line before background maths recognition. Plain text skips the formula decoder, and uncertain ink stays quiet. Handwritten maths shows the recognised equation and a **Solve** button for review, including expressions ending with an equals sign. It only calculates after **Solve** is pressed, and keeps the equation beside the answer. Text stays searchable.

Run `npm run test:handwriting` for the routing and browser regressions. Set `NOTAS_IAM_CORPUS` to a local IAM image directory with `labels.json` to test the text gate on genuine handwriting. See [handwriting intent checks](HANDWRITING-INTENT.md) for results and limitations.

```sh
npm test
npx playwright install chromium
npm run test:edges
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for browser tests, the project layout, and asset updates. Model provenance and limitations are documented in [the background remover model card](docs/models/background.md) and the notices under `assets/`.

## License

Original project source is licensed under [MIT](LICENSE). Bundled third-party libraries, fonts, and model weights retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).

## PDF notebooks

Choose **open PDF** from the menu, import a PDF from the notes library, or drag a PDF onto the app. Each PDF becomes its own notebook with separate pages. Use the existing pen or tap anywhere on a page with the text tool. Open the page thumbnails to jump between pages; **+** inserts a blank page after the current page, with undo/redo support.

PDF notebooks autosave locally, including the original document and editable annotations. **save PDF** downloads the original pages with your writing, text and images overlaid, plus any blank pages. Original PDF text remains selectable. Export a `.notas.json` note or a library backup to preserve editable annotations when transferring devices. The PDF tools work offline after the app reports **available offline**.

The first version accepts unencrypted PDFs up to 32 MB and 200 pages. Existing printed text is preserved; additions are editable in Notas. PDF notebooks can be sent using PDF or note export; live collaboration is currently available for ordinary notebooks only.

PDF.js 6.4.299 and pdf-lib 1.17.1 are pinned in the development dependencies. Run `npm run assets:pdf` to reproduce the bundled PDF engine, fonts, decoders and license notices, and `npm run test:pdf` for browser and offline regression checks.

## Download as an app

Open **… → download as an app** for instructions, or use the dismissible
recommendation in the notebook. Where the browser supports it, **Download as
an app** opens its installation prompt after you click.

- **Android (Chrome):** tap **⋮ → Install app** or **Add to Home screen**, then
  confirm **Install**. Some versions use **Install and create shortcut → Install**.
- **iPad / iPhone (Safari):** tap **Share** (then **View More** if needed), choose
  **Add to Home Screen**, keep **Open as Web App** enabled if shown, then **Add**.
- **Computer:** use Chrome or Edge’s install control in the address bar/browser
  menu. On a Mac in Safari, use **File → Add to Dock**.

Installation guidance was checked against [Apple’s iPad guide](https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados),
[Google’s Android instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en),
and [Apple’s Mac instructions](https://support.apple.com/104996).

Shared invitations offer an app choice even after the ordinary recommendation
was dismissed. An already-open app can accept the complete invitation (query
and host fragment included) through the service worker, after both notebooks
save successfully. Ordinary visits focus the open app without replacing its note.
The app manifest also supports browser-managed link launches in a new window.
Opening a closed app and automatic link capture depend on the browser and user
settings; the website cannot force either. Safari on iPad/iPhone does not offer
a reliable website-to-app launch API. Use the browser’s **Open in app** option
when available, or copy the invitation and paste it into **… → open a shared
link** inside the app. Invitations are never stored by the installation UI.

Notes remain in their browser/app storage; installation does not migrate notes.
Safari’s Home Screen app may have separate storage, so export/import existing
notes when needed. The ordinary recommendation waits a week after dismissal
and stays hidden inside the app; the menu remains available.

Run `npm run test:app-install` for responsive guidance, installation-event,
dismissal, shared-link validation, and real service-worker handoff coverage.
Standalone display, native install events, and OS focus permission are emulated in those tests;
OS installation and browser/OS link capture require testing on actual devices.
