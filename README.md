# notas

A local maths notebook with handwriting recognition, editable readings, calculation, and rule-based maths help. Notes are stored in this browser's IndexedDB.

## Run locally

Install Node.js and run:

```sh
npm ci
npm start
```

Open http://localhost:4173/notas.html. First use shows **setting up** while the handwriting model downloads, with the size received so far in MB; **start writing now** opens the notebook early and the download continues on the status line. Later launches skip the wait because the model is already on the device. The app is cached for offline use afterwards. Wait for **available offline.** before disconnecting. Open the same address and browser profile to return to your notes.

For tablets, serve the project as a static website over HTTPS. The development server only listens on this computer. Opening the HTML directly, or using an ordinary HTTP LAN address, does not provide the supported offline setup.

## Deploy to Cloudflare

`cloudflare-deploy/` holds a Worker with only the files the notebook needs: `npm run sync` there copies the current app in, `npm run deploy` publishes it, and the nota key is the Worker secret `CEREBRAS_API_KEY`. Live at https://notas.glados.pro (and https://notas.m-12443042.workers.dev). See `cloudflare-deploy/README.md`.

## Sharing a note

The share button in the top bar (beside undo) makes a link. The first time it asks for your name, kept on this device. Anyone who opens the link is on the same page as you, live: ink, typed lines, images and the title, and the button's count is everyone on the note, named in the share panel's **here now** list. Each person's pen shows as a dot with their name, in their own colour, and so does whatever they are doing: a dashed box around ink or an image they have selected, a band on the line they are typing in with their caret, and the text they have highlighted. Two people typing in the same line both keep their letters. Opening your own link in a second tab of the same browser is fine: a shared note follows the newest revision instead of making a conflict copy. A shared note is still yours: it is saved on your device like any other, works offline, and catches up with the others when you are back. **stop sharing on this device** in the share panel takes your copy out of the room; the others keep theirs.

Under the hood each device holds a Yjs document that mirrors the note (`collab.js`); the site's Worker keeps one room per note (`cloudflare-deploy/room.js`, a Durable Object) that relays updates and stores the merged result for whoever arrives next. The merging library is fetched only when a note is first shared (`assets/collab.js`, built by `npm run build:collab`). Sharing needs the notebook served from its Cloudflare site; on `npm start` the button explains that. `npm run test:collab` drives two browsers through the whole flow against a local copy of the Worker, or `COLLAB_BASE=<url>` against the deployed one.

## Interface

The page is paper and everything else floats above it as glass: the top bar,
the tool pill, the selection bar, the toast and the panels share one recipe
(a translucent fill, a blur behind it, a specular top edge, a hairline and a
shadow tinted to the paper). It is a web approximation of a glass material,
not Apple's; under `prefers-reduced-transparency` every surface is opaque.
Colour still encodes authorship only: graphite is the student, blue the
machine, red the tutor. Interactive chrome is graphite, so nothing turns
system blue by accident.

Tap the wordmark in the top bar to open the list of notes, and tap the note's
name beside it to rename it in place (Enter or a tap elsewhere keeps the new
name, Escape puts the old one back). The menu's **note name** field does the
same.

Typed lines use the bundled IBM Plex Mono. The native caret is hidden and a
single bar glides between characters instead, blinking only once you pause,
and while you type the top bar, tool pill and notices fade back so only the
words are left; moving the mouse, tapping, or leaving the line brings them
back.

A typed expression without an equals sign gets its answer beside it in the
machine's blue. End it with `=` instead and the answer waits after the text
as a blue ghost: the space bar writes it in (Ctrl/⌘ Z takes it out again),
spaced the way the line is spaced, and a line
that already states its correct answer needs nothing beside it. If the stated
answer is wrong, the chip shows what it should be.

A mouse wheel glides rather than jumps, on the page, inside panels and along
the tool tray: each notch adds to a target and the box eases toward it, so a
run of notches feels like a trackpad coasting. Touch, keyboard and scrollbar
scrolling stay native, and reduced motion keeps the native jump.

Typed lines accept LaTeX as well as plain maths: `\frac{1}{2}`, `\sqrt{16}`,
`\sqrt[3]{27}`, `2^{10}`, `\times`, `\cdot`, `\div`, `\pi`, Greek letters as
names, `\sin{30}` or `\sin 30`, `\left( \right)`, `\le`, `\%`, `\text{pens}`,
`$...$` and `\( \)` delimiters, `\int x^2 dx`, `\int_{0}^{2} x^2 dx` and
`\frac{d}{dx} x^2`. Lines are not typeset: what you type stays as you typed
it, and the answer arrives beside it or as the ghost after `=`.

The typed lines sit in one editing host, so selecting is the browser's own:
drag with a mouse, or the handles on a tablet, from any line to any other;
Shift with an arrow key grows the selection across lines; Ctrl/⌘ A takes
every line, the way a document does. A letter, Backspace, Delete or Enter
then replaces the selection, Ctrl/⌘ C copies the lines joined by newlines,
Ctrl/⌘ X cuts them, and one undo brings them back. Backspace at the very
start of a line joins it onto the one above; Delete at the very end draws
the line below up.
Outside a line, Ctrl/⌘ A selects all the ink. Paste a picture while typing
and it joins the text like a document image: under the line you are on (or
in place of an empty one), scaled to the column, with the lines below moved
down and the caret on a fresh line beneath it.

Every label, toast and status line is lowercase and uses full stops and
commas only. Panels are centred cards on a desktop and bottom sheets on a
phone. Motion is one launch moment (the wordmark writes itself in, then the
chrome rises once), a lens that slides between tools, and spring-curved
sheets; all of it collapses under `prefers-reduced-motion`.

## On a tablet

The interface adapts when it detects a touch screen: larger tool and menu targets,
the tool pill centred at the bottom within thumb reach, and panels that scroll
inside themselves with a visible close button rather than relying on a tap outside.

Nothing on the page can be text-selected, so drawing or resting a hand no longer
highlights the ink and the typed lines in blue. The fields you type in still select
and edit normally, and putting the pen down releases the focused line so the
on-screen keyboard drops out of the way.

Gestures:

| Gesture | Action |
| --- | --- |
| One finger or pen drag | Draw with the current tool |
| Drag inside a selection | Move the selected ink |
| Two-finger drag | Pan the page horizontally or vertically |
| Two-finger tap | Undo |
| Three-finger tap | Redo |

Undo and redo also have buttons in the top bar, dimmed when there is nothing to
undo or redo.

A pen wins over everything. When a pen goes down, every other pointer being
tracked at that moment is discarded. Two and three finger gestures are fingers
only — a pen can never make up the count.

**draw with** in settings decides what a single finger does:

| | Finger and pen (default) | Pen only |
| --- | --- | --- |
| One finger | Draws | Pans the page |
| Two fingers | Pans the page | Pans the page |
| Pen | Draws | Draws |
| Hand resting on the screen | May mark the page | Cannot mark the page |

Pen only takes effect only once a pen has actually been used on this device, so
it can never leave you unable to draw.

This is a setting rather than a guess because two heuristics failed here. First,
ignoring touches for 1.5s after any pen event: the same Apple Pencil is **not**
reported consistently — it arrives as `pen` for some strokes and `touch` for
others — so that discarded real strokes, about one line in two. Second,
rejecting large contacts as palms: iOS reports a fingertip far larger than a
palm was assumed to need, so finger drawing stopped working, and because the
rejection happened before the pointer was recorded, two-finger scrolling stopped
with it. No threshold separates a palm from a fingertip on a device that reports
them the same size, so the question is asked instead. While the pen is actually
writing, touch is still ignored in both modes.

The inconsistent labelling still had to be handled for pen-only mode, where a
Pencil stroke filed as `touch` was routed to one-finger scroll and simply never
drew. A finger reports no tilt, an altitude at the vertical default, and a
pressure of either none or exactly the 0.5 default; a stylus carries at least one
of those whatever the browser calls it. A `touch` pointer with real pressure or
tilt is treated as the pen: it draws in pen-only mode, is never counted as a
finger in a gesture, and gets the pen's eraser reach. `?debug=pointers` now shows
pressure and tilt per event so this can be checked on the device.

This matters because a single leftover pointer used to eat strokes silently. If
a `pointerup` is never delivered, that pointer stays tracked forever; the next
pen stroke then looked like a second finger and was thrown away as a scroll,
with nothing on screen to explain it. Stale pointers are now swept, and the
barrel-button shortcut no longer discards the stroke it fires on.

If strokes still go missing, open the page with `?debug=pointers`. A live log
shows what the digitiser reported and what the app did with each event —
including any stroke that was discarded and why.

The eraser has a 9px radius for a pen tip and 14px for a fingertip, and it shows the
band it is about to clear with a ring at the contact point, so you can see what
will go before you lift. It removes whole touched handwriting strokes and
individual typed characters. Undo restores an entire erasing gesture.

Typing `3+3=` automatically inserts `6` into the same editable line. Keep typing
`+1=` to get `3+3=6+1=7`, with no acceptance button or extra Space key. Typing an
operator after a displayed result also continues that result inline. Backspace
edits individual characters without reinserting a deleted answer. Answers are saved with
the note and reused when it reopens; changing the expression, earlier definitions,
or calculation settings invalidates the saved result.

Scribbling over your working does not erase it. That gesture used to delete the
ink underneath, but no heuristic separated a deliberate cross-out from a
carefully drawn `×` or a shaky bar reliably enough, and guessing wrong destroyed
work. Use the eraser, which never guesses.

Select with the lasso, then drag from inside the selection to move it. The
reading and its answer travel with the ink, and one undo puts it back. Dragging
from outside the selection starts a new lasso instead.

The bar above a selection also offers **copy**, **duplicate** and **delete**.
Duplicate puts a copy directly below the original, already selected, so one
drag positions it; nothing asks for clipboard permission. Copy keeps the ink
in this browser and puts a small marker on the system clipboard, so **paste**
in the menu (or Ctrl/⌘ V) can tell whether the ink is still the newest thing
copied: copy words or a screenshot afterwards and paste brings those instead.
Pasted ink lands at the top left of what is on screen, selected and ready to
drag; a repeat paste steps diagonally. On a keyboard, Ctrl/⌘ C, X and D copy,
cut and duplicate a selection.

Open an answer and tap **copy answer** to put the result on the clipboard.

## Images

Paste a picture with Ctrl/⌘ V, drop a file onto the page, or use **Insert
image** in the menu. On a tablet, where there is no Ctrl+V outside a text
field, use **paste** in the menu: it asks the browser for the clipboard and
the browser shows its own paste prompt. Pasting into a typed line still
pastes text if there is any; a screenshot on its own is inserted even then.

A pasted image lands at the top left of what is on screen, and a repeat paste
steps diagonally so it never hides under the previous one. A screenshot with
a band of page background around it is trimmed to its content, with a small
margin left. Images wider or taller than 2000px are shrunk to that cap, and
SVG, BMP, HEIC and similar formats are converted to PNG so an exported note
can always be imported again. Small PNG, JPEG, GIF and WebP files with no
border to trim keep their exact bytes. Tap a picture with any tool to select it: drag a corner handle to resize it
(it keeps its shape), drag its body to move it, and tap anywhere else to let
it go. A drag that starts on an unselected picture draws over it, so a
pasted worksheet can be written on. **manage images** does the same without
dragging. One undo removes
a pasted image.

**remove background** sits beside **delete** on a selected picture, whether
it was tapped or taken with a lasso drawn round it. It keeps the subject and
makes everything else transparent, at the picture's own size, and one undo
brings the original back. It runs on the device with BiRefNet lite
(`studioludens/birefnet-lite-512`, MIT, a 512x512 re-export of
ZhengPeng7/BiRefNet_lite) in `bg-worker.js`. The model is about 94 MB, more
than the site can serve as one file, so the first use downloads it from
Hugging Face at a pinned revision, checks it against its SHA-256 and keeps it
in the model store; after that it works offline. It needs about 2 GB of memory
while it runs, so the worker is let go a minute after the last picture. A
picture takes a few seconds with the threads a cross-origin isolated site
gets, and about 20 on the single thread `npm start` gives.
`node tests/background.mjs` (`npm run test:background`) drives it end to end.

## Using handwriting

Write a short maths expression, end it with `=`, and pause. Readings that pass the stroke acceptance check calculate automatically. Other readings appear beside **solve**, so you can check or correct the expression before calculating it. Image-model readings and names repaired by the text model require an explicit Solve.

The stroke acceptance check now considers the weakest decoded token and nearby ungrouped ink as well as average likelihood. Possible expression fragments require confirmation, including after a cached reading is restored. Grouping also handles close right-hand scripts, spaced equals signs and detached overbars. The fresh evaluation improved complete-expression matches from 117/300 to 121/300; recognition remains fallible. See [the measured repair results](experiments/ocr-supply-chain-repair/REPORT.md).

Anything without an `=` is not calculated. If the reader made an expression of it, the margin shows that reading typeset (for example `6 + 2`) beside a **solve** button: tap solve for the answer, or tap the reading to correct it first. The × beside solve (or **dismiss** in the opened box) sends a box away for good: the reading is kept for search, the dismissal is saved with it and survives a regrouping of the ink, undo brings the box back, and so does Solve on that ink through the lasso. Prose gets nothing: the maths recognisers still treat ink as formulae, so a run of three or more letters is rejected as algebra. Separately, PP-OCRv6 reads handwriting in the background for search only; that transcript never replaces the ink or feeds the calculator.

Select an automatically generated answer to inspect the expression notas read. The popup lets you edit that reading or choose an alternative, then **use expression** stores the correction. To get an answer for something without an `=`, tap **solve** on its reading, or select it with the lasso and use **solve this**. A Solve request stays with the ink, so adding a digit to the expression afterwards keeps its answer. Automatically generated readings remain unconfirmed until corrected, so they can be re-read if the model changes; saved confirmed corrections are kept.

Search includes saved handwriting transcripts as well as note names and typed text. A dedicated PP-OCRv6-small text recogniser reads whole horizontal handwriting lines after a pause. Exact search works with Unicode letters and numbers, including CJK. Fuzzy matching tolerates small recognition mistakes in space-delimited text and also uses short character windows for space-less scripts; the actual recognized text is shown beside the matching note. Its model is about 20 MB and is included in offline setup.

On a 100-line English IAM handwriting check in Edge/WASM, PP-OCRv6-small ran at about 211 ms median / 301 ms p95. Exact recognition of words with four or more characters was 57.5%, while the fuzzy search recovered 84.9% of those word queries. Those accuracy figures are for Latin, space-delimited IAM text and should not be generalized to CJK. Search transcripts below the calibrated 0.80 confidence floor are discarded. That floor retains 90/100 IAM lines and rejects all eight bundled negative calibration fixtures (axes, grid, doodles and maths marks) as searchable letter/number text. Treat every transcript as search metadata, not a perfect transcription.

An accepted stroke reading can still be wrong. The acceptance threshold is a decoder-likelihood cutoff selected on development examples, not a probability that the expression is correct. Check the reading before trusting an answer.

Text-search OCR currently groups horizontal handwriting lines only. Vertical CJK handwriting is outside the supported recognition layout. notas does not bundle a separate CJK display font; CJK text uses the device's system font fallback so offline setup does not grow just for typography.

A handwritten cross is read as multiplication when it sits between two numbers, as in `3x4`, and as the variable `x` next to an operator, as in `2x+3=11`. Either way the other meaning is offered under **other readings**.

## Asking the page

Write or type `hey nota,` and a question on the page and the page answers it, in the tutor's red, right under the question. "What is the square root of this?" reads *this* from the maths nearest the question, because the visible page goes with the question as context. Handwriting is read by the PP-OCRv6 text recogniser after a pause (the call word is matched loosely, so *Hey Nota* and a slightly misread *hcy nofa* both work), and a question that wraps onto the next row is collected before it is sent. The reply is written as real strokes in a single-stroke script hand, sized to the handwriting it answers, at the pace of a pen, and it steps below anything already on the page. Once written it is ordinary ink: saved with the note, erased stroke by stroke, lassoed, moved and undone in one step. Erasing the question leaves the answer. The recognisers and the calculator never read the red ink, so an answer is never solved again.

A typed line that starts with `hey nota,` turns the call the machine's blue the moment it is complete (typing is exact, so `hey not` is not a call yet), and the reply is written into the note as red lines directly under the question: first a single red line of three dots that breathes while the model thinks, then the words as they stream in. Nothing to accept: the reply is part of the note from its first word, so the down arrow reaches it, Enter at its end starts an ordinary graphite line, and Ctrl/⌘ Z takes the whole reply out in one step. Red lines are never calculated. Editing the question leaves its reply alone; rewording it into a different question rewrites the same lines; removing the call while the reply is still arriving stops it. Under handwriting the same three dots pulse where the pen will start.

Replies come from a hosted language model (`gpt-oss-120b` on Cerebras, with reasoning effort set low so the pause before the first word stays short), so this is the one feature that needs the network and sends anything off the device: the question, the readings of the visible page and nothing else, never ink or images. The page tries the `/nota/chat` forward first: the dev server (`npm start`) and the Cloudflare Worker both carry the key as the `CEREBRAS_API_KEY` environment variable, so the page needs none of its own. Without a forward, Cerebras accepts calls straight from the browser, so any static host still works with a key in `nota.js` or in `localStorage` under `notas.nota.key`. Without a key or a connection nothing happens beyond a short toast. Everything else in the notebook still works offline.

## Math handwriting recognition

notas reads pen strokes with a local Hand-to-TeX encoder and decoder (about 18 MB), preserving point timing and geometry. It is the one maths engine. A completed low-confidence stroke reading remains visible, marked to be checked before solving, and stays available for correction or an explicit Solve; truncated readings are rejected. Pictures pasted into a note are pictures: nothing is read from them. The former per-symbol Fast recognizer and the 80 MB Smart image model (FormulaNet, AGPL-3.0) have both been removed from production; their historical code and results live under `experiments/legacy-fast/` and `experiments/onnx-seq2seq/`.

The stroke decoder keeps three candidate paths and offers completed alternatives under **other readings**. Beam scoring alone does not replace the primary reading. For confident strokes, it also checks slightly different sampling densities: two agreeing views can correct one ambiguous letter or Greek variable, while numbers, signs, functions and layout stay protected. This increased automatic exact matches from 61 to 63 and from 44 to 46 on two 100-expression development/regression sets, without losing previously correct expressions in those checks. It adds inference work and does not establish Apple Notes parity. See [OCR quality protocol](OCR-QUALITY.md) for measurements and limitations.

A separate PP-OCRv6-small text recognizer can provide independent spelling evidence for a leading named quantity such as `Pens` or `hi` when the mathematical structure agrees. Variable repair is deliberately conservative: true functions, powers, subscripts, fractions, roots and other two-dimensional notation are protected rather than flattened into a word.

Notebook grouping is line-aware and uses local stroke geometry so bars, dots, scripts and nearby rows do not freely bridge into one crop. This matters as much as the formula decoder on crowded pages: sending two nearby equations to the recognizer as one image guarantees a plausible but wrong transcription even when the model could read either equation in isolation.

Run `npm run benchmark:notes` to exercise the production notebook pipeline. Development fixtures include the reported short arithmetic and named-variable failures plus deliberately crowded/touching variants. Those regressions are useful for preventing known failures, but they are not an independent accuracy estimate. See [OCR quality protocol](OCR-QUALITY.md) for the held-out protocol and release gate.

The old headline near 97% result was an **isolated single-symbol classifier score**. It is not a formula or notebook accuracy score. The shipped stroke model measured 44/100 normalized exact matches on the untouched MathWriting test excerpt documented in `experiments/hand-to-tex/BENCHMARK.md` (55/100 counting its offered alternatives). Those figures are why the quality gate uses exact full expressions and notebook grouping rather than symbol accuracy.

The recognition workers run single-threaded unless the page is served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. With those headers they use up to four cores; without them one core does all the work.

If the model cannot start or run, notas reports the reason and offers retry rather than silently substituting a weaker recognizer. A model file that arrives short or damaged is detected, evicted from the offline cache, and downloaded again on Retry.

Both recognisers run in workers on this device: Hand-to-TeX for pen strokes and PP-OCRv6-small for handwriting text/search evidence. Neither requires an API key or a GPU. App files are fetched from the website during setup, but notes are not sent to a model service.

## Licensing

The stroke model is Hand-to-TeX's `htt-mini`, **MIT** (`assets/ink/HAND-TO-TEX-LICENSE.txt`; provenance and hashes in `experiments/hand-to-tex/model-metadata.json`). The ONNX Runtime Web build the workers share is MIT (`assets/smart/NOTICE.md`). The former Smart model's AGPL-3.0 and CROHME obligations no longer apply to the shipped app; they remain recorded with the experiment under `experiments/onnx-seq2seq/NOTICE.md`. The background remover is BiRefNet lite, **MIT**, fetched from `huggingface.co/studioludens/birefnet-lite-512` rather than shipped.

The PP-OCRv6-small handwriting-search model comes from PaddleOCR and is distributed under the Apache-2.0 license. Its provenance is recorded in `assets/text/NOTICE.md`.

## Brand and icons

The logo is a handwritten `notas` wordmark, kept as `assets/logo-source.png`.
Everything else is generated from it:

```sh
python scripts/make-icons.py
```

Luminance from the source becomes an alpha channel, so the brush edges stay
anti-aliased and the mark is tinted to the theme's ink colour rather than baked
black. The wordmark is 4:1 — it reads from about 64px up and is an illegible
smear at favicon sizes, so the 16 and 32px icons use its leading glyph as a
monogram. Both are cut from the same artwork, so it remains one identity.

| file | used for |
| --- | --- |
| `assets/icon-16.png`, `assets/icon-32.png` | browser tab (monogram) |
| `assets/apple-touch-icon.png` | iOS home screen |
| `assets/icon-192.png`, `assets/icon-512.png` | manifest, `purpose: any` |
| `assets/icon-maskable-512.png` | manifest, `purpose: maskable`, inside the 80% safe zone |
| `assets/logo.png` | the wordmark, tinted to the ink colour through a CSS mask on the launch screen and in the top bar |

These are listed in `sw.js`'s `SHELL`, whose install **throws** if any entry is
missing, so adding or renaming an icon means editing `sw.js` in the same change
or offline setup stops working.

## Verification

```sh
npm test
npm run test:browser
```

The browser suite starts and closes its own local server on a free port. It currently uses Microsoft Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` through Playwright.

Coverage includes actual recognition of drawn examples, fractions, powers, equals signs, correction persistence, offline reload, local hints, layout overflow, and absence of external runtime requests. It also draws `+`, `×` and `=` slowly with seeded tremor through the real pointer pipeline to check that scribble-to-erase leaves them alone, and scribbles of three, five and loose sweeps to check that it still erases. A unit regression test checks that delayed recognition cannot overwrite a confirmed correction.

These checks passed on the development computer. They do not establish accuracy or performance on a 4 GB Honor tablet. Before classroom use, test real student handwriting, long notes, first setup and retry, and reopening offline on a representative tablet. Record recognition times and correction frequency; synthetic examples are not an accuracy benchmark.

When changing cached app files, update the cache version in `sw.js` so existing installations fetch the new bundle.

See [the model card](assets/recognition-MODEL.md) for training, supported symbols, data sources, limitations, and reproducible benchmark commands. [Browser benchmark results](assets/recognition-browser-benchmark.json) compare all three classifiers on the same 2,935 real held-out symbols.

The former single-symbol trainer is archived under `experiments/legacy-fast/`; it does not train the current whole-expression recognizer. The clean whole-expression training workflow is documented in `experiments/clean-online-hmer/TRAINER.md`. The September 15 retraining trial and frozen evaluation protocol are recorded under `experiments/ocr-repair-20260915/`.
