# notas — Build Spec

A note-taking app where the math answers itself. Write or type anything; expressions
resolve in the margin, variables stay live across the page, and an AI tutor can write
on your notes instead of talking at you.

Single file: `notas.html`. No build step, no server required, no account.

---

## 1. Context & constraints

Built for **AI in Action (Y7–Y11)**. Rules that shape the design:

| Rule | How notas satisfies it |
|---|---|
| Must be an app people can use | Single HTML file, works from a link, no install |
| Must use AI meaningfully | Handwriting recognition + tutoring + on-page annotation |
| Must help learning / skill improvement | Hint ladder, check-my-work, step verification |
| Must be safe for school | No accounts, no uploads by default, AI switchable off |
| Must NOT be a game | No levels, scores, battles, or win-lose framing anywhere |
| Must NOT collect personal info | Zero PII. All notes local (IndexedDB). Visible privacy panel |
| Adoption is scored | Anonymous local UUID + opt-in counter, no PII |
| Pilot testing required | In-app feedback link (Google Form), anonymous |

Deadline reality: registration closes September 2026, showcase October 2026.
The build order below is arranged so that if anything is dropped from the tail,
what remains is still a complete, coherent product.

---

## 2. Core principle

> **The AI transcribes. The CAS computes. The AI never does arithmetic.**

Handwriting → vision model → LaTeX/ASCII string → **math.js evaluates it locally**.

Why this seam:

- LLMs read messy handwriting well and do arithmetic badly. Split the work accordingly.
- All math then runs **offline**. Only recognition and tutoring need network.
- Answers are deterministic and reproducible — the first thing a judge tests.
- It gives a free correctness oracle: when the tutor writes steps, each step is
  **verified numerically by the CAS**, and failing steps are flagged. The AI shows the
  working; the calculator audits the AI.

---

## 3. Locked decisions

| Decision | Choice | Reason |
|---|---|---|
| Canvas model | **Paged** — A4-width column, grows downward | Export, reading order, cropping all become trivial |
| Text mode | **Line-based**, answer inline after each line | Per-line math, variable graph, caret handling all simple |
| Typed math input | **Plain-text syntax + KaTeX preview** | No MathLive (~500KB + virtual keyboard = clunk) |
| Ink storage | **Vectors, never pixels** | Recognition, selection, undo, export, file size |
| Eraser | **Stroke eraser** (hit test + delete) | Pixel erasing breaks the vector model |
| Rendering | **Two canvases** — committed + live | Redrawing 5k strokes per pointermove kills Chromebooks |
| Storage | **IndexedDB** | localStorage's 5MB cap dies on day one with ink |
| AI access | **Provider seam**, 3 backends | Key question stays a 10-line change |
| Hosting | **Serve it** (GitHub / Cloudflare Pages) | `file://` breaks modules, fetch, SW, and IDB origins |

---

## 4. Design

**Design read** — product UI, not a landing page, for Y7–Y11 students on Android
tablets, phones and keyboard-only Chromebooks, with a quiet exam-pad language,
leaning on an ink taxonomy as the design system rather than a component kit.

**Dials** — `DESIGN_VARIANCE 4` (the chrome stays predictable; the student's own
handwriting is the variance), `MOTION_INTENSITY 4` (feedback and state changes only,
never ambience), `VISUAL_DENSITY 3` (the page is mostly empty paper on purpose).

### The organizing idea: three pens

A notas page has exactly three authors, and every mark on it is attributable at a
glance by colour alone:

| Pen | Author | Where it appears |
|---|---|---|
| **Graphite** | the student | handwriting, typed lines, the tool pill |
| **Blue** | the machine | answers, transcriptions, plots, anything computed |
| **Red** | the tutor | annotations, marks, hints, and the tutorial itself |

This is an ink taxonomy, not decoration. Colour encodes authorship, which is exactly
what a student needs to know on a page with three writers on it. It also gives the
one-accent rule a principled shape: blue and red are never interchangeable, and
nothing else on the page is coloured at all.

The red is a marking-pen red on a cool ground, deliberately not the terracotta-on-cream
palette that every generated page reaches for.

### Palette

```
--paper        #F5F6F4   cool pad stock, not cream
--graphite     #22252A   student ink, cool like a 2B pencil
--blue         #2B5F8E   the answer, written in the same hand as the page
--blue-quiet   #7C93A6   secondary computed text
--red          #C0392B   tutor pen
--red-soft     7%  red   the wash behind what the tutor said
--red-edge     42% red   the ring around the tutor's dot
--red-glow     18% red   the cast under the tutor's surfaces
--rule         #E2E4E0   hairlines, pill edge, panel borders

dark mode:  paper #17191A · graphite #E8E8E4 · blue #7FB3E0 · red #E5544A · rule #2C2F31
```

One theme for the whole app, following `prefers-color-scheme`, with a manual override.
No section inverts.

### Shape
- Full-bleed page. Plain paper, no ruling or grid.
- **No sidebars, no panels, no settings page.**
- **Four tools** in a small floating pill: pen, eraser, select, text.
  Size and colour on long-press, not a permanent bar.
- **The answer sits right after the working**, about 18px past the end of the line or
  past the right edge of the handwriting, vertically centred on it. Never in a far
  column, where the eye loses track of which answer belongs to which line. Tap to expand
  (transcription, steps). Graphs are the exception: too big to sit inline, so they keep
  the right hand band.
- **The tutor is one dot** (bottom-right, or `⌘K`), ringed in red with a soft red cast,
  because it is the only red control in the interface and should be recognisable before
  it is read. It opens the tutor's panel, which grows out of the dot.

### Touch
The page is a sheet of paper, not a document to highlight, so `user-select` is `none`
everywhere and `text` only inside the fields you type in. Without that, a drag or a
long-press painted the ink layer and the typed lines system blue mid-stroke, which
reads as an error the moment it appears. Selection is also refused outright while a
pointer is down, because a press on the canvas still emits compatibility mouse events
that would anchor a selection in the text layer underneath.

Where the pointer is coarse, everything a finger has to hit is at least 44px, the
tool pill stays centred within thumb reach instead of retreating to a corner, and
fields stay at 16px so focusing one never zooms the page. The eraser follows the
instrument: 9px for a pen tip, 14px for a fingertip, and it draws the band it is
about to clear plus a ring at the contact point — the cursor a touch screen never
provides. Every fixed edge is measured from the safe area, since the viewport is
`fit=cover`.

### The tutor's panel
Three bands, stacked so the panel grows upward from the dot:

1. **What the tutor said** — red Caveat on a soft red wash with a red rule down the left
   edge, exactly like a margin note on marked work. The tutor speaks in the same hand it
   writes on the page with, so a reply and an annotation are visibly the same voice.
   System notices (AI off, request failed) drop to plain quiet UI type instead, because
   those are the app talking, not the tutor.
2. **The ladder** — one filled red rung for the next level of help, quiet text buttons
   for "Check my work" and "Clear marks", and a four-segment meter showing how much of
   the answer has been given away. The meter is information, not a score: it tells a
   student how far they have leaned on it.
3. **The ask row** — a red mark, the input, mic, speaker, and a filled red send button.

Before the first question the panel is just the ask row plus "Check my work", so it
always offers one useful action without any explanatory copy.
- **Notes list is an overlay**, opened by clicking the title. `Esc` closes anything.
- One overflow menu: angle mode, fractions, AI on/off, export, privacy, feedback,
  replay tutorial.

**Shape lock** — interactive controls are full-pill (tool pill, ask bar, result chips).
Panels are 10px. Nothing else is rounded.

### Typography
- **UI: IBM Plex Sans.** A face built for technical and educational contexts, not Inter,
  with Plex Mono available where figures need tabular alignment.
- **Answers and tutor ink: Caveat.** The answer is written beside your writing in the
  same hand, so the margin reads like someone worked it out next to you rather than like
  a calculator display bolted to the page. Colour, not typeface, carries authorship.
- **Math rendering: KaTeX's own faces**, used only for the transcription shown when a
  chip is expanded.
- Three families, each with one job. The interface itself uses only Plex.
- The UI stays quieter than the handwriting. Three steps only: 20px title, 14px for
  anything readable, 11px for meta. Answers are 21px Caveat, which sits at about the
  same optical size as 14px Plex. Line length capped at 60ch in the ask bar and privacy
  panel.

### Motion
Every animation answers an action or reports a state. Nothing loops, nothing floats.

| Moment | Motion | What it communicates |
|---|---|---|
| Result resolves | fade + 4px rise, 140ms | a value arrived |
| Recognition in flight | three breathing dots in the chip | working, not frozen |
| Tutor writes | a pencil travels the path, ink appearing behind it | someone is writing this, and where to look next |
| Ask bar opens | grows from the dot, 190ms | which control it belongs to |
| Undo | removed stroke fades over 90ms | what was removed |

All of it collapses to instant under `prefers-reduced-motion`. No spinners anywhere.

### Icons
Phosphor via CDN, regular weight, one family. Seven glyphs total: four tools, mic,
speaker, overflow. No hand-drawn SVG paths. If the CDN is unreachable the pill falls
back to letters — `P E V T` — which is also the keyboard mapping, so the fallback
teaches the shortcut.

### Copy rules
- Sentence case everywhere. No ALL-CAPS labels, no eyebrows.
- **Zero em-dashes and en-dashes in any visible string.** Hyphens only.
- Active voice, and an action keeps its name through the flow: the button says
  "Export", the toast says "Exported".
- **Invalid maths says nothing at all.** Half finished writing is not a mistake to
  report, so the margin simply stays empty until the line makes sense. No red squiggles,
  no parser messages, no "unexpected end of expression".
- Errors that a person can act on still speak, in toasts: *"No connection, so handwriting
  is not being read. Typing still works."*
- The empty note says what to do, not that it is empty: *"Write anything. Math answers
  itself."*

---

## 5. Tool access — replacing Apple Pencil double-tap

Pencil double-tap is not exposed to web pages on any browser. These five layers beat
it on hardware the school actually has, ordered by how much travel they remove:

**1. Scribble to erase — removed.** Scribbling over ink used to delete it. Two implementations failed
in opposite directions: counting sign changes in x measured hand tremor, so one
slow diagonal of a `×` erased the stroke it crossed, while measuring retracing
was safe but still asked a heuristic to read intent. Deleting work the student
did not ask to delete is not a cost worth any hit rate, and the eraser is one tap
away. The gesture is gone.

**1c. Nothing eats a stroke silently.** Three paths discarded a pen stroke with
no ink and no explanation: being counted into a gesture, the barrel-button
shortcut returning early, and a pointer whose `pointerup` never arrived staying
tracked forever so the next stroke paired with a ghost. A pointer unheard from
for two seconds is swept, a pen going down clears every other pointer, gestures
are fingers only, and the barrel button snaps the tool and then draws with it.
`?debug=pointers` logs every event and every discard.

**1a. Palm rejection is a setting, not a heuristic.** Two attempts failed on real
hardware. `pointerType` is not stable — the same Apple Pencil is delivered as
`pen` on some strokes and `touch` on others, confirmed from a device log — so
"ignore touches near a pen event" silently discarded one line in two. Contact
geometry then looked like the answer, but iOS reports a fingertip far above the
size a palm was assumed to need, which killed finger drawing outright and took
two-finger scrolling with it, because the rejection ran before the pointer was
recorded and the gesture could never reach two. Nothing separates a palm from a
fingertip on a device that reports them at the same size. **Draw with —
finger and pen | pen only** asks instead. Pen-only is inert until a real pen
pointer has been observed, so a mis-set option can never leave a page
undrawable, and one finger scrolls there, which is worth having anyway.

**1b. Palm before pen.** A hand rests on the glass before the nib touches it, so
the palm is the *first* pointer, not the second. Pairing it with the pen counted
as two pointers and turned the opening stroke of every line into a two-finger
scroll; it reappeared only on the second attempt, once the pen had armed the
palm window. A pen is authoritative: any non-pen pointer still tracked when a pen
arrives is palm and is dropped, along with any gesture it began. Whatever pointer
starts an interaction owns it until it lifts, so a palm settling or lifting
mid-stroke cannot commit or redirect the line.

**2. Flip the pen.** `pointerType === "pen"` with the eraser bit set in `e.buttons`
(bit `32`) → temporary eraser. S Pen, Surface Pen and most Wacom AES pens report it.
Feature-detected; nothing looks broken on pens that don't.

**3. Barrel button.** Secondary-button pointerdown (`button === 2` / `buttons & 2`)
→ snap to last tool (pen ⇄ eraser). This *is* the double-tap gesture, on your hardware.

**4. Long-press radial menu — removed.** A ring of four tools used to open after a
250ms hold. On paper it was zero-travel; in use it fired constantly, because holding
still is what you do while drawing a careful glyph or thinking mid-line. Every
false trigger discarded the stroke in progress, so the cost of the gesture was paid
by the writing it interrupted. The pill and the keyboard cover the same ground
without a timer deciding when you meant to pause.

**4b. Lasso, then drag.** A selection is a thing you can pick up. Pressing inside
its marquee moves it; pressing outside starts a new lasso. The move is applied to
the stroke points only on release, so it is one undo step rather than hundreds,
and it is clamped to the page so ink cannot be dragged somewhere unreachable. A
cluster's reading is keyed on its stroke points, so moving ink would orphan a
confirmed correction: the readings are carried across to the new keys, and an
answer stays attached to the working that produced it.

**5. Keyboard — the main path for this school, not a fallback.**

| Key | Action |
|---|---|
| `1`–`4` / `P E V T` | Pen, eraser, select, text |
| Hold `E` | Spring-loaded erase; release returns to pen |
| `Space` + drag | Pan |
| `⌘/Ctrl+Z` / `⇧⌘Z` | Undo / redo |
| `⌘K` | AI ask bar |
| `Enter` | New line (text mode) |
| `Esc` | Close any overlay |
| Two-finger tap | Undo |
| Three-finger tap | Redo |
| Two-finger drag | Scroll |

Undo and redo also have bar buttons, which dim when their stack is empty. A tablet
has no keyboard and no way to discover a three-finger tap, so redo needed a control
that is simply visible.

Keyboard-only students live in text mode where tools barely apply; their fast paths are
`⌘K`, `Enter`, and typing `=`. The tool pill stays small rather than trying to serve them.

---

## 6. Tutorial — the tutor teaches it

The tutorial is not an overlay sitting on top of the product. It is the product
performing itself: the coach marks are **written in red tutor ink with rough.js**, the
same system the AI uses for every annotation afterwards. Onboarding and feature demo are
the same object, so a student learns what red ink means in the first ten seconds.

**Rules**
- **Never modal, never dims the page.** The canvas stays fully live throughout. A student
  who ignores the tutorial can just start writing, and it retires itself after five
  strokes of their own.
- **Each step completes on the action**, not on a Next button.
- **Progress is marked in the tutor's own vocabulary** — a red tick beside each finished
  step. No dots, no progress bar, no step counter.
- **Skip** sits bottom-left in plain text, always visible.
- If nothing happens for 15 seconds the tutor adds one gentler nudge, then offers to
  skip. It never traps anyone.
- Replayable from the overflow menu.
- **What you write during the tutorial stays.** The first note is a real note, not a
  sandbox that gets thrown away.

**Step 1 — the margin answers**
The tutor circles an empty spot near the top of the page, draws an arrow to it, and
writes *"try 12 x 7"*. You write it or type it. The answer arrives in the margin in blue.
Completes when a result resolves. The typed path needs no key and no network, so this
step can never stall.

**Step 2 — values connect**
A line lower, the tutor writes *"name it: pens = 3"*, then *"use it: pens x 4"*. The
moment both exist it draws a red line from the definition to the use and ticks it.
Completes when a dependency edge exists. This is where the notebook stops being a
calculator.

**Step 3 — the tutor is here**
The tutor draws an arrow to the ✦ dot and writes *"stuck? ask me"*.
Completes when the ask bar opens, not when a reply arrives, so the final step never
depends on the network either.

Then the tutor strikes out its own notes and clears them, leaving only the student's
work on the page. Under 20 words of copy in total.

---

## 7. Features

### In scope
1. **Ink and text on the same page**, both evaluable.
2. **Live variables across the note** — `price = 12` above, `price * 4` below.
   Editing the definition recomputes every dependent. Cycle detection.
3. **Unit-aware math** — `3 km / 20 min → 9 km/h`, `250 g * 4`. Covers physics and chem.
4. **Auto-plot** — `y = x^2 - 3x` draws a graph card; free parameters get a slider
   (`y = k x^2` → drag `k`, the curve animates).
5. **Check my work** — the AI finds the *first* wrong step only; the CAS confirms it is
   actually wrong.
6. **Hint ladder** — nudge → hint → next step → full solution. The student chooses depth.
7. **AI ink annotation** — arrows, circles, underlines, labels, sticky notes, plots,
   drawn hand-style (rough.js) in the tutor's red, on its own toggleable layer.
8. **Searchable handwriting** — search hits handwritten pages via stored transcriptions.
9. **Voice I/O** — hold ✦ to speak a question; a speaker toggle in the ask bar reads
   answers aloud (off by default, remembers the choice). Mic hidden if unsupported.
10. **Export** — PNG, `.notas.json`, print-to-PDF.
11. **Photo drop** — drag an image of a worksheet onto the page → recognized and
    annotatable. Zero added UI, and the escape hatch for students with no stylus.
12. **Angle mode (deg/rad) and fraction/decimal toggles** — the number-one source of
    "the calculator is wrong" complaints.

### Cut (deliberately)
Paper templates (the page is plain paper), flashcards, shape straightening, PDF worksheet
import, BM/EN toggle (the tutor mirrors whatever language the question was asked in),
practice question generator, MathLive.

Without ruling, the y-band tolerance in §8 carries more weight for reading order. It is
derived from median stroke height rather than a fixed value, so it adapts to how large
the student actually writes.

---

## 8. Data model

```
Note {
  id, title, createdAt, updatedAt,
  settings: { angle: "deg"|"rad", fractions: bool, ai: bool },
  pages:   [Page],
  lines:   [TextLine]
}

Stroke {
  id, pageId,
  author: "user" | "ai",
  tool:   "pen" | "highlighter",
  color, width,
  pts:   [x, y, pressure, ...],   // flat, quantized to 1dp
  bbox:  [x0, y0, x1, y1],
  t0, t1                          // for temporal clustering
}

Cluster {                          // derived, not persisted verbatim
  id, strokeIds[], bbox,
  hash,                            // stroke ids + point counts
  latex, ascii, kind, confidence,
  provides,                        // variable/function this defines, if any
  deps[],                          // identifiers referenced
  result, error
}

TextLine { id, pageId, y, text, provides, deps[], result, error }

Annotation { id, author: "ai", targetId, ops: [...], bbox, createdAt }
```

**Document order** — what "before" means on a freeform page: sort by
`(page, y-band, x)`, where the band tolerance is the median line height.
Variables resolve in that order.

---

## 9. Subsystems

### 9.1 Shell
Single state object, command layer, render pass, event bus — `state → command → render`,
strictly one direction. Each subsystem in its **own `<script>` tag** so a syntax error
isolates. Global `window.onerror` → toast: *"Something broke — your notes are safe,
export them."* IndexedDB via idb-keyval. Autosave on idle (`requestIdleCallback`) and on
`visibilitychange`. Keep the last N snapshots; **never overwrite a good save with a
failed parse.** `navigator.storage.persist()` so the browser doesn't evict;
`estimate()` to warn near quota.

### 9.2 Ink engine
- Pointer Events + `getCoalescedEvents()` — without it, 120Hz pens draw jagged and late.
  `getPredictedEvents()` to mask latency.
- Palm rejection: ignore `pointerType === "touch"` if a `"pen"` event was seen recently.
- `touch-action: none` on the canvas, or the page scrolls while you draw.
- DPR scaling (`canvas.width = css * devicePixelRatio`); re-render on zoom, never scale
  a cached bitmap.
- Pressure → width, with a velocity fallback (many devices report a constant `0.5`).
- Smoothing: Catmull-Rom → bezier, or perfect-freehand outlines if the UMD build
  cooperates (about 40 lines to do it directly if not).
- Stroke eraser: point-to-polyline distance with a bbox prefilter / grid buckets.
- Lasso select → move, scale, delete, "solve this".
- One unified undo stack across ink, text, and AI actions.
- iOS Safari silently blanks oversized canvases: one canvas per visible page, cap area.

### 9.3 Text lines and results column
An array of line objects, each its own element. No `contenteditable` rich text.
One right-margin chip per line. KaTeX renders the transcription and result on expand.

### 9.4 Math core
- **math.js** — parsing, units, matrices, complex numbers, formatting.
- **nerdamer** (+ Algebra, Calculus, Solve) — symbolic solve, expand, factor, integrate.
- Route by intent: `solve(...)`, `d/dx`, `∫` → nerdamer; everything else → math.js.
- **Degree mode**: math.js trig is radians. When degree mode is on, inject wrapped
  `sin/cos/tan/asin/acos/atan` into the evaluation scope rather than rewriting input.
- **Fractions**: `math.fraction` and exact formatting where possible.
- **Dependency graph**: nodes are evaluable clusters and text lines; edges run from
  `deps` to `provides`. Topological recompute in document order; cycles are marked
  *"circular reference"*, not thrown.
- **Safety**: evaluate with a restricted scope; block `import`, `createUnit`, and
  function-constructor paths. AI-suggested expressions go through the same gate.
- Display: round to 10 significant figures, keep exact where possible, and never show
  `0.30000000000000004`.

### 9.5 Recognition pipeline
1. **Cluster** strokes: bboxes expanded by 0.8 × median stroke height must intersect,
   and Δt < ~20s. Recomputed incrementally on stroke add/remove.
2. **Trigger**: pen-up + ~900ms idle + cluster hash changed + AI enabled. Plus an
   explicit solve gesture, since auto-firing on every pause burns quota.
3. **Crop** the cluster bbox with padding, render on white at 2×, downscale to ≤768px
   longest edge. Small images are cheaper and faster.
4. **Call** the vision model with a response schema:
   `{ latex, ascii, kind: "expression|equation|definition|question|prose", confidence }`.
   The prompt instructs it **never to solve**.
5. **Cache by hash** — otherwise every re-render re-bills you.
6. **Abort stale**: one `AbortController` and request token per cluster; drop late
   responses, or answers attach to the wrong expression.
7. **Exclude AI ink** (`author: "ai"`) from recognition, or it reads its own annotation
   and loops.
8. **Editable transcription chip** — `x` vs `×`, `1` vs `l`, `2` vs `z` will be misread.
   Making the transcription visible and correctable turns the weakness into an honesty
   feature.

### 9.6 AI layer

**Provider seam** — one interface, three backends:
1. Proxy URL (school-hosted; the eventual answer)
2. User-supplied key in localStorage
3. Offline / no-AI (default) — every math feature still works, and no nag modals

Notes for whichever is chosen: Gemini's REST API is CORS-friendly from a browser and
supports `responseSchema` JSON mode; Anthropic requires the
`anthropic-dangerous-direct-browser-access` header. Add a hard per-session request cap
so one student in a loop can't drain the school's quota.

**Context sent to the tutor**: a structured note description (clusters + bboxes +
recognized LaTeX + text lines), optionally plus a cropped image for diagrams. The hybrid
beats screenshot-only and costs far fewer tokens. Only the visible page and relevant
clusters — never the whole notebook.

**Annotation primitives** — the model never emits raw coordinates (it draws garbage).
It emits ops, and our code renders them:

```
arrow(fromId|point, toId|point)   circle(targetId)
underline(targetId)               label(text, nearId)
sticky(text, nearId)              plot(expr, nearId)
strike(targetId)                  tick(targetId) / cross(targetId)
```

Rendered with **rough.js** in the tutor's red on a separate layer, and **drawn along
their own path** rather than stamped: a red pencil travels the stroke at about 620px per
second with the ink appearing behind its tip. Circles sweep round, arrows run out to
their head, ticks follow their two strokes, and labels are written a letter at a time
with the pencil sitting at the end of the word.

The reveal works by clipping to the part of the path already travelled, so the finished
rough stroke is uncovered rather than redrawn. Redrawing a rough path every frame would
jitter, because rough.js re-randomises whenever its endpoints move.

Beyond looking good on video, the pencil does a job: it tells the student where to look
next, because their eye follows the tip to the thing being marked.

**Placement solver** — build a 16px occupancy grid from stroke bboxes and result chips.
Candidate anchors in order: right margin at the target's y → below the target → above it.
The first anchor with enough free cells wins; extend the page height if none fit.
Without this the AI scribbles over the student's work, which is the most likely
embarrassing demo moment.

**Hint ladder** — nudge → hint → next step → full solution, one rung per tap. The system
prompt is Socratic: ask a leading question before giving anything away. It mirrors the
language the student wrote in.

**Check my work** — returns `{ firstWrongStepIndex, why, correctedStep }`. Each
consecutive pair of steps is then **CAS-verified**: substitute random values for free
variables within a safe range, compare both sides numerically with a tolerance, skip
non-numeric steps. Steps that fail verification are flagged even if the AI claimed they
were fine.

### 9.7 Plots
Sample the expression across the visible domain; break the path on large deltas so
asymptotes don't draw vertical bars. Free parameters get a slider, and dragging
re-samples live. Rendered as a card in the margin, drawn in the machine's blue with its
own hairline axes, since the page itself carries no grid.

### 9.8 Voice
Web Speech API — free, no key. `SpeechRecognition` for input (hold ✦ to speak),
`speechSynthesis` for output (toggle in the ask bar, off by default, remembered).
Feature-detected: if `SpeechRecognition` is missing (Safari, Firefox) the mic is simply
not rendered rather than sitting there broken.

### 9.9 Notes list, search, export
An overlay list. Search runs over text lines **and** stored transcriptions, so
handwritten pages are findable. Export: PNG (`canvas.toBlob`), `.notas.json`, and
print-to-PDF via print CSS (which avoids a 1MB PDF library).

### 9.10 Privacy, feedback, self-test
- **Privacy panel**: "Your notes stay on this device. Only the part you ask about is
  sent for AI help. AI can be switched off entirely." Compliance proof and trust feature.
- **Feedback button** → Google Form link, anonymous. Satisfies the pilot-testing step.
- **`?selftest=1`** — an in-file assertion suite over the parser, variable graph, units,
  degree mode, cycle detection, document ordering, and placement. Costs an hour, catches
  regressions, and is a legitimately good thing to show a judge.
- Anonymous local UUID and usage counter, off until there is an endpoint. Decide before
  launch — adoption numbers cannot be backfilled.

---

## 10. Build order

Arranged so the tail can be dropped without leaving a half-product:

1. Shell, state, IndexedDB, autosave, render loop, error guard
2. Ink engine (pointer events, two-layer canvas, eraser, select, undo)
3. Tool access layers (scribble-erase, pen flip, barrel button, keyboard)
4. Text lines and results column
5. Math core (math.js + nerdamer, variable graph, units, deg/fraction modes)
6. Recognition (cluster, crop, call, cache, abort, editable chip)
7. AI (ask bar, hint ladder, check-my-work + CAS verification, annotations, placement)
8. Plots and parameter sliders
9. Voice I/O
10. Notes list, search, export
11. Tutorial, privacy panel, feedback, self-test

**After step 5 the app is already a complete offline math notebook** that needs no key
and no network. Everything after that is upside.

---

## 11. Libraries (CDN)

| Library | Use | Notes |
|---|---|---|
| math.js | Evaluation, units, formatting | Core dependency |
| nerdamer + Algebra/Calculus/Solve | Symbolic solve, integrate | Fills math.js gaps |
| KaTeX | Math rendering | Much lighter than MathJax |
| rough.js | Hand-drawn AI annotations | Makes AI ink look like a teacher's pen |
| perfect-freehand | Pressure stroke outlines | Optional; hand-rolled fallback is ~40 lines |
| idb-keyval | IndexedDB wrapper | Tiny |

Inlining everything is possible but yields a 3–5MB file. CDN by default, and serve the
page rather than emailing the `.html`.

---

## 12. Known risks

| Risk | Mitigation |
|---|---|
| Misrecognized handwriting | Editable transcription chip, always visible |
| API cost / quota drain | Hash cache, debounce, explicit solve, per-session cap |
| Stale async results | AbortController + request token per cluster |
| AI reading its own ink | `author` tag and separate layer, excluded from clustering |
| AI drawing over student work | Occupancy-grid placement solver |
| Data loss | Snapshots, idle autosave, never clobber on parse failure, export |
| One syntax error kills the app | Split `<script>` tags + global error handler |
| Old Chromebooks | Two-layer canvas, vector storage, no per-frame full redraw |
| `file://` weirdness | Host it |
| Wrong trig answers | Explicit deg/rad toggle, visible in the chip |

---

## 13. What the build changed

`notas.html` is built and passes its own self test. Eight things differ from the spec
above, each for a reason found while building or from testing it in use:

1. **A third typeface, Caveat, for the tutor's hand and for answers.** Both are written
   on the page rather than printed on it. It never appears in UI chrome, so the interface
   itself still uses one family.
2. **Invalid lines show nothing.** The original plan showed parser errors in the chip.
   In practice every half typed line produced an "unexpected end of expression", which is
   noise while you are still writing. A chip now appears only when the maths is valid.
3. **Document-order evaluation instead of a topological graph.** On a page that reads
   top to bottom, evaluating in reading order with a running scope gives the same result
   for far less machinery. A reference to something defined lower down reports
   *"x is defined further down the page"*, and a self reference reports
   *"x refers to itself"*, which is the honest version of cycle detection here.
4. **`20 min` is rewritten to `20 minute` before evaluation.** math.js resolves `min` to
   the minimum function before the unit, so unit arithmetic silently failed on the most
   common physics quantity on a school page.
5. **`x` becomes multiplication only between spaces and before a plain number.**
   `12 x 7` and `pens x 4` convert; `2x`, `3 x (x+2)` and `x = 5` keep x as a variable.
6. **Selection moves, deletes and solves, but does not scale.** Scaling needs handles and
   hit testing that the four-tool pill has no room for.
7. **An expression made only of names is maths.** `y * x` was being ignored, because the
   "is this maths or prose" guard demanded a digit or an equals sign. An operator is
   signal enough, and a line that fails to evaluate stays silent anyway.
8. **Answers are inline, not in a margin column.** A fixed right hand column looked tidy
   on paper, but with short lines the answer ends up far from its working and the eye
   loses track of which belongs to which. The chip now measures where the line's text
   actually ends, or where the handwriting's bounding box ends, and sits just past it.

Libraries load through a cache in IndexedDB, so the second visit works with no network.
Two CDN paths in the original plan were wrong (rough.js and nerdamer are not on cdnjs
under those names); both now come from jsdelivr, and the tutor falls back to plain canvas
strokes if rough.js is ever unreachable, rather than drawing nothing.

---

## 14. For the proposal template

- **Problem** — Students doing math homework switch constantly between paper, a
  calculator and a search engine, and none of them explain anything. Notes are dead once
  written; a wrong step stays wrong until a teacher sees it days later.
- **Solution** — A notebook where the math is live. Write naturally by hand or keyboard;
  expressions resolve as you go, variables stay connected across the page, and an AI
  tutor marks your working on the page itself with hints rather than answers.
- **Target users** — Y7–Y11 students doing math, physics and chemistry homework, on
  stylus tablets, phones, or keyboard-only Chromebooks.
- **AI used meaningfully** — vision handwriting recognition, Socratic tutoring, and
  automatic marking of student working, with every arithmetic claim independently
  verified by a local computer algebra system.
