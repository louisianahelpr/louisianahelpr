# The state matrix

**What this is:** the enumeration of the states Louisiana Helpr can render, so
coverage can be measured against *states* rather than *places*.

**Source of truth:** `e2e/happy-path/state-matrix/stateMatrix.ts`. This
document explains it. The machine-readable manifest is regenerated from that
module and never hand-edited:

```
EMIT_STATE_MATRIX=1 npx playwright test --project=happy-path state-sweep -g "emit manifest"
# writes $STATE_SWEEP_OUT/state-matrix.json and state-matrix.md (default /tmp/lh-state-sweep)
```

---

## Why it exists

`COVERAGE_LEDGER.md` counted 232 units — routes, redirects, profile tabs,
admin views, edge functions, overlay roots. Every one of them is a **place**.

On 2026-08-31 the owner found roughly twenty real defects in forty-five minutes
of tapping a real build, after several audits had reported the app clean. Not
one of them lived in a place the ledger was missing. They lived in **states**:

- a status with no branch of its own (`pending_approval` renders no card body)
- a card expanded rather than collapsed (expansion gates ~90% of both job cards)
- a job four days past due (`jobIsOverdue` re-buckets it and adds a band)
- an arrival that was *claimed* but not *verified* (three captions off two
  nullable columns, one of them amber)
- step 2 of a dialog (`ReportDialog` has three screens; every sweep saw one)

A route sweep photographs each screen once, in whatever state the data happened
to be in. It cannot see any of that. So this matrix is derived from the code
the surfaces actually branch on: the `job_status` enum, the
`application_status` enum, the derived-state function the helper card runs, and
the nullable columns each card reads.

---

## The shape of the space

**195 state cells, 334 frames.**

| Surface | Cells |
| --- | ---: |
| Poster job card (`/my-posts`) | 76 |
| Helper job card (`/my-jobs`) | 48 |
| Tracker rail | 22 |
| Activity shell (tab × bucket × density) | 26 |
| Job detail dialog | 9 |
| Multi-step and state-bearing dialogs | 14 |

| Reachability | Cells | Meaning |
| --- | ---: | --- |
| `auto` | 176 | the sweep reaches it by mocking a row and loading a route |
| `interaction` | 13 | needs a named trigger clicked; a renamed button drops the cell and it is reported UNVERIFIED, never omitted |
| `native` | 4 | only observable in WKWebView — see `IOS_COVERAGE.md` |
| `unreachable` | 2 | deliberately not driven, with a reason |

| `job_status` | Cells |
| --- | ---: |
| `open` | 34 |
| `in_progress` | 36 |
| `accepted` | 25 |
| `completed` | 18 |
| `disputed` | 18 |
| `revision_requested` | 10 |
| `cancelled` | 9 |
| `pending_approval` | 2 |

`pending_approval` is thin because it genuinely is thin: it is the one status
with no card-body branch at all. It renders an amber info box and a single
Edit Post button, and — found while building this — it is **absent from
`e2e/happy-path/seedData.ts` entirely**, so it has never appeared in any
screenshot this repository has ever produced.

---

## Why it is not a million cells

The naive cross-product is meaningless. The poster card alone reads 8 statuses
and about 17 further independent-looking flags; 8 × 2^17 is a million cells, of
which almost all are unreachable — there is no `cancelled` job with an active
boost banner and a live dispute deadline. A manifest that emits them can never
be finished, so it is never used, and the coverage number it produces is a
fiction.

So nine collapsing rules are applied. Each is a **claim about the code that can
be checked and falsified**, written down rather than left implicit, because the
reason the last matrix was wrong is that nobody could see what it had decided
to ignore.

### R1 — Status is the outer axis; sub-axes are gated by it

A sub-axis is enumerated only for the statuses whose code path reads it.
`boost_expires_at` is read only under `open`. `dispute_status` only under
`disputed`. `cancellation_fee_status` only under `cancelled`. Tip and review
only under `completed`. The arrival lattice only under `accepted` and
`in_progress`.

This is the rule doing most of the work: it turns 2^17 into a two-digit number
per status.

*Falsifiable by:* finding a card that reads one of those fields outside the
status it is listed under.

### R2 — The helper card is a derived state machine, not a product

`deriveAppliedJobCardState` (`src/components/activity/appliedJobCard/appliedJobCardHelpers.ts`)
maps `(application_status × job_status × direct_offer_status ×
offered_to_helper_id × helperReviewedJobIds)` onto about ten mutually exclusive
sections. 3 × 8 = 24 raw tuples collapse to those sections, plus two edge
cases: an application whose job row is hidden by RLS, and the tuple that
matches no section and falls through to the "No actions available on this
application right now" safety-net string — which is enumerated precisely
because that string exists and nobody has ever looked at it.

*Falsifiable by:* a tuple that produces a section not in the list.

### R3 — Expansion is orthogonal and doubles

`isExpanded` gates the description, the tracker, the action row, the photos and
every status-specific body block on both cards. It is the one axis that
genuinely multiplies everywhere, so every card cell is captured collapsed
**and** expanded. Exception: minimal cards (rejected, cancelled, no-job-row)
pass `expandable={false}` and have no expanded form.

### R4 — Cosmetic call-site props collapse away

`tone`, `columns`, `size`, `variant`, `inline`, `flexibleLabel`, `amountTitle`
are chosen by the call site, not by data, and cannot vary for a given cell. One
representative value each.

One near-exception is recorded rather than collapsed: `locationPressToMap` is
passed `true` only by `PostedJobCard`, so the identical-looking location chip
is a plain link on one card and a long-press-for-map button on the other. That
is a behavioural divergence between two cards, not a cosmetic prop, and it is
called out in the poster/helper pairs.

### R5 — Data presence is a 3-valued profile, not N booleans

Photos, the series strip, the pet report card, group helpers, the directions
button and the proof images are all self-hiding sub-components that render
`null` when their data is missing. Crossing six booleans with eight statuses
buys nothing, because they stack and do not interact. Instead: `empty` /
`sparse` / `rich` content profiles, plus named content cells for the shapes
that have broken this layout before — a 130-character title, a 40-character
unbroken token, an accented counterparty name, five photos, a series parent
versus a series child, a group job, pet care with and without a report.

### R6 — Transient in-flight guards are declared, not enumerated

`confirmingArrivalJobId`, `confirmingWorkingJobId`, `completingJobId`,
`withdrawingAppId`, `respondingHelperAppId`, `disputeActing` each disable and
relabel exactly one button for the duration of one mutation, and are reachable
only by winning a race against a mocked 201. They are emitted as **one cell
with `reachable: "unreachable"` and the reason**, because a named gap is
auditable and a silent one is not.

### R7 — Clock axes are enumerated at their boundaries

Countdowns get calm / urgent (<12h) / critical (<2h) / expired. Past-due gets
on-time / due-today / four-days-past. Every date is an offset from a single run
clock captured once per run — never a frozen literal, because `jobIsOverdue`
and `useDashboardFilters` compare against the *viewer's* today and a hardcoded
date would silently collapse the whole matrix into one past-due cell.
(`seedData.ts` carries the same warning for the same reason.)

### R8 — Category collapses to two values plus one palette strip

`pet_care` unlocks the report card and the pet sheet, so it is a real branch.
The other eleven differ only in the left rail hue and the badge classes in
`categoryColors`. They are covered once, by a single cell that renders all
twelve as sibling cards — which is also the only way to ask the question that
matters about them ("do these read as one system, and is any pair
indistinguishable?").

### R9 — Breakpoint and theme apply to a subset

Crossing 195 states with 6 breakpoints and 2 themes is roughly 2,000 images.
Nobody reviews 2,000 images, and an artifact nobody reviews is exactly the
failure this tooling exists to correct — the 2026-08-31 sweep captured
screenshots and then never examined them.

So: **every cell at 390 light** (the modal device), and the status-*defining*
cells — the one cell that first introduces each status or derived state —
additionally at **390 dark, 1440 light and 320 light**, because that is where
the token swap, the rail inset and the truncation bugs live.

---

## Running it

```bash
# 1. Enumerate (no browser)
EMIT_STATE_MATRIX=1 npx playwright test --project=happy-path state-sweep -g "emit manifest"

# 2. Capture every cell — against a production bundle Playwright builds and serves
RUN_STATE_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
  npx playwright test --project=happy-path state-sweep

#    …or against a server you are already running
RUN_STATE_SWEEP=1 HAPPY_PATH_BASE_URL=http://127.0.0.1:8080 \
  npx playwright test --project=happy-path state-sweep

# 3. Review — see docs/audit/STATE_REVIEW_PROMPT.md
node scripts/state-review.mjs                # triage + packets, nothing judged yet
node scripts/state-review.mjs --review       # needs REVIEW_API_KEY
```

Output lands in `$STATE_SWEEP_OUT` (default `/tmp/lh-state-sweep`): a PNG and a
JSON review record per frame, plus `index.json` listing every frame the sweep
could **not** drive, with the reason.

Nothing here is wired into a workflow file — workflows are owned elsewhere. The
intended CI shape is: capture, review, fail on any HIGH finding, upload
`findings.json` and the ranked queue as artifacts.

---

## What this matrix cannot see

Written here so a full manifest is never mistaken for a full audit.

- **Everything WKWebView-only.** Chromium has no content-process jetsam, no
  software keyboard, and reports zero safe-area insets. The app-lock bug, the
  keyboard-covers-the-sheet bug and every safe-area bug are invisible to it by
  construction. `docs/audit/IOS_COVERAGE.md` states what the simulator covers
  and what needs hardware.
- **Motion.** Frames are still. A transition that flashes the wrong colour, a
  layout that jumps on mount, a skeleton that never resolves — none survives
  into a PNG.
- **The backend.** The rows are `page.route()` responses. This proves the React
  tree renders that shape. It does not prove the RPC returns it, that RLS lets
  it through, that the edge function is deployed, or that the money moved.
  Those are the defect classes that reached production, and no amount of state
  enumeration touches them.
- **Interactions between two cards.** Every cell renders one job. A list where
  an `accepted` chip sits directly above a `completed` chip — the pair whose
  colours differ only by tint alpha — is covered only by the `rich` density
  cells of the activity shell.
- **States nobody enumerated.** This matrix is derived from source, but it was
  derived by a person reading that source. A branch nobody found is a cell
  nobody wrote. The manifest's honesty about *what it decided to ignore* (R1
  through R9) is what makes that gap auditable rather than invisible.
