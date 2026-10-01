# Edge-case fixes — 2026-10-01

Continuation of `2026-09-30-210901-in-notas-and-notas-oss-find-edge-cases-all-edg.txt`. Fixes are applied to both repositories; the private app retains its existing LaTeX tutor rendering. Existing unrelated work was preserved. No commit or deployment was made.

## Changes

- **Saving and recovery:** failed index writes and rejected locks can retry; clean saves do no work; peer-tab reloads avoid active pen strokes; conflict copies retain subsequent edits; rename and folder metadata survive index repair. Hidden/page-exit snapshots provide a localStorage rescue copy when space permits. Trash remains until explicitly deleted.
- **Collaboration:** room generations invalidate retired invitations, host credentials use URL fragments and WebSocket subprotocols, and sockets cannot claim an unopened room. Large initial updates are fragmented and reassembled, failed persistence is retried, peer fields and image sizes are validated, text merging preserves surrogate pairs and selections, and destructive remote changes receive a bounded local safety copy.
- **Input:** interrupted gestures finish cleanly; secondary mouse buttons and conflicting touch owners are ignored; IME submissions, undo IDs, mixed clipboard cuts, native text undo, navigation swipes, and modal keyboard handling are corrected.
- **Import/export:** long pages export in readable slices; large JSON backups can be split and imported together; imported creation dates, folders, and image stacking survive. Exports reject unreadable canvas scales.
- **Math and recognition:** nested fractions/radicals, equation routing, degree trigonometry, root boundaries, numeric comparisons, scope-sensitive caches, explicit recognition retries, grouping limits, malformed crops, and slider DOM construction are hardened. Work checking avoids unrelated lines and unconfirmed readings.
- **Tutor:** streamed delimiters and literal currency are distinguished; unsupported Unicode remains editable text with undo/redo; failed questions can retry; idle timeouts refresh on progress; partial replies survive failure; rate-limit cooldowns are brief; speech and note changes clean up stale work. Context documentation now describes the surrounding-row window.
- **Workers and updates:** bounded serial inference queues validate requests; corrupt cached models are rejected; service-worker updates avoid forcibly replacing active tabs and retain the preceding cache; model contracts are refreshed.
- **Server:** hashed CSP, host validation, bounded request fields, per-address limits, and a shared daily proxy budget reduce exposure. Host credentials and generation checks are enforced server-side. Two credentials in a local transcript were redacted.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 63/63 passed in each repo, including model-contract checks |
| `npm run test:edges` | Passed in each repo: save retry, locks, peer reload, metadata repair, rescue, imports, eraser/export, currency/Unicode/undo |
| `node tests/browser.mjs` | Passed in each repo, including real ONNX, offline behavior, worker recovery, clipboard, import/export, self-tests, and no external runtime requests |
| `node tests/collab.mjs` | Passed in each repo; expanded invitation retirement/re-share checks passed in OSS and were copied to the private test |
| `node tests/nota.mjs` | Passed in each repo |
| `node tests/nota-latex.mjs` | Passed in private repo |
| Additional private browser checks | Ink timing, solve chip, noise probe, storage, text index, answer editing, selection, pen solve, frames, mobile text/navigation, library, quick maths, and UX audit passed |

The complete `npm run test:browser` chain is **not green**: `tests/ink-routing-browser.mjs` fails fixture `00fee560e6c9af79-isolated`, missing radical/exponent strokes. A controlled run using the original backed-up recognition and ink-worker sources reproduced the same failure. It remains unresolved; fixture expectations were not weakened.

## Remaining actions and limits

1. Rotate the credentials exposed in the earlier transcript at the provider. Redaction cannot revoke credentials or remove copies outside these files.
2. Resolve the pre-existing recognition fixture failure above. The full browser chain cannot be described as passing until that is fixed.
3. Deploy browser assets, collaboration provider, Worker, and Durable Object changes together. The framing/generation changes require matching components. See `cloudflare-deploy/README.md`.
4. Recovery snapshots remain subject to browser storage quota; huge exports still require enough memory. These safeguards cannot guarantee recovery after every browser/process failure.
5. The public tutor proxy has a bounded shared budget, not user authentication. A caller can still consume the public allowance.

Logs are in `edge-unit-test.log`, `edge-final-test.log`, `edge-main-browser.log`, and `edge-collab-test.log`; the private repo also has `edge-remaining-browser.log` from the additional browser checks.
