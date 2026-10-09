# Handwriting intent checks

Checked locally on 9 October 2026 in `notas` and `notas-oss`.

The formula decoder can turn prose into plausible mathematics, including an
invented equals sign. Its output and confidence cannot establish whether the
original ink was math. The independent text reader now checks the surrounding
line before background formula recognition. Plain text skips that decoder;
uncertain ink and failed background readings produce no math UI. A mixed line
requires separate evidence for each distinct equation. Explicit Solve overrides
the quiet default, and automatic solving requires actual equals strokes.

Search and classification reuse the same text reading. Group hashes invalidate
classification when surrounding ink changes; navigation discards stale pending
reads. Reopened mixed lines route their individual crops again. The recognition
contracts were regenerated and the offline cache advanced to v133.

## Results

| Check | notas | notas-oss |
| --- | --- | --- |
| Complete `npm test` unit suite | 109 passed | 106 passed |
| Intent routing and UI browser regressions | Passed | Passed |
| Existing main browser suite, including offline reopen and search | Passed | Passed |
| Existing Solve-chip suite | Passed | Passed |
| Named-variable / touching-script browser checks | Passed | Passed |
| Genuine English handwriting images classified as math | 0 / 100 | 0 / 100 |

The ten new unit regressions cover plain English, short words, numbered notes,
dates, weak or missing independent evidence, named quantities, fractions,
functions, Greek variables, mixed lines, reopening, shared requests, stale
navigation results, surrounding-line changes, explicit Solve, and equals
geometry. UI regressions inject adversarial formula readings into independently
identified prose and check that no chips, graphs, errors, or variable definitions
appear. They also check explicit failure feedback and stale-output removal.

Production workers were additionally exercised on authored word and arithmetic
stroke fixtures. The word skipped formula decoding and remained searchable;
the equation retained its Solve offer. Existing real-worker arithmetic tests
still read `2+2` and `3+3` and calculate them on explicit request.

## Genuine handwriting sample and limits

The local IAM-line test images are rows 1000–1099, already used in earlier project
evaluations. This is a regression sample, not a new independent population
accuracy estimate. Both repos' current text workers classified all 100 images as
text. The recorded median / p95 text inference times were approximately
264 / 325 ms for notas and 261 / 320 ms for notas-oss, on desktop Edge with both
checks running concurrently. Those timings exclude model setup and formula
decoding and do not predict tablet performance.

IAM here consists of raster images. These results test the text reader and intent
gate, not end-to-end human pen-stroke formula recognition. The injected formula
readings and authored vectors are development regressions. Formula transcription
still has existing errors: the authored `61+1=` fixture was read as `6*1` and
offered for review. This change does not retrain either reader. Ambiguous math
may need selection and explicit Solve.

Detailed local measurements, sample hashes, browser versions, and exact model
contracts are stored in `test-results/handwriting-intent-iam.json` in each repo.
These generated results and the local corpus are excluded from source control.

## Reproduce

Install the project's dependencies and Playwright Chromium, then run:

```sh
npm test
npm run test:handwriting
```

For the optional IAM pass, set `NOTAS_IAM_CORPUS` to an image directory containing
`labels.json` with `file` and `text` fields. Set `PLAYWRIGHT_CHANNEL=msedge` to
repeat the recorded Edge run. Without the corpus setting, the portable unit and
UI regressions still run, but no genuine-handwriting accuracy claim is made.
