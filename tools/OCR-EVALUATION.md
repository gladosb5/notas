# Collect a small Notas evaluation set

Open `tools/ocr-labeler.html` from the local Notas server (`npm start`), or open
the HTML file directly in a modern browser. It has no external dependencies.

1. Write naturally in Notas, preferably on the Honor device you want to support.
2. Export a note through **export note · json**.
3. Open that file in the labeling page. Use a consistent anonymous writer ID
   and a session ID. Select the strokes of one complete expression by tapping
   ink; selected strokes are blue. Short notes are easier to select precisely.
4. Enter the correct LaTeX yourself, exactly matching the selected handwriting.
   Include every selected symbol. Do not copy the recognizer's guess or replace
   the expression with its solved result. Leave genuinely unreadable examples
   unlabeled rather than guessing.
5. Add examples and download the JSONL collection. The page keeps work in memory
   only; resume later by opening the downloaded collection. No notes are uploaded.

Start with **30–50 expressions** from actual use over several writing sessions.
Include both successes and failures: arithmetic, fractions, powers/roots,
variables, and whatever advanced structures you actually write. Do not select
only difficult failures or rewrite the same expression until the model succeeds.
This initial collection is a personal development set, not a population-wide
accuracy estimate. Additional writers are needed for writer-generalization claims.

The tool preserves coordinates, pressure, stroke order and recorded timing.
Missing timing remains missing; it is never invented. AI-generated strokes,
typed text and note images are excluded. Only selected ink and explicit labels
are exported; full note contents and titles are not copied into the collection.

## Validate and record the collection

```powershell
python3.11 scripts/audit-notas-evaluation.py PATH/TO/notas-ocr-evaluation.jsonl --manifest PATH/TO/evaluation-manifest.json
```

The manifest records the collection hash and counts. It is created exclusively
and will not overwrite an earlier manifest. The audit rejects duplicate IDs,
translated/scaled duplicate ink, malformed strokes and invalid timing.
Missing timing is reported without rejecting older notes.

When separate training captures exist, also pass `--training TRAINING.jsonl`.
Comparison rows must carry writer/session/source provenance and strokes. The
audit rejects shared writers, source notes, IDs or identical normalized ink.
It cannot prove absence of near-duplicates or undisclosed pretrained-data overlap.

**All collected rows are `evaluation_only`. Do not feed them into training.**
Training needs a separately collected pool. A future final test should use fresh
writers or sessions, have labels withheld during model selection, and be evaluated
only after the candidate/configuration is fixed. A hash manifest does not turn
an already inspected development set into a hidden test.

There are no real labeled examples in this repository yet. The browser regression
uses a synthetic fixture only and does not add it to the evaluation collection.
