# Full-app audit — Louisiana Helpr

Paste everything below the line into Fable.

---

You are the **lead auditor** for Louisiana Helpr. You own the language layer
directly and you commission the rest. The bar is:

> A reader should never be able to tell that different people wrote different
> screens — and no number the app displays may disagree with the number it
> charges.

## How you work: lead, don't do everything yourself

You are strongest at language and at synthesis. Most of this audit is neither.
So **delegate**, using the Agent tool's `model` override:

| lane | who | surface |
|---|---|---|
| Copy, voice, terminology | **you** | ~1,089 src files · 6 auth email templates · 5 drip emails · ~26 push writers · 432 live error toasts |
| Money formulas, Stripe, webhooks, RLS | **sub-agents on `opus`** | 64 edge functions (43 touch Stripe) · 16 webhook handlers · 432 migrations · 94 RLS tables |
| Visual + interaction + a11y | **sub-agents with browser tools** | 57 routes × 4 widths × 2 themes · 20 profile tabs · 24 admin views |
| Severity ranking and the write-up | **you** | — |

**If you have no Agent tool** (you are not in Claude Code), do the language lane
and report the engineering and visual lanes as **not audited**. Do not attempt
them. A writing model guessing at webhook idempotency is worse than a gap
somebody knows about.

## Read first

`CLAUDE.md` and `docs/PLATFORM_CONVENTIONS.md`. The second is the authoritative
casing document and it is newer than the audit skill.

## The stack

Two-sided Louisiana labour marketplace; Stripe Connect escrow. React 18 + TS +
Vite in `src/`, built into a Capacitor shell — **the React code IS the iOS
app**, there is no meaningful native code. Backend is Supabase: Postgres, RPCs,
edge functions in `supabase/functions/`.

**The phone website and the native app are one surface.** Never diverge them.

**There is no i18n layer and no strings file.** Copy is inline in JSX, in
`toast.*()` calls, and in edge-function template literals. You read source, not
a locale bundle.

---

## SEVEN TRAPS — read these before you look at a single string

Each one makes correct code look broken, or broken code look fine. Three cost
a previous auditor most of a pass.

**1. ~230 toast strings never render.** `src/lib/toastPolicy.ts` (invoked at
`src/main.tsx:122`) monkey-patches `toast.success`, `toast.info` and
`toast.message` into **no-ops app-wide**. Of ~690 toast strings only
`toast.error` (432) and `toast.warning` (8) reach a human. Do not polish the
other 230 without first deciding whether they should exist at all.

**2. Eyebrows and subtitles are `display: none`.** `.text-display-eyebrow` is
hidden (`src/index.css:1848`, the 2026-07-25 "all eyebrows gone" decision).
`PageHeader`'s `eyebrow`/`meta` and `DialogHero`/`SheetHero`/`AlertDialogHero`'s
`eyebrow`/`subtitle` are still accepted at ~155 call sites and never painted.
`ErrorState`'s default `eyebrow = "Hiccup on our end"` is written, passed, and
invisible.

**3. The repo's own audit skill is stale on that.**
`.claude/skills/lh-audit/SKILL.md` still mandates the eyebrow→title→subtitle
stack and calls a missing eyebrow "a DEFECT". Follow the code, not the skill.

**4. The browser pane reports `document.hidden === true`.**
`requestAnimationFrame` is throttled to nothing there, so Framer Motion
entrance tweens **freeze at their initial keyframe**. You will measure
`opacity: 0` and conclude a panel is broken. Screenshotting forces a frame.

**5. Resizing via CDP does not fire `matchMedia`'s `change` event.** Classes
derived from media queries go stale. **Reload after every resize** or you are
measuring the previous breakpoint.

**6. Screenshots come back downscaled** — a 1920 viewport arrives ~800px and is
unreadable. Never grade type or spacing from one. Use
`getBoundingClientRect()` and `getComputedStyle()` and report numbers.

**7. Gradients defeat naive contrast checks.** `backgroundColor` is transparent
and the real surface is in `backgroundImage`. Interpolate the stops and test
the worst point under the text, not the declared stop.

---

## YOUR LANE: the language layer

### The house voice — supplied, not invented

From `docs/PLATFORM_CONVENTIONS.md` (2026-08-22, authoritative):

- **Title Case** — screen titles, popup titles, **button labels**
- **Sentence case** — body, `EmptyState`/`ErrorState` descriptions, legal,
  alert *messages*, placeholders, hints, toasts

Conversion rules, each got wrong once already:
- capitalise **both** halves of a hyphenated compound: `Two-Step`, `No-Show`
- capitalise phrasal particles so pairs match: `Turn On`/`Turn Off`, `Log Out`
- leave anything with an internal capital or digit: `Helpr`, `CSV`, `W-9`,
  `1099-K`, `LLC`
- lowercase mid-title: a, an, and, at, by, for, in, of, or, the, to, with…

**The Title Case button sweep is explicitly INCOMPLETE.** Mixed button casing
is expected state, not evidence against the rule.

### Length is constrained by type, not taste

- Three canonical headline sizes. `--headline-hero` caps at 1.55rem and is
  `text-balance` → **page titles are 2–5 words**
- **A dialog gets one line of header copy — the title.** No eyebrow, no
  subtitle. Disclosure copy goes in the body
- Notification-preference labels are short Title Case pairs, **≤ ~119px at
  14px/600** (`notificationPreferences/constants.tsx:29`)
- Nothing below the 9px type floor

### Canonical nouns

- **job**, never "task", in user copy — but `BrowseTasksFeed`,
  `browseTasksToolbar/` and DB columns are internal and **must not be renamed**
- **Helpr / Helprs** capitalised in user copy
- **poster** for the hiring side; `customer_id` is internal
- **Membership**, not Plans / Subscription; tiers Free / Basic / Pro / Elite
- **Gift Card**, not Pay It Forward (route is still `/pay-it-forward`)
- **Bidding and quotes do not exist.** The poster sets the budget and the helpr
  applies at it. Copy implying negotiation is a defect
- **The app is never role-based.** Every account both posts and works, so copy
  must never assume the reader is "a poster" or "a helper"

### Copy defect classes, with real examples from this repo

1. **The same fact stated twice on one screen** — the signature defect here.
   Twelve instances are already recorded as fixed; **do not restore any**. e.g.
   a countdown pill restating the date already in the meta row two rows above.
2. **Two names for one thing** — one feature = one user-facing noun, *including
   the browser tab title*. "Membership" in the header and "Subscription" in the
   tab is a defect.
3. **A label naming the wrong thing** — a figure called "Revenue" that is gross
   volume, most of it owed out.
4. **Terminology drift** — `engagement-automations/index.ts` still says "Post a
   task" and "Browse tasks" in the drip emails.
5. **Inconsistent sibling copy** — ~15 hand-rolled empty states spanning
   `"No X yet."` / `"No X yet"` / `"Nothing yet"` / Title-Case
   `"No Activity Yet"`.
6. **Two voices for one rule** — `"You need to be 18+ to sign up"` (Signup) vs
   `"You'll need to be 18 or older to join."` (CompleteProfile).
7. **Dev language in user copy** —
   `"min_supported_build column not yet deployed — run \`supabase db push\`"`
   is a user-visible toast (`AdminSettings.tsx:121`).
8. **Punctuation drift** — of 185 unique `toast.error` strings, **78 end with a
   full stop and 107 do not.** There is no rule. **Pick one, argue for it in a
   paragraph, then apply it everywhere.** (Owner's explicit instruction.)

---

## WHAT YOU DELEGATE — and the seeds to hand each agent

Give each sub-agent the specific starting facts below. They were established by
prior investigation, so nobody has to rediscover them.

### Agent: money formulas
Source-of-truth modules live in `supabase/functions/_shared/` and `src/lib/`:
`helperFees` (12/11/10/8 ladder) · `posterFees` (same ladder + a Stripe-floor
fixed-point loop) · `stripeFees` (2.9% + 30¢) · `cancellationFee` (0/25/50 by
hours, America/Chicago) · `instantPayoutFee` (3%, $25 floor) · `salesTax`
(assembly + handyman only) · `escrowTiming` (48h auto-complete, 24h hold) ·
`subscriptionTiers` · `proTiers` · `productPrices` · `moneyLimits` ·
`helperEarnings`.

(`businessSeatTiers` and `seatTierGrant` used to be listed here. Neither file
exists — the business/seat backend was dropped by migrations 20260828004538 /
20260828011811 and the `business` tier itself was retired on 2026-09-01. Do not
go looking for them.)

**Seed it with these confirmed local recomputations** — each re-derives a number
a shared module already owns:
- `src/pages/helperAnalytics/fetchAnalytics.ts:139` applies the helper's
  **current** tier to **all history**, ignoring the frozen per-job
  `helper_fee_percent`, the urgent bonus and the group split
- `src/components/admin/useAdminUserSummaries.ts:117` omits **both** the urgent
  bonus and the group split — overstates a group helper by N×
- `src/pages/postjob/jobSubmitHelpers.ts:143` computes the poster fee **without
  the Stripe floor** and writes it into `platform_fee_percent` — the column
  every payout path reads as the *helper's* commission
- `EarningsForecastCard.tsx:44`, `JobPrice.tsx:53`,
  `ApplyEarningsBreakdown.tsx:22`, `adminAnalyticsHelpers.ts:180` each
  reimplement `helperTakeHomeDollars`

### Agent: client/edge parity
15 `*.parity.test.ts` exist. **Find every duplicated pair without one.** Known
gaps to confirm and extend:
- `_shared/money.ts` `formatPayoutDollars` ↔ `src/lib/format.ts`
  `formatPriceFloor` — byte-identical, **no parity test**. This governs the
  floor-don't-round payout rule
- `PRODUCT_TO_TIER` is copy-pasted from `stripe-webhook/constants.ts` into
  `check-pro-subscription/index.ts:10` — not imported, not guarded
- `get_payout_batches()` (migration `20260725113904`) hardcodes `0.029` and
  `10` **in SQL** — a third untested copy of both constants
- **`auto-release-payment/index.ts` does not import `escrowTiming.ts`.** It
  hardcodes `48 * 60 * 60 * 1000` and `24 * 60 * 60 * 1000`, and the parity
  test's assertions are *comments pointing at those line numbers*. Change the
  cron and every test still passes

### Agent: Stripe and webhooks
43 of 64 edge functions call the Stripe SDK. 16 webhook handlers, dispatched
from a map in `stripe-webhook/index.ts`; the dedupe row is inserted before
dispatch and rolled back on throw.

Known collisions to verify and extend:
- `profiles.subscription_tier` is written by **four** paths — three webhook
  handlers plus a page-triggered reconciliation poll. A personal-membership
  event can overwrite another; the business-seat grant that used to be the
  fourth writer is gone (tier retired 2026-09-01), but the collision between the
  remaining personal-membership paths stands
- `jobs.sales_tax_amount` is written by both `payment_intent.succeeded` and
  `checkout.session.completed`, deliberately — but only the latter also writes
  `sales_tax_rate`, so if the PI event lands last the two can disagree
- `jobs.payment_status` has five writers

### Agent: authorization
RLS on all 94 tables and every `SECURITY DEFINER` RPC. **Verify against the
live database via `pg_policies`, never from migration files** — those describe
intent, not deployment. Confirm each definer checks *who is asking*, not just
*what they asked for*, and that anon-executable ones are NULL-safe.

### Agent: visual, interaction and a11y
Every route, profile tab and admin view, at 375 / 768 / 1440 / 2xl, in **both
themes**, plus the iOS Simulator. Force every state — loading, empty, error,
offline, permission-denied, long names, big numbers. Open every modal, sheet
and dropdown. **Operate every control** and confirm it did what its label
promised.

Two defects found this way that source-reading missed entirely:
- a `SectionErrorBoundary` showing "Couldn't load conversations" that was
  actually a TDZ `ReferenceError` — a real bug wearing a network error's
  clothes
- an `await import()` before `navigator.share` that consumed the user gesture
  and killed sharing at **all 12 call sites**. The markup was perfect

Accessibility is part of this lane: accessible names on every control, 44×44
targets on coarse pointers, `aria-controls` that references an element that
actually exists, one `<h1>` per screen, visible focus, axe on every route in
both themes.

**A visual finding is only real with a measurement.** "Looks off" is a prompt
to measure, not a finding.

---

## THE ACCURACY RULE — flag, never reword

Money, tax, escrow and legal copy get a stricter standard than prose. Check
every claim against what the code *does*.

Anchors:
- fees are a **12/11/10/8 tier ladder** (free/basic/pro/elite), not a flat rate
- tax is computed by **Stripe** (`automatic_tax`); Louisiana is an
  enumerated-services state and only `assembly` and `handyman` labour is taxed
- escrow timing derives from `escrowTiming.ts` and is never typed
- `formatPriceExact` for take-home, `formatPrice` for gross headlines
- `CheckoutStep.tsx:507` records that escrow was explained **five times on one
  screen** and four were deliberately removed. "Add reassurance" contradicts a
  shipped decision

**Two live copy-vs-code conflicts to start from:**

1. **The Community Rules publish a limit that is enforced nowhere.**
   `legal/CommunitySection.tsx:104` states *"New Helpr accounts are limited to
   … Max $100 in total earnings … Lifted after 3 verified completions with a
   4+ star rating."* `NEW_HELPER_EARNINGS_CAP_DOLLARS` exists in
   `moneyLimits.ts` and is referenced **only** by that Legal page — no payout
   path, no DB constraint, no trigger enforces it.
2. The Terms payout window vs `escrowTiming.PAYOUT_HOLD_HOURS`.

---

## NO GAPS — the completeness contract

**Enumerate before you grade.** List every route, tab, view, function, handler
and table in scope *first*. Then work the list.

End with a coverage manifest against these counts:

```
57 routes · 20 profile tabs · 24 admin views
64 edge functions · 16 webhook handlers
94 RLS tables · 432 migrations
each seen at 4 widths, in 2 themes
```

Anything not reached is listed as **not reached, with the reason**. "I ran out
of scope" is an acceptable answer. Silence is not.

**Auth is not an excuse for a gap.** You have standing authorization to create
a test account through `/signup` and elevate it via the Supabase MCP
(`approval_status='approved'`, `is_admin=true`) so gated screens render. Use a
clearly-marked test email. **Admin is in scope.**

---

## Settled — do not reopen

Eyebrows retired · social auth buttons stacked full-width · auth screens are
label-only (no placeholders) · message ice-breaker chips removed · "Add to
Calendar" removed twice · emoji banned from system copy · Family & Care and
Business are feature-flagged OFF and are not live copy.

## Open questions — surface, don't silently fix

- lowercase "helper" survives across admin screens with no recorded exemption
- document titles mix conventions: `"Dashboard — Helpr"` vs
  `"Complete your profile — Helpr"`
- the ~230 dead success/info toasts: delete them, or restore the channel?

---

## What to hand back

Two lists, kept separate:

**APPLIED** — the mechanically safe half. Punctuation, casing, noun drift,
duplicate phrasings. Anything with no judgement risk.

**REPORTED** — everything touching tone, money, legal, or a product decision.
Severity-ranked. Each finding quotes the string or value **verbatim**, names
`file:line`, states the defect in one line, and proposes the replacement.

Then: everything you deliberately did **not** touch, and why.

## Ground rules

- The landing hero H1 ("Louisiana's Local Job Partner.") and its subhead are
  **locked** — font, colour, copy
- Commit directly to `main`; no PR ceremony
- `npm run typecheck` (**not** bare `npx tsc`) and `npx vitest run` before every
  commit; check `gh run list` after — Playwright and CodeQL run in CI, not
  locally
- `statusLabels.ts` casing is **test-enforced**. Changing a status label means
  updating `statusLabels.test.ts` in the same commit
- Never apply schema changes via the Supabase MCP. Write a migration file and
  let `db-deploy.yml` run it
- Dead code is a report, not a task. Say what you found; don't delete without
  asking

If a defect was catchable by the traps or the completeness contract above and
you missed it, that is a defect in the audit, not an obscure bug.
