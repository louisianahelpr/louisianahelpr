# What is wrong with this image

The review prompt for the state sweep. `scripts/state-review.mjs` pairs this
file with one screenshot and one observation record and asks for a critique.

---

## Why this is worded the way it is

Every automated gate this repo has ever run asserts a predicate:
`documentElement.scrollWidth <= clientWidth`, axe-core clean, tap targets
>= 44px, exactly one `<h1>`. On 2026-08-31 the owner found roughly twenty real
defects in forty-five minutes of tapping a real build, after several audits had
reported the app clean.

**Every one of those findings passes every one of those predicates.**

- two different greens on one tracker rail — both clear AA, neither overflows
- a close (X) laid on top of a price — both elements are over 44px
- a status badge six pixels out of line with its sibling — no rule mentions 6px
- a forty-pixel empty band — an empty `div` is valid HTML and valid ARIA
- missing section eyebrows — axe does not require a section to be labelled
- a "Report" button on a job that finished a week ago — a button is a button

There is no predicate to add. Each of these is obvious to a person looking at
the picture and invisible to a rule. So the review pass must *look*, and the
question it is asked has to be the question a person asks: **what is wrong with
this?** — never "does this pass?", which is answered "yes" by construction.

A reviewer that returns "no issues" on a screen with a defect is worse than no
reviewer, because it launders the defect into a green tick. So: this prompt
asks for problems, and requires the reviewer to say what it examined when it
finds none.

---

## The prompt

> You are reviewing one frame of the Louisiana Helpr app in one specific state.
> Your job is to find what is **wrong** with it. Assume something is: this
> frame was captured because the state it shows has never been looked at by a
> human, and the states that had been looked at still shipped twenty defects.
>
> You are given:
>
> 1. **The screenshot.** This is the evidence. Look at it first, before
>    reading anything else, and write down what you notice.
> 2. **What state this is** — a sentence naming the exact status, role, data
>    presence and expansion the frame was forced into, plus the axis values.
> 3. **An observation record** — measurements taken from the live DOM that a
>    picture cannot give you: the exact colour values in play and which of them
>    fall in the same hue family; sibling edges that almost line up and by how
>    many pixels; vertical runs with nothing painted in them; overlapping
>    boxes; the headings present; every control label; every text run.
>
> The record is a **caption**, not a verdict. Nothing in it is automatically a
> defect and nothing absent from it is automatically fine. Use it to turn "that
> looks a bit off" into "the badge sits 6px left of the price above it".
>
> Report only what you can point at. For each finding give: the defect class,
> a one-line description naming the two elements involved, the evidence (a
> coordinate, a colour pair, a pixel count, or a quote), and a severity.
>
> If you genuinely find nothing, say so — and list what you checked, by class,
> so the empty result is auditable. "Looks clean" on its own is not an
> acceptable answer.

---

## The defect classes

Grounded in what the owner actually found. Each names what to look for and the
field of the observation record that helps.

### 1. Inconsistent colour meaning

*One meaning, two colours — or two meanings, one colour.*

The tracker rail paints passed steps with `--success-ink` (hue 142, a true
green) and the current in-progress step with `--bark` (hue ~70, an olive
green). A reader sees "green, green, slightly different green" and has to
decide whether the difference means something. It does not.

Look for: two members of the same hue family doing different jobs in one frame;
the same colour used for two states that must be told apart; a status chip
whose colour disagrees with the same status elsewhere on the screen; a tint
that differs from another only by alpha (`--bark/0.12` vs `--bark/0.18` is
`accepted` vs `completed`, and they are adjacent in the same list).

Record fields: `hueFamilies` (families with more than one member are listed
first), `colors` (every value with its hue, saturation, lightness, alpha, role
and the element it painted).

### 2. Misalignment between sibling elements

*Two things that should share an edge, and nearly do.*

Look for: a badge, chip, avatar or price that starts a few pixels off the
element above or below it; a right-aligned column whose members disagree; an
icon whose optical centre misses its label's baseline; a card whose left rail
and body padding do not agree; two action chips of different heights in one
row.

Record field: `nearMissAlignments`. Any cluster with a spread between 1 and
12px is a candidate — 0px is deliberate alignment and 40px is deliberate
indentation; the band in between is where this defect lives. The `samples`
array names the elements and their coordinates.

### 3. Empty bands

*Space where content should be, or space a collapsed section should have taken
with it.*

The app is full of self-hiding sub-components — the photo strip, the series
strip, the pet report card, the directions button, the applicants panel. Each
returns `null` when its data is missing. A wrapper with padding around a
`null` child leaves a band.

Look for: a vertical gap with nothing in it, especially between two related
blocks; a card that is taller than its content; a section header with nothing
under it; a footer that floats away from the body; on desktop, a rail-width
dead gutter (see CLAUDE.md — the desktop inset is applied in exactly one
layer, and a page that re-insets itself pushes content right by a second rail
width).

Record field: `emptyBands` — each entry gives the gap's offset from the top of
the region, its height, and the last thing above it and the first thing below,
so you can judge whether the gap belongs.

### 4. Unlabelled sections

*A block of content nobody named.*

`SectionEyebrow` exists in `src/components/activity/appliedJobCard/` precisely
because these blocks need naming. Where it is missing, a reader meets a group
of controls with no idea what group they are in.

Look for: a visually distinct block with no heading or eyebrow above it; two
adjacent blocks that read as one because neither is named; a heading whose
words do not describe what follows; a heading level that skips.

Record field: `sections` (tag, text, font size, vertical offset). Compare the
count and positions against the visual blocks you can see in the screenshot —
a block in the image with no entry near its y-offset is unlabelled.

### 5. Controls that overlap or collide

*Two things occupying the same pixels.*

The owner found a close (X) laid on top of a price. Both were large enough to
tap; neither overflowed; the frame was "clean".

Look for: any two boxes that intersect; a control sitting over text; an
absolutely-positioned corner action over content that has grown; a badge
clipped by its container's `overflow: hidden`; text running under a fixed
footer or the bottom nav; anything under the home indicator.

Record field: `overlaps` — pairs of intersecting boxes with the intersection
area. Note that a legitimate overlap exists (a decorative rail behind text);
judge from the screenshot whether the pair is one of those.

### 6. Actions that make no sense in this state

*A control that is correct code and wrong product.*

This is the class the predicates can never reach, because a button is always a
valid button. It needs someone who knows what the state means.

Read `describe` — it names the state in words — then read `actions` and ask of
each label: **is there any reason for a person in this exact state to press
this?** Examples of the shape:

- "Report" on a job that completed and was already reviewed and tipped
- "Boost" on a job that already has an active boost
- "Confirm Arrival" when the arrival is already confirmed
- a primary action that is disabled with no visible explanation
- two primary-weight actions competing in one row (there should be one)
- an action absent that the state clearly needs (a `disputed` job with no way
  to reach the dispute)

Record fields: `actions` (label, disabled, size) and `describe`.

### 7. Copy that contradicts something next to it

*Two true sentences that cannot both be true.*

Look for: a status chip that says one thing and the body copy another
("Completed" beside "Waiting for the Helpr to accept"); a countdown that has
expired next to copy that says time remains; a plural/singular disagreement
against a count in view; a date rendered two ways in one card; the word
"confirmed" used for an arrival that is only *claimed* (the app is careful
about this distinction — `arrivalStateLabel` reserves "confirmed" for
`verified` and `confirmed`, never `claimed`, so any frame where a claimed
arrival reads as confirmed is a real regression); an empty state whose copy
promises something the screen does not offer.

Record field: `copy` — every text run in document order. Read it as prose.

### 8. Console errors

Not a visual class, but recorded on every frame because an error thrown while
a state renders usually means the state is half-rendered. Record field:
`consoleErrors`.

---

## Severity

Use the `lh-audit` tiers (`.claude/skills/lh-audit/SKILL.md` §4):

| Tier | Meaning here |
| --- | --- |
| **HIGH** | The state misleads the reader about money, trust or safety; an action that could take the wrong irreversible step; content unreachable or unreadable. |
| **MEDIUM** | The state reads as broken — overlap, a dead band, a contradiction — but nothing is lost by it. |
| **LOW** | Polish: a few pixels, a near-duplicate hue, a missing eyebrow on an otherwise obvious block. |

A HIGH finding must name the harm, not just the symptom.

---

## Output format

One JSON object per frame, so findings can be collated and diffed:

```json
{
  "cellId": "posted-completed-tipped-and-reviewed-expanded",
  "shot": "390-light",
  "findings": [
    {
      "class": "action-makes-no-sense",
      "severity": "MEDIUM",
      "what": "\"Report Job\" is offered on a job that is completed, paid, tipped and reviewed",
      "evidence": "actions: [Tipped(disabled), Reviewed(disabled), Hire Again, Report Job]; describe says tipped AND reviewed",
      "where": "action row, bottom of the card"
    }
  ],
  "checked": ["colour-meaning", "alignment", "empty-bands", "section-labels",
              "overlap", "action-sense", "copy-contradiction", "console"],
  "notes": "…"
}
```

`checked` is mandatory and must list every class considered, including on a
clean frame. A frame with `findings: []` and a short `checked` list is itself a
finding about the review.

---

## What this review cannot see

Stated here so a clean review is never mistaken for a clean app:

- **Anything that only happens in WKWebView.** Chromium has no content-process
  jetsam, no software keyboard, and reports zero safe-area insets. The app-lock
  bug, the keyboard-covers-the-sheet bug and every safe-area bug are invisible
  to this harness by construction. See `docs/audit/IOS_COVERAGE.md`.
- **Motion.** Frames are still. A transition that flashes the wrong colour, a
  layout that jumps on mount, a skeleton that never resolves — none of these
  survive into a PNG.
- **Anything a mocked backend cannot produce.** The rows are `page.route()`
  responses. This proves the React tree renders that shape; it does not prove
  the RPC returns it, that RLS lets it through, or that the money moved.
- **States nobody enumerated.** The matrix is derived from source, but it is
  derived by a person. A branch nobody found is a cell nobody wrote.
