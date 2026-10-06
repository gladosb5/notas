# Optional Nota AI

Local notes, recognition, calculations, and collaboration do not require AI. “hey nota” sends the question and nearby page context to Cerebras using your configured key. Context can include an image of nearby handwriting, drawings, and inserted pictures.

This public release uses `qwen-3.8-27b`, configured in `nota.js` and allowed by `server/nota-body.mjs`. A model change must update both. Availability depends on your provider account. Handwritten questions receive pen-stroke replies; typed questions receive editable text replies.

## Local Node server

Set `CEREBRAS_API_KEY` in the terminal environment before starting the server.

PowerShell:

```powershell
$env:CEREBRAS_API_KEY = 'your-own-key'
npm start
```

macOS/Linux:

```sh
CEREBRAS_API_KEY=your-own-key npm start
```

The local server reads the environment; it does not automatically load `.env` files. It forwards requests without putting the key in the page. Without a key, the notebook still runs and Nota explains that configuration is needed.

## Hosted backend

Use the [Cloudflare deployment guide](../deploy/cloudflare/README.md) to add the key as a Worker secret. A real key does not belong in `nota.js`, source control, or a public static bundle.
