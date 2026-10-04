# Math OCR quality

## October 4: stroke model v14 (writing order, notebook capture, notebook arithmetic)

The stroke reader was retrained (`recognition-v14`): Hand-to-TeX `base-aug` weights fine-tuned for four epochs on MathWriting train + 30% of its synthetic split + symbols + 157k composed notebook expressions (single-digit sums such as `1+1`, repeated terms, decimals, commas, brackets, powers, stacked fractions, `y=x`-style assignments, a full-height `+`). Every training sample may also be drawn in another writing order (a `+` bar-first or upright-first, straight strokes reversed, a stroke added after the next symbol) and passed through the notebook's own point capture (`pushPoint`: 1.2 px distance filter, 0.62 smoothing, 0.1 px rounding), because that, not raw device points, is what the app sends the model. Training code: `experiments/hand-to-tex/notas_train/v14/`.

Composed arithmetic uses only glyphs from HWRT writers in the hashed writer split; HWRT's own train/test split shares 93 of its 101 test writers with train, so the earlier `arith_valid` 88% was not writer-disjoint. The checkpoint was chosen on selection data only (MathWriting valid, composed arithmetic from separate writers); the sets below were scored once, after freezing. None was trained on; CROHME was never used by any notas model. CROHME has no timestamps (rebuilt at 10 ms per point) and is scored after the notebook point capture. Exact match, project `normalize_latex`, greedy primary reading.

| Held-out set | v13 | v14 | v13 arithmetic | v14 arithmetic |
| --- | ---: | ---: | ---: | ---: |
| Composed notebook arithmetic, 2,415, unseen writers | 82.7% | **95.7%** | 85.7% | **96.0%** |
| MathWriting test, 7,644 | 59.3% | **61.8%** | 69.0% (n=84) | **72.6%** |
| CROHME 2014 test, 986 | 55.6% | **57.9%** | 78.3% (n=46) | **80.4%** |
| CROHME 2012 test, 488 | 45.9% | **48.8%** | 39.1% (n=46) | **47.8%** |
| CROHME 2011 test, 348 | 55.2% | **58.0%** | 66.7% (n=15) | 66.7% |

Per-symbol accuracy (1 - token edit distance / label tokens), the target agreed for this work (90% on data the model never saw). Scored on the same saved predictions with LaTeX-equivalent spelling (`experiments/hand-to-tex/notas_train/v14/canonical.py`): an unbraced command argument is the next single token, as LaTeX reads it, so CROHME's `\frac12` equals the decoder's `\frac{1}{2}`; applied identically to label and prediction. The strict project scorer counted those as errors (CROHME 2012 symbol accuracy 86.7% strict).

| Held-out set | v13 symbol | v14 symbol | v14 expression (equivalent spelling) |
| --- | ---: | ---: | ---: |
| Composed notebook arithmetic, unseen writers | 96.2% | **99.3%** | 95.7% |
| MathWriting test | 93.3% | **93.7%** | 61.8% |
| CROHME 2014 test | 88.0% | **90.6%** | 58.8% |
| CROHME 2012 test | 92.4% | **94.3%** | 64.1% |
| CROHME 2011 test | 90.3% | **92.9%** | 58.9% |

v14 reads at least 90% of symbols correctly on every held-out set; v13 did not on CROHME 2014. CROHME 2014 clears it narrowly. The scorer change was made after the test scoring (the CROHME 2012 error analysis found the brace spelling); no model was changed after that point.

v14 is better on every set. Per whole expression it reaches 90% only on composed notebook arithmetic; real people's expressions stay far below, as for every published recognizer (the best reported CROHME 2014 expression rates are about 60%, from models trained on CROHME). Remaining real-data errors: long nested arithmetic where one digit fails the whole expression, `1`/`4`/`l` confusions, a decimal point read as a comma, and case ambiguity (`c`/`C`, `x`/`X`) that the ink itself does not settle. The reported `1+1` read as `1-11` was not reproduced on held-out writers by either model (`probe_order.py`: 987/1000 v13, 994/1000 v14 across five ways of drawing the plus); the user's own ink is needed for that case.

## October 3: square roots and dense pages kept whole

Two grouping regressions from the September edge-case pass, found when `tests/ink-routing-browser.mjs` and `tests/checklist-fixes.mjs` failed (the latter was not in `test:browser`; it now is).

- Box detection treated a handwritten radical as a box corner (a steep rise and a long top bar), so the `\sqrt` stroke was removed from the maths and `\sqrt{1-\omega^{2}r_{0}^{2}}` read as `1-\omega^{2}r_{0}`. A stroke that starts above its lowest point, dips to a tick, rises on the left and ends at the right of a top bar, with writing under it, is no longer a corner. A `┌` corner of the same size still is.
- Grouping more than 240 strokes split them along the longer axis, measuring the gap only between neighbours. A band of lines is wider than tall, so it was cut down the middle and each line read as two halves: a synthetic 60-line page gave 109 groups instead of 60. The split now takes the widest clear gap on either axis.

## October 3: uncertain variable equation recovery

A supplied five-stroke `y=x` example was decoded as `41=x` (likelihood 0.7736), with `y=x` already among the completed alternatives. Independent text OCR read `Y=X`. For uncertain short number-equals-variable readings only, an independent text reading can now select a unique existing letter-equals-variable candidate with the same right-hand variable. The original reading is retained, confidence is not increased, and explicit Solve is still required. Confident readings, missing/ambiguous candidates, changed right-hand variables, and weak text evidence abstain.

`node tests/handwritten-variable.mjs` replays the supplied strokes through both production readers. This is a user-reported regression fixture, not an independent accuracy benchmark. The unit tests also cover abstention and preserve uncertainty.


The current changes improve the recognition pipeline; they do not replace or retrain the shipped neural-network weights. Apple Notes parity has not been established.

## Operator bridging for short arithmetic (2026-09-17)

A reported quirk, short products such as `12 × 8` reading badly while longer expressions worked, traced to grouping rather than the model. A pen pause longer than 3 s beside the operator, or space of about 1.25 row heights around it, split the expression into "12" and "× 8" (or three pieces), and each fragment was read alone. Longer expressions are usually written in one fluent burst and did not hit this. Grouping now runs one more coalescing phase after the structural rules converge: a same-row neighbor within 1.6 row heights joins when a binary operator shape sits at the facing edge (cross, plus or asterisk with chords crossing in their middle halves, a cursive or two-arc letter x, a lone mid-row minus bar, or an equals pair), regardless of pen timing. Digits such as 4 and 7, fraction rules and underlines do not qualify.

On composed HWRT glyph ink with a 3.5 s pause, kept-together rates rose from 0/60 to 53–60/60 per operator and spacing, and end-to-end exact readings from 0/20 to 16–18/20 for ×, *, +, −. On the previously inspected 360-expression MathWriting cohort, isolated segmentation rose from 237 to 241 and exact from 121 to 123 with no losses. The stroke model itself still reads isolated `A op B` correctly only about half the time (the Smart image fallback recovers most), `\cdot` is read as a decimal point, and `÷` fails in both models. See [experiments/simple-arithmetic/README.md](experiments/simple-arithmetic/README.md); the composed ink is diagnostic, not independent accuracy evidence.

## Equals sign restored from stacked bars (2026-09-17)

The stroke decoder sometimes reads a handwritten `=` as `-` (`p-3` with `p=3` only offered as an alternative) or as `--`, especially when the two bars differ in length or slant. The ink can count equals signs independently: two horizontal strokes of comparable span, strongly overlapping in x, one just above the other within about half a row height, with no other ink between them, each used at most once. When the reading has fewer relation signs than the ink has such pairs and a minus or double minus stands where one belongs, that operator becomes `=`; with several candidate minuses the model's own completed alternatives must single out one, or nothing changes. Nothing else in the reading is touched, and the repaired reading always asks for confirmation before solving. On the 360-expression MathWriting cohort this changed one reading (`(2)p-p` to `(2)p=p` for a `\equiv`) and nothing else. Unit tests cover the screenshot case, double minus, existing relations, ambiguity, single bars, distant bars and fraction rules.

## Structural grouping and acceptance repair (2026-09-15)

The latest repair joins close right-hand scripts, spaced equations at equals signs, and detached overbars. Automatic calculation also requires minimum token likelihood and a check for nearby ungrouped ink. On 300 fresh expressions, full-pipeline exact matches rose from **117 to 121**, with four gains and zero losses (paired exact p=0.125). Correct grouping rose from **223 to 237**. Incorrect automatically eligible readings fell from **33 to 4**, while eligibility coverage fell from **86 to 34**. These are separate transcription and acceptance outcomes; the change does not establish high accuracy. Crowded exact matches stayed **23/60**. See [the complete report](experiments/ocr-supply-chain-repair/REPORT.md) for provenance, confidence intervals, limitations, and rejected decoder trials.

## Automatic sampling-consensus correction (2026-09-13)

The stroke recognizer now evaluates the original pen points and, when useful, versions at 80% and 120% sampling density. Resampling preserves stroke endpoints, order and interpolated timing; it never modifies stored ink. Two completed resampled readings must agree before overriding the original, and the change must be exactly one Latin/Greek variable-like token. Numbers, operators, constants such as pi, function spellings, scripts and other layout tokens are protected. Every supporting reading must meet the existing 0.70 ink-confidence floor. The original reading remains available as an alternative.

Low-confidence or incomplete primary readings still go directly to the existing image-model fallback. Selections over 10,000 points skip the optional views. If the first resampled reading agrees with the original or proposes an ineligible change, the second is skipped. Optional inference failure preserves the primary reading.

| Browser worker regression set | Before automatic exact | After automatic exact | Gained / lost | Observed median before / after |
| --- | ---: | ---: | ---: | ---: |
| MathWriting excerpt validation, 100 | 61 | 63 | 2 / 0 | 144 / 214 ms |
| MathWriting excerpt test, 100 | 44 | 46 | 2 / 0 | 184 / 264 ms |

These compare the previous beam-alternatives release with sampling consensus, using the same original point-time inputs and strict normalized formula scoring. They are small development/regression cohorts: both were inspected during policy development, so neither establishes an untouched final accuracy estimate. Desktop latency is illustrative, not a tablet certification. After-change p95 was 547 ms on validation and 472 ms on test. The browser notebook routing test also verifies the repaired `r`/`mu` and `b`/`p` examples through actual stroke grouping, not just direct worker inference.

Unrestricted highest-confidence view selection scored 64/100 on validation but only 44/100 on test, with regressions. Unrestricted majority agreement could change numbers or remove a minus sign. These policies were rejected in favor of the restricted symbol correction. A directly dequantized ONNX graph, preserving the shipped operations while removing dynamic activation quantization, scored 61/100 on validation (two gains, two losses) and increased model payload from 18.5 MB to 52.6 MB. It was not shipped. The earlier reconstructed float reference produced invalid predictions and was excluded as an export failure, not scored as evidence about full-precision model quality. No weights or additional model downloads changed in production.

Raw final reports are `experiments/ink-sampling-consensus/ink-valid-consensus-final.json` and `ink-test-consensus-final.json`; the previous paired reports remain under `experiments/ink-beam-decoder/`. Reproduce with `node scripts/benchmark-ink-decoder.mjs` (`SPLIT=test` for the second set) and compare using `scripts/compare-ink-decoders.py`. The harness can also test fixed `VIEWS` or explicit model-file overrides and records the actual files' hashes. Production model versions and offline cache were refreshed; the release gate now checks all stroke-model dependencies.

The service-worker upgrade now carries forward the exact current, content-addressed ink model files as well as Smart files, preventing an update from discarding a previously downloaded stroke model. An offline cache migration test rejects superseded model versions. All 39 JavaScript tests, the browser routing/geometry checks, and all eight notebook regression fixtures passed for this update.

## Initial beam-search comparison (2026-09-13)

The production stroke decoder now retains three candidate paths with shared decoder caches, excludes non-output special tokens and invalid brace closures, and supplies up to two completed alternatives for correction. The original greedy primary path remains in the search even if another candidate scores higher. Decoder tensors are released on success and failure. Model contract hashes now include the active stroke decoder, features, vocabulary and weights; notebook benchmark provenance includes them too.

On the first 100 sorted MathWriting excerpt validation expressions with original point timing, primary normalized exact matches stayed **61/100**, with no gained or lost exact matches. Nine additional expressions had the correct reading among the alternatives: **70/100 primary-or-alternative coverage**. That is a candidate coverage measure requiring user selection, not 70% automatic accuracy. Median single-threaded Edge worker time increased from 78 ms to 144 ms; p95 increased from 139 ms to 274 ms. This is a desktop measurement, not a tablet certification.

Automatically choosing the best beam score was rejected: widths three and five both scored only 60/100, versus the baseline's 61/100. These validation examples were used for development. Existing experiments did not establish a better replacement checkpoint; no neural-network weights were changed in this update. Fully on-device recognition remains the product constraint.

After freezing the decoder, the separate 100-expression test excerpt retained **44/100** primary exact matches with no gained or lost matches, and recovered eleven additional correct alternatives (**55/100 candidate coverage**). Median worker time was 96 ms before and 184 ms after; p95 was 152 ms before and 335 ms after. This test excerpt had been used by earlier project experiments, so it is a separate regression check, not a newly untouched final holdout. All eight current notebook fixtures (seven stroke cases plus the image case) passed; the 32 JavaScript tests, 11 Python evaluator tests and production browser routing checks passed.

The baseline worker and four paired reports are preserved under `experiments/ink-beam-decoder/`. Candidate coverage does not include the image fallback, name reconciliation or UI conversion; the production routing test separately verifies that completed alternatives reach the notebook. No Apple Notes comparison was performed.

Reproduce with `node scripts/benchmark-ink-decoder.mjs` and compare two reports using `python -B scripts/compare-ink-decoders.py BEFORE.json AFTER.json`. The browser harness supports `SPLIT=valid|test`, `OUT`, and `WORKER_SOURCE` for an exact baseline worker, and records source/model/input hashes. These are isolated expression measurements, not end-to-end notebook or Apple Notes comparisons.

## Reproduced failures and changes

The supplied `Pens = 3` screenshot, cropped to the ink, historically produced `8875--3` from the retired Fast experiment, `R e n S = 3` from Smart, and `Pens-3` from the text recognizer. The production combined reading is now `Pens = 3`. This is a local user regression fixture; it is not independent test evidence.

Authored vector regressions cover `61+1=`, `hi=4`, and `hi*4`, both isolated and surrounded by nearby lines and distant large writing. Smart initially read baseline `hi` as a subscript and as `h : X`; the text model preserved the name. A conservative image projection checks letter baselines and operator shape before resolving these layout disagreements. Tests separately require true raised/lowered letters, powers, fractions, numerical disagreements, function names, and low-confidence evidence to remain protected. This does not cover every handwriting style or overlapping layout.

Grouping no longer depends on a whole-page size statistic. Smart is no longer gated solely by a limited alphabet model's belief that an expression is math. Named assignments reach the calculator without being rejected as prose. Corrections remain editable, and existing confirmed corrections survive model-version invalidation. Cached stroke hashes are cleared when notes reset.

The broader real-formula check also exposed a historical handoff bug: successful Smart readings were sometimes discarded by a calculator/prose check and replaced by the old Fast path. Production no longer has that second math engine. A Smart transcription is judged by decode completion rather than whether the calculator understands the notation, so unsupported math can remain correctly transcribed even when no answer is available.

Smart now runs more often, and a word check adds text inference. Accuracy has a latency and battery cost; measure both on the intended tablet. All inference remains local.

## Run and interpret the benchmark

```powershell
npm test
npm run test:ocr-eval
node tests/math-notes-browser.mjs
$env:REPEATS='3'
npm run benchmark:notes
python -B scripts/ocr_eval.py test-results/math-notes.json --out test-results/math-notes-metrics.json
```

The seven development cases passed all three runs during implementation. This is seven unique fixtures, with isolated/crowded pairs sharing the same authored ink, not 21 independent writers or evidence of 100% general accuracy. Generated reports include hashes of the corpus, inputs, models, runtimes, and recognition code. Re-run after changing any dependency.

A broader development run through image recognition used the existing 90-example CROHME test corpus. Fixing the erroneous Smart-to-Fast handoff increased exact formula matches from 34/90 to 38/90 (42.2%). This exposed a pipeline defect but also confirms that the underlying model remains weak on general formulas. That corpus was used to diagnose the handoff and must not be presented as an untouched final pipeline test. No Apple Notes comparison was performed.

The primary outcome is the entire transcription plus exact target stroke membership. Incorrect digits, invented functions, merged neighboring ink, missing strokes, exceptions, and truncated outputs fail. An equal numerical answer does not rescue a wrong transcription. ASCII `hi` and `h i` differ; formal LaTeX uses only token spacing and single-atom script-brace normalization. Formal formula labels are never passed through the calculator's lossy LaTeX-to-ASCII conversion for scoring.

The evaluator reports each category, the worst category, crowding-induced regressions on paired ink, inference/segmentation failures, and repeat stability. A Wilson interval uses unique sample IDs, not repeated attempts. It assumes independent samples; shared writers and paired transformations further limit what that interval establishes. Symbol accuracy and coarse structural signatures are diagnostic metrics, not the headline.

## Independent note corpus

Use a JSON corpus with `heldOut` and `samples`. A sample contains a unique `id`, a `base_id` shared only with its controlled layout variants, `kind`, `categories`, `source`, and either:

- `expected` ASCII, `strokes` in the notebook's native `{id, author, w, t0, pts, bbox}` format, and the exact `targetIds` to score. Strokes must include the surrounding note, not just a preselected equation.
- `image` relative to the corpus file, optional `[x,y,width,height]` `crop`, and either `expected` ASCII or `latex` for strict formal notation. Cropped image cases measure transcription, not page segmentation.

Preserve writer/source identifiers and source hashes. Split by writer and source note before augmentation, keep related isolated/crowded variants together, and reserve an untouched final test set. Record collection method and verify labels by human review. Never use test labels for routing, name dictionaries, threshold selection, or crop selection beyond the task's fixed ground-truth crop protocol. Developing on reported failures makes them development data.

Include arithmetic (especially 6/0, 1/l/vertical bars, decimal points, negatives, equals), short and long variable names, real trig functions, subscripts/powers, fractions/roots, close lines, multiple columns, diagrams, slanted/touching ink, erased/replaced strokes, empty/prose/doodle negatives, and named definitions followed by uses. Report device latency, fallback frequency, and manual correction rate separately. A clean formula corpus alone cannot establish crowded-note performance.

```powershell
$env:CORPUS='path/to/heldout-notes.json'
$env:OUT='test-results/math-notes-heldout.json'
node scripts/benchmark-math-notes.mjs
npm run quality:99
```

The quality gate requires independent, fresh end-to-end evidence, including at least 30 unique examples in each required scenario (`isolated`, `crowded`, `named_variable`, `arithmetic`, `superscript`, `fraction`, `negative`) and the target score in every scenario. Thirty examples is a coverage minimum, not sufficient statistical proof of 99% accuracy. Development fixtures cannot pass this gate; missing evidence fails explicitly. Existing isolated-symbol and expression checks remain separate.

## Research used

- [Google ML Kit digital ink documentation](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android) describes the importance of writing area, preceding context, and stroke order. This supports evaluating ink layout and note context, rather than assuming a cropped-image score transfers to a notebook. ML Kit is a native-platform API, not a drop-in browser model used here.
- [Google's MathWriting dataset documentation](https://github.com/google-research/google-research/blob/master/mathwriting/archive_readme.md) describes prompted single-expression handwriting collection. It is useful for expression recognition; crowded pages and ordinary named quantities need additional evaluation.
- [Apple's Math Notes education example](https://education.apple.com/resource/250014203) demonstrates defining and reusing variables. [Apple's published handwriting research](https://machinelearning.apple.com/research/handwriting) discusses a different, older character-recognition system. Neither provides the current Math Notes model weights or a comparable accuracy benchmark. These changes do not claim to reproduce Apple's implementation.
