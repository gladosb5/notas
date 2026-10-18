# REPORT.md fixes — 2026-10-18

Every actionable finding in the supplied report is addressed below. Changes are local; no deployment was performed. The disputed F82 premise was corrected, and its independently useful send-failure recovery was implemented. F10 was explicitly refuted in the report and requires no behavioral change.

Run `npm test` for the unit suite and `npm run test:audit-report` for the audit regressions, including the instrumented browser checks. Test-only hooks are injected into browser responses and are absent from shipped code.

Final unit verification: **122/122 passing**. The new `test:audit-report` unit and browser regressions pass.

Additional verification covers the core browser workflow (real local OCR and offline reopening), erasing/undo, selection transforms, note-library layouts/search, mobile text, scripted tutor/tool streams, the real two-tab service-worker update lifecycle, and a local Cloudflare Durable Object shared-ink handoff. The private-repository integration also passes the full multi-person collaboration workflow, including shared tutor arbitration, retirement, stale invitations and re-sharing.

The autosave change keeps the existing inline-image storage format compatible: it removes the JSON round trip and copies mutable geometry, while ordinary IndexedDB writes still store a whole note. Backups now avoid holding the whole library or reparsing serialized parts.

| Report item | Implemented change |
| --- | --- |
| F14 | Automatic shared-page questions require locally authored ink; remote replacements revoke that authority. Shared answers cannot use private notebook tools. Ink questions are reserved through the room. |
| F15 | Socket attachments carry their authorized generation. Closed, closing, missing, mismatched and retired attachments cannot mutate the room; closing starts before storage awaits and new generations clear journals and reservations. |
| F17+F75 | Both chat and collaboration POST bodies are counted incrementally in raw bytes and cancelled at their limit. Rate checks run before buffering. |
| F16+F83 | Snapshot the baseline before loading libraries, then merge every local stroke, line, image and metadata delta into the persisted document before restoring page state. |
| F53 | Cache live text groups and a stroke-to-group map by cluster/frame identity; invalidate on grouping rebuilds and note resets. Other-note grouping remains independent. |
| F05+F52 | Recognition request errors leave healthy workers available; crashes/setup failures remain engine failures, and run timeouts permit a fresh worker. Worker stroke/point limits match preprocessing. |
| F67 | Streaming cleanup tracks real line boundaries, waits for balanced emphasis and table rows, and preserves arithmetic operators in mid-line fragments. |
| F68 | Ink question identity uses sorted source stroke IDs rather than normalized question wording. |
| F03+F41 | Interrupted transforms restore original points, pen widths, image geometry/rotation and crop snapshots. Every transform flag, including scaling and twin, is cleared. |
| F54 | Trig wrappers reduce degree angles, return exact standard values and reject poles; radian quadrant values are exact without erasing small real angles. |
| F63 | Cache unsuccessful solver outcomes with the normal source/settings/provider key; compile the numeric fallback once per equation. |
| F55 | Validate CAS roots by substitution and format accepted numeric values. A structural quadratic fallback supplies correct real and complex roots when CAS candidates fail. |
| F56 | Degree trig equations bypass radian CAS solving and report bounded degree solutions with an explicit interval. |
| F57 | Numeric candidates must have a small residual relative to their immediate neighbourhood. Asymptotes and underflow plateaus are rejected. |
| F01+F23 | Both update paths require a successful settled save, with a bounded wait and another dirty-state check at the reload boundary. |
| F80 | Bound inbound messages and document storage to a 24 MiB document budget; socket byte/message buckets reject floods. Check admission before decoding large updates. |
| F79 | Limit awareness messages and socket ownership to four IDs, apply a presence token bucket, and build ownership lookup once per message. The provider sends only its own awareness ID. |
| F81 | Generation comes only from the invitation, host open response or local device storage. Remote document metadata cannot change connection authorization. |
| F78 | Check encoded size before connecting, limit shared image growth, guard every outbound frame and treat 1009 as terminal with a visible size message. |
| F62 | Require bounded perpendicular deviation as well as chord length before describing a graph stroke as a straight line. |
| F59 | Background recognition loops have generations, re-resolve live clusters and check the attempted hash immediately before inference. Explicit retries remain possible. |
| F65 | Clamp crop dimensions after rounding. A rejected crop affects one request and does not destroy the text reader. |
| F60 | Cooldown attempts retain the original failure timestamp and memory block; retries use the remaining delay. Recognized mathematical ink can still use conservative ink evidence. |
| F66 | Background note geometry runs in a worker using the same pure grouping functions as the live page. |
| F22+F74 | Apply the complete equation-sized placement and preserve its required height/width when starting a new row in both builds. |
| F72 | Bound context around the question, budget the complete tool conversation, truncate tool results and give text-budget failures a distinct 413 code. |
| F71 | Invalid tool names/arguments become plain correction messages. Structured history contains only allowed calls, with unique valid IDs and matching results. |
| F21+F70 | Only this device’s strokes contribute to its pen-rest clock; peer strokes cannot postpone local questions. |
| F69 | Only locally authored shared-page ink can launch an automatic question, and stable ink IDs also go through room reservation. |
| F40 | Remote stroke replacement changes the stroke-array identity, invalidating ID lookups and selection caches. |
| F27 | Replace the JSON stringify/parse autosave round trip with a detached snapshot of mutable arrays and objects; immutable image/text strings are reused. |
| F13 | Use rotated image bounds for viewport culling, live drag offsets, document width and export extents. |
| F44 | Index every eraser segment across its crossed grid cells, query by effective stroke radius, reject missed pixel cuts before allocating walks and prefilter typed lines. |
| F61 | Download progress refreshes every waiting background-removal timer and reaches queued matte callbacks. |
| F42 | Commit surviving pen ink before replacement, retain active captured contacts during stale-pointer sweeps, and preserve palm/pinch rejection. |
| F73 | Private typed replies collapse newlines inside complete display-math spans before splitting reply lines. OSS already renders plain notation. |
| F58 | Parse inverse trig, powered trig and log-base arguments before digit whitespace and brace flattening; provide typed arc-trig aliases. |
| F64 | Reject non-finite scalar and complex results before display or assignment, including matrix/unit contents, with an accurate undefined/non-finite diagnostic. |
| F12 | Use relative comparison for nonzero values and expression-scaled roundoff for cancellation against zero, including local work checking. |
| F06 | Export bounds include negative coordinates, ink beyond the current column, rotated pictures and answer/plot extents; page sizing and translation use those bounds. |
| F07 | Export typed lines at their actual horizontal position and editor-equivalent wrapping width. |
| F30 | Reuse the export canvas, check context allocation, release backing stores after encoding and use object URLs for print images. |
| F11 | Capture the image batch destination once and stop the remaining batch when the note changes. |
| F02 | Derive transcript hash capacity from validated stroke IDs/counts and cap transcript entry counts, preserving long confirmed readings. |
| F26 | Cache bounded text/search projections instead of whole notes, with entry and character budgets; clear projections when the library closes. |
| F85 | Retire hosted rooms before permanent deletion, retain credentials on failure, stop providers across tabs, handle blocked DB deletion and remove local sharing keys after success. Confirmation explains that hosted sharing ends. |
| F31 | Read/serialize notes one at a time, emit bounded backup parts directly as serialized strings, count envelope bytes and retain splitting for a single oversized note. |
| F29 | Remove HTML/CSS/release metadata from recognition fingerprints, retain recognition dependencies, and regenerate normalized ASCII from stored LaTeX on load. |
| F24 | On controller changes, immediately block new worker/lazy-script starts until version verification; older pages display a save/reload notice and cannot start another build’s readers. |
| F82 | Correct the unsupported outgoing-frame-limit comment. Actual broadcast send failures close the affected socket with 1011 so it resyncs; no unnecessary upload fragmentation protocol was introduced. |
| F18 | Every tutor coordination request carries the locally authorized generation, which the room checks again after reading the request body. |
| F86 | Validate and journal update/step-2 messages without materializing the document after hibernation. Restore full state only for handshakes/compaction and preserve pending tails. |
| F87 | Transfer presence ownership on authenticated reconnects using a private provider-session token and newer clock, or after the old socket closes. Remove transferred IDs before old-socket cleanup. |
| F19 | Apply both parts of an overlapping deletion around protected remote text, right side first, then insert the replacement. |
| F84 | Validate remote Y.Map/Y.Text types, render malformed text as empty, and repair invalid values during mirroring so the rest of the document continues syncing. |
| F88 | A link cannot replace an existing private note, including links containing host fragments or locally retained host credentials. |
| F04 | Short-circuit wide/wall-contact rules before testing under-writing; restrict remaining queries with a sorted vertical index. |
| F77 | Read complete Unicode code points in math layout and normalize mathematical alphanumerics before glyph lookup. |
| F76 | Build obstacles per answer row, use cached row bounds for characters and refresh when external edits change the page revision. |
| F20 | Require a terminal SSE event or finish reason. Preserve partial output as interrupted, release reservations and leave source questions retryable until completion. |
| F38 | Avoid view keys for unsaved blank pages; delete keys with notes and prune orphaned keys at launch. |
| F33 | Hold a rescue-owner Web Lock for the tab’s lifetime. Recovery skips owners whose locks are held, including frozen live tabs. |
| F32 | Delete missing-record index rows; remove the index before the record and retain repairable storage on failure. |
| F34 | Skip blank unsaved rescues, clear rescues on the blank save path and ignore empty recovery snapshots. |
| F51 | Prune stale ink/text/image selections after history changes and refuse empty selection deletions before creating history. |
| F48 | Use a self-renewing resolution media query to refresh canvas backing stores after DPI-only changes. |
| F43 | Reuse selection membership sets, cache bounds by page/geometry/column revision, and avoid repeated selection-kind and toolbar-size work during pointer moves. |
| F47 | Pen takeover restores twin previews, including width, and clears the twin routing state before accepting pen ink. |
| F46 | Coalesce pinch updates into one animation frame, retain the gesture’s scroller geometry and skip text reflow/extent scans during zoom. |
| F49 | Sample lasso motion at screen-space spacing, draw lasso/eraser paths incrementally, move the eraser ring separately and prefilter lasso hit tests by bounds. |
| F45 | Private-build caret changes repaint/refit only the previous and new focused tutor lines. |
| F08 | Capture export note/revision/title/bounds before awaits and stop before rendering/downloading more output if the source changes. |
| F09 | Preserve signed typed-line x coordinates on import and collaboration. |
| F25 | Drop imported answer caches so calculations are evaluated locally. |
| F50 | Core undo/redo refuses history mutations during active interaction flags; stale pointer records alone never block history. |
| F28 | Diff library rows, update own-save metadata without rereading/rebuilding the full list, preserve ordering/decoded thumbnails and enforce the thumbnail interval while allowing missing thumbnails. |
| F39 | Use local calendar fields for dated backup filenames. |
| F37 | Read folder edits with throwing reads inside a folder lock, merge against current storage and propagate failed writes. |
| F36 | Verify full known asset digests on install, lazy downloads, cache hits and carryover; delete corrupt entries and regenerate offline integrity metadata with the model contract. |
| F35 | Pass update probes through without caching and do not create arbitrary query-key cache entries. |
