# Full-app audit — Fable lead pass, 2026-08-23

**Head at close:** `690211b93` · **Base:** `05ac2ed25` · 8 commits shipped, all
gated (typecheck + 1734 vitest green each), all pushed direct to `main`.

Method: the language lane was done in the foreground; the three engineering
lanes (money formulas, client/edge parity + Stripe webhooks, RLS/authorization)
and were run as parallel `opus` sub-agents; the visual/interaction/a11y lane was
**not run** this pass (see coverage). Every engineering finding below was
established by a sub-agent and is quoted with `file:line`; RLS findings were
verified against the **live** database (`pg_policies`/`pg_proc`), money findings
against the source at HEAD plus the one real prod payout row.

---

## The mandate check

- **No number the app displays disagrees with the number it charges** — this
  bar is **not yet met.** Six display-vs-charge defects survive (B-series and
  M-series below); none moves money wrong *today* on real data, but three ship a
  figure to a user that the payout/charge path contradicts.
- **A reader can't tell different people wrote different screens** — closer after
  this pass: toasts, empty/error titles, the "Couldn't" voice, button casing,
  and the canonical noun are now uniform. The dialog-header backlog (Sheets) and
  the visual cohesion lane remain.

---

## APPLIED — shipped this pass (mechanically safe, no judgement risk)

**Overnight wave, 2026-08-24 (30 commits, two parallel sessions):** iOS
filter-sheet scroll fix (drag-dismiss moved to the handle) · signup
empty-form inline errors · SOS retired on helper-completion · dangling
aria-controls (4 components, /browse 11→0) · emoji stripped from 8 live DB
notification functions via migration 20260824070000 (live-verified 0 left)
+ 'Your Helpr' fallback · chat system events say Helpr · owner-directed
job-card rework (meta into header, one-line title/meta, chevron removed in
favor of shell click, tighter rhythm, freshness stamp under the bar) ·
Needs You / Storm Prep / One-Time / Post a Job / Order Summary casing ·
TAB_TITLES aligned to rendered h1s · public-doc shell unified (h1 at
96,100 on all four) · /accessibility orphan removed (Simple-vs-Senior
duplication REPORTED) · Help Center density + Legal tab centering ·
reset-password no-token copy · one-line phone titles rule
(PLATFORM_CONVENTIONS) · plus the web session's guest-skeleton fix,
orphaned-label a11y pass, and data-display polish.


**Second wave, 2026-08-24** (after the owner resolved the open decisions): the
$100 new-helper earnings cap and the unenforced "3 active jobs" block left the
published Community Rules (`afc00a120`); admin copy swept to "Helpr"
(`f4e8f1a5c`); 222 suppressed toast calls deleted (`93791628f`); actionable
toasts reopened (`fc4b395bb`); three posting tips stopped implying Helprs send
quotes, since bidding is gone (`b3a1f8c6b`).


| commit | what | scope |
|---|---|---|
| `afc00a1` | Removed the `$100` new-helper earnings cap from Community Rules + its dead constant. Arithmetically impossible (one avg job = ~$123 take-home vs a $100 cap needing 3 completions to lift) and enforced nowhere. | 2 files |
| `df132af` | (a) Terms payout window derives from `PAYOUT_HOLD_HOURS` instead of a typed "24–48 hour" range wider than the cron keeps. (b) Removed the "New Helpr account limits" block (3-active-jobs + probation) — enforced nowhere; `apply_to_job` has only the rate ladder. (c) AdminSettings' `run supabase db push` dev toast → human copy. (d) Drip emails: "Post a task" → "Post a job", "New tasks in your area" → "New jobs". (e) 18+ rule unified to one voice. | 6 files |
| `32edb0a` | Every **live** toast (`toast.error`/`toast.warning`) ends with terminal punctuation. See the punctuation ruling below. | 50 files |
| `1fa2f06` | Empty-state fragment titles drop the period (5:1 majority); error titles unified to "We couldn't load X." (replacing 11 bare "Couldn't load X."). | 16 files |
| `06e5846` | "Couldn't" beats "Could not" across `src/` (191 vs 33). | 6 files |
| `e0890a6` | **Fixed the red E2E** (`apply-dialog-fit.spec`) — red since the corner-X dialog refactor `6ebadde14`, before this session. Spec now matches the "Close" dismiss and treats the corner X as frame chrome. | 1 file |
| `fac35b7` | Title Case button-label sweep closed (the sweep `PLATFORM_CONVENTIONS §1` marked incomplete). ~96 labels, incl. hyphen both-halving and phrasal particles. `On`→`on` corrected in "Manage Payouts on Stripe". | 60 files |
| `690211b9` | Canonical noun reaches edge user-copy: status email "post tasks"→"post jobs", Stripe line items "Helpr Task:"→"Helpr Job:" / "Browse Tasks"→"Browse Jobs", Connect product "Local task…"→"Local job…". | 4 files |

### The toast-punctuation ruling (the brief asked for a decided rule)

Of 249 unique live toast strings the corpus already split 122 ending in a full
stop, 30 in the house "… — try again?" softener, 97 bare. A **no-punctuation**
rule can't hold: toasts here are sentence-case prose, frequently multi-clause and
sometimes multi-sentence, so many *must* carry internal punctuation and a bare
tail then reads as a truncation. A **full-stop** rule holds uniformly. **Decision:
every live toast ends with terminal punctuation** — the 97 bare strings take the
stop, the question-mark idiom keeps its mark, nothing is stripped. Applied to the
432 `toast.error` + 8 `toast.warning` that actually render (the ~230 suppressed
`success`/`info`/`message` were left — see the open decision below).

---

## ✅ CLOSED 2026-08-24 — R1–R20 all fixed (owner approved the money + security lanes)

Every finding below R1–R18 has been fixed, gated and deployed; the section
is kept for the reasoning, not as a to-do list. Highlights and corrections:

- **R1 (release-blocking) is closed and live-verified.** Guards: job must be
  FUNDED, start time must have PASSED, escalation counts DISTINCT reporters,
  one report per job. An accepted-application check was considered and
  REJECTED against live data (only 6 of 20 assigned jobs carry an application
  row — it would have broken legitimate direct assignment; all 20 are funded).
  Attack replayed read-only against the deployed function: blocked.
- **R2/R3/R4/R11 live-verified in prod** — email-queue grants revoked,
  always-locked money columns, distance RPC gated to the job's poster, and
  `messages` UPDATE reduced to exactly one column (`read`).
- **R5 measured, not assumed:** 2,199 (budget, tier) pairs under $200
  diverged between the two payout paths — e.g. $5.05 @ 10% paid 454¢ one way
  and 455¢ the other. One shared `helperCommissionDollars()` now.
- **R7 was worse than reported:** the same `limit: 1` customer bug existed in
  BOTH polls, and the personal one could wipe a BUSINESS SEAT tier it never
  granted. Both enumerate all customers; the revoke now refuses to clear a
  tier it doesn't own and fails closed.
- **R10 is moot** — bidding was removed by the owner, so `proposed_price` has
  no live write path.
- **R15 was partly inaccurate:** `RecentTransfers` was already cents-exact
  (`formatPriceExact` over `amount_cents`) and needed no change.
- **R17 was found unfixed after a premature "all closed" claim** and is now
  done: the weekly email overstated a 3-person group helper by 3.4x
  ($309.71 reported vs $91.24 transferred), the Tips tile summed gross (88c
  over per $20 tip), and the admin dispute slider quoted dollars for partial
  splits that move NO money — AdminDisputes says so in its own code ("Splits
  are recorded but not auto-executed"). The first two are fixed; the third is
  now honest about itself, and the missing partial-split execution is written
  up as an owner decision rather than invented.
- **R18's own guard was the point:** the pre-existing escrow parity test
  asserted against a comment, so the cron could drift silently. The
  replacement parses the cron's arithmetic — verified by a negative control
  (48→47 fails, revert restores green).

---

## ✅ CLOSED 2026-08-24 (evening) — R19 + R20, the latent items

Shipped as `20260824210000_r19_r20_latent_leaks_and_cancelling_status.sql`,
every sub-item re-verified against the live DB before writing (pg_policies /
pg_proc ACLs / cron.job / pg_constraint). Corrections the verification forced:

- **R19 closed with two verified NON-findings.**
  - `is_licensed`/`is_insured` are **not** forgeable badges: `CredentialBadge`
    requires `license_status`/`insurance_status = 'verified'`, and those ARE
    pinned by `prevent_self_escalation`. The booleans are the user's own
    CredentialsTab inputs — pinning them would have broken the form. No change.
  - `job-photos` stays a **public bucket by decision**: photos attach to
    publicly-browsable listings and every stored URL is a public URL; flipping
    the bucket private 404s them all. The participant-scoped policy isn't dead
    letter either — it arbitrates the client's upsert uploads
    (`storagePolicies.test.ts`). If listing photos are ever deemed sensitive,
    the fix is signed URLs plus a data migration, not a bucket flip.
  - The fixed remainder: `evacuation_pets` read is owner/helper/admin (was
    anon `USING(true)` incl. `destination_address`); `reviews` SELECT enforces
    `status='published'` + the `feedback_visible_at` double-blind hold that
    clients were already filtering voluntarily; **15** (not 12) cron/sweep/
    cleanup definers revoked from PUBLIC/anon/authenticated with service_role
    kept for the one edge-function caller; `get_pending_invite_for_email`
    answers only for the caller's own JWT email (Signup's post-auth call
    unaffected).
- **R20 closed at the constraint, not the code:** the `'cancelling'` write is a
  deliberate two-phase claim (crashed runs stay re-claimable via
  `.in(["escrow","cancelling"])`) — the CHECK constraint was the missing half,
  so it gains the value. `enforce_job_status_transition` only guards
  `jobs.status`, verified, so no trigger change is needed.

R21 (inline banners `6da0fa808`), R22 (`cf2c811f2`), R23/R25 (`384ef643e`)
were closed by the earlier wave.

**R24 closed 2026-08-24 (late) — and it was 7 rows, not one thread.** Data
repair via MCP `execute_sql` (owner test rows only; no migration — this is
data, not schema). The named thread (`a5eed000-…15`: awarded/started stamped
6h after completion) plus four siblings the same sweep surfaced: `…13`'s
awarded tied with started AND after helper_on_the_way, and `…06`/`…10`/`…14`
plus stage-fixtures `bbbb0008-…`/`cccc0008-…` whose `created_at` post-dated
their own completion/dispute ("Posted Aug 18 · Completed Aug 16" on the job
screen). Verified after repair: zero system messages after their job's
completion, zero jobs created after their own end, zero awarded-after-
on-the-way — platform-wide, not just the fixtures.

**Nothing from this audit remains open.** R1–R25 are closed; the standing
decisions (job-photos public bucket, AdminDisputes partial-split execution)
are recorded where they were made.

---

## REPORTED — needs a tone / money / legal / product decision (severity-ranked)

### CRITICAL — trust (load-bearing wall)

**R1 — Any authenticated user can permanently ban any other user.** `public.report_helper_no_show(p_job_id)` (SECURITY DEFINER, granted to `authenticated`) checks only that the caller owns the job — never that the named helper accepted it, that the start time passed, or that two reports came from different posters. The poster fully controls `jobs.helper_id` (the money-lock self-disarms while `payment_status='unpaid'`). Post two throwaway unpaid jobs, set `helper_id = <victim>`, call the RPC twice → victim is `permanently_banned`. Unprivileged, repeatable, irreversible without admin. *Verified against live DB.* Fix shape: require an accepted application, a passed start time, and distinct reporters. **This is release-blocking.**

**R2 — The pgmq email-queue wrappers are ungated.** `read_email_batch` / `enqueue_email` / `delete_email` / `move_to_dlq` (SECURITY DEFINER → `authenticated`, zero authorization, no queue allowlist). Any logged-in user can read every pending outbound email (bulk PII + embedded tokens), inject a message the worker sends *from the platform's domain* (phishing), or delete/timeout messages (delivery DoS). Fix shape: `has_role(auth.uid(),'admin')` + a queue allowlist, or revoke from `authenticated`.

### HIGH — trust / money

**R3 — A poster can mark an unpaid job "escrow funded."** The money-lock only engages once `payment_status <> 'unpaid'`, so the first `unpaid → escrow` write is unguarded. Fires the real "payment secured" notification to the helper and enters `auto-release-payment`. No funds move (`release-payout` re-verifies the PaymentIntent), but it's a turnkey do-the-work-never-get-paid lure and burns admin alerts. Fix: add `boosted_at`/`boost_expires_at`/`is_urgent`/the `escrow` transition to the lock.

**R4 — `get_helper_distances_from_job` deanonymizes home addresses.** SECURITY DEFINER, executable by **anon**, no ownership check, caller controls both the job coords and the `user_ids[]`. Post three jobs at chosen points, query the victim against each, trilaterate to ~100 m. On a platform that sends strangers to homes. Fix: gate to the job's owner / job participants.

**R5 — `release-payout` and `process-scheduled-payouts` pay different cents for the same job.** `Math.round(perHelperBudget * pct)/100` vs `(perHelperBudget * pct)/100` then round. 2,243 (budget, tier) pairs under $200 differ by 1¢; the `payout_transfers` ledger can't reconcile bit-for-bit across the two paths. Fix: one shared `helperCommission()` in `_shared/`.

**R6 — Four payout fallbacks pass `10` where the platform default is `12`.** `process-scheduled-payouts:123`, `create-payment:457,906`, `void-cancelled-payments:66`, `auto-release-payment:153` — `helperFees.ts:33` documents the default as `DEFAULT_TIER_FEE_PERCENT = 12` "so an unexpected value never under-charges the platform." On a tier-read failure the platform under-collects $4 per $200 job. `release-payout` is the one path that does it right (reads `platform_settings`, 500s rather than defaulting).

**R7 — Two entitlement-poll functions revoke paid tiers on a page view.** `check-pro-subscription` (invoked from `useDashboardData` on every dashboard mount) and `check-business-seat-subscription` (every `/business` mount) resolve the Stripe customer with `limit: 1`, and on no-match reach an **unconditional** `subscription_tier: null` write (`check-pro-subscription:173`) — the Supabase `error` is dropped (violates the "never drop the error" rule). A paying subscriber whose first-returned Stripe customer isn't the one holding the sub is downgraded on load. Compounds with the known `subscription_tier` last-write-wins collision (9 writers, no precedence) flagged in-code at `businessSeatGrant.ts:27`.

**R8 — `transfer.created` has no state precondition.** Its three siblings (`transferFailed/Canceled/Reversed`) all guard `.eq("payment_status","released")`; the one handler that *writes* `released` doesn't. A redelivery after a `transfer.failed` resurrects a failed payout to `paid`/`released` → helper permanently unpaid, every dashboard says paid. Fix: `.eq("status","pending")` on the ledger write, `.in("payment_status",["payout_pending","escrow"])` on the job write.

**R9 — `payment_intent.payment_failed` overwrites a funded job to `failed`.** No precondition; an out-of-order/retried failure on a PI that later succeeded flips `escrow → failed`, and `PaymentSuccess.tsx` then tells the poster "no money was ever taken" on funded escrow. Fix: `.in("payment_status",["unpaid",null])`.

**R10 — accepted-bid price is never applied (carried open from 2026-08-19).** `accept_application`/`accept_group_application` write `status`/`helper_id`/`response_deadline` but never copy `applications.proposed_price` into `jobs.budget`; only `respond_to_counter_offer` does. On the `accept_bids` path a poster who accepts a $200 bid funds escrow at the original budget. No live rows prove it yet (code-path gap). Adjacent: `enforce_bid_price_lock` only freezes the bid once viewed/countered, and the poster has whole-row UPDATE on `applications` — a poster who never marks-viewed can rewrite a bid down before accepting.

**R11 — A message recipient can rewrite the sender's messages.** The "mark as read" UPDATE policy (`USING/CHECK auth.uid()=receiver_id`) grants **whole-row** update with no column lock — recipient can rewrite `content`, swap `attachment_url`, clear `flagged_hidden`, set `sender_id`. Fabricated chat evidence in disputes; edited content never re-scans (scan is INSERT-only). Fix: column-lock UPDATE to `read_at` only.

### HIGH — display disagrees with what's charged (the mandate breaches)

**R46 — ~~"Once" sells a 30-day pass and never says so.~~ DISCLOSURE FIXED `4ddc0c5f7`; product question still open.** The in-app Membership tab's billing switch offers *Once · Monthly · Annual* (`SubscriptionTab.tsx:285`), and **"Once" is the default-selected cycle** — so the first thing a Helpr sees is "$5 / $10 / $15 **one-time**". What is actually granted: `checkoutSessionCompleted.ts:61-64` stamps `subscription_expires_at = now + 30 days` for any `billing_cycle === "one_time"` session. The tier silently lapses after a month. **Nowhere on the purchase surface is "30 days" shown** — not on the tier card, not on the switch, not in a footnote (verified by grep across `SubscriptionTab.tsx` / `SubscriptionPage.tsx`: the only expiry string is the post-purchase "expires on <date>" row, visible *after* you have paid). Sitting beside two tabs that genuinely recur, "Once" reads as buy-once-keep-forever; it in fact buys 30 days, priced at the same $10 the Monthly tab charges for the same 30 days — i.e. the two cycles cost the same and only one renews. Compounding it, the tier bullets are written for a subscription and are rendered verbatim under the one-time price: Pro advertises "**1 free Job Boost every month**" (`subscriptionTiers.ts:126`) on a pass that only ever sees one month, and `subscriptionTiers.ts` defines **no one-time price at all** — `proTiers.ts:112` says so outright ("one_time is intentionally excluded: subscriptionTiers.ts defines no one-time…"), so the displayed $5/$10/$15 come from the *monthly* config while the charge comes from a separate one-time Stripe price. This is the mandate breach in its purest form — the entitlement the app displays is not the entitlement it sells — and it is also the concrete substance behind R27 (Terms describe recurring subscriptions only) and the App-Store 3.1.1 question. **Money + legal → reported, not touched.** Minimum fix is disclosure ("30-day pass"); the real decision is whether "Once" should exist.

**R12 — Instant-payout upsell invents a $1 flat fee that isn't charged.** `EarningsTab.tsx:470` — `"Stripe's standard 3% + $1 fee applies"`. The real fee is a flat 3%, no fixed add-on (`instantPayoutFee.ts`); at the $25 minimum it quotes $1.75 vs the actual $0.75 — a $1 overstatement, in the sheet that sells the perk, contradicting the dialog one tap later. Also mis-attributes a Helpr fee to Stripe. Replacement: derive from `instantPayoutFeeLabel()`.

**R13 — Boost dialog shows $3 to Basic/Pro posters charged $2.40.** `JobBoostDialog.tsx:32` gates the discount on `subTier==="elite"` only, but `create-boost-payment` applies the 20% discount to basic+pro. They see $3.00 + a "Free with Elite" upsell, then get charged $2.40 — a 60¢ gap and a silently-withheld advertised perk. `BOOST_DISCOUNT_PCT` has no client mirror. Replacement: mirror the constant, derive the shown price.

**R14 — The 1099 tax banner tells helpers $600, the same screen's disclosure says $20,000.** `EarningsTab.tsx:182` / `ThresholdBanner.tsx:42` fire "$600 mark" while `EarningsTab.tsx:458` and both legal pages say the $600 step-down was repealed and the threshold is $20k/200-tx federal. Any helper past $600 is told they may get a 1099-K they won't. Replacement: one shared threshold constant; correct the stale comment at `EarningsTab.tsx:171`.

**R15 — Payout headlines round UP instead of flooring.** `formatPriceFloor` exists for exactly this ("a payout figure may never read above the payout") and has **one** consumer (`JobPrice.tsx:113`); seven take-home headlines use `formatPrice` (rounds up): `IdentityHeader.tsx:484`, `WorkRecord.tsx:387` (labelled an "official earnings document"), `HelprWrapped.tsx:259`, `MonthlyGoalCard.tsx:91,233,258,259`, `RecentTransfers.tsx:22` (the actual Stripe-sent ledger). Up to 49¢ over per figure. Replacement: `formatPriceFloor` on every take-home headline; `JobCard` aria-label vs chip also disagree (a11y parity break).

**R16 — Helper analytics + admin payout math recompute from gross budget.** `fetchAnalytics.ts:87` sums full `budget` with no group split, no frozen `helper_fee_percent`, no urgent bonus → "Earnings by month" shows $300 on a 3-helper job that paid ~$88. `useAdminUserSummaries.ts:117` + `userDetail/JobsTab.tsx` use `|| 10` (should be `?? 10`), so a comped $0-fee job silently becomes 10%. Replacement: import `helperTakeHomeDollars`/`sumHelperTakeHomeDollars`.

### MEDIUM — reconciliation, parity, moderation

- **R17** `weekly-helper-report:108` emails group-job helpers N× their real earnings (no `/helpersCount`). Tips tile (`EarningsTab.tsx:146`) shows gross, helper receives net-of-Stripe (~$0.88 over per $20 tip). Admin dispute slider (`DisputeCard.tsx:179`) quotes dollars that never move at partial splits.
- **R18 — parity guards that don't bind.** `escrowTiming.parity.test.ts` asserts constants against literals restated *in the test*; the cron (`auto-release-payment`) hardcodes `48`/`24h` and imports nothing — change the cron, every test still passes. `earlyAccess.parity.test.ts` pins a migration superseded 2026-08-23. `formatPayoutDollars`↔`formatPriceFloor` byte-identical, no test. `PRODUCT_TO_TIER` copy-pasted into `check-pro-subscription` (drops `ONE_TIME_PRODUCTS`). `get_payout_batches` SQL hardcodes `0.029`. Fix pattern exists: `seatLimitLadder.parity.test.ts` resolves the *latest* migration and asserts non-empty.
- **R19 — latent RLS/PII leaks (currently 0 rows, fire on first use).** `evacuation_pets` anon-readable incl. `destination_address` (fires during a hurricane). `job-photos` is a **public** storage bucket behind a participant-scoped policy that a public URL bypasses. `reviews` SELECT is `USING(true)` (defeats moderation `status`). `is_licensed`/`is_insured` outside the `prevent_self_escalation` denylist → forgeable "Licensed/Insured" badges. 12 cron/sweep RPCs (`cleanup_stripe_webhook_events` destroys the idempotency ledger) executable by any authenticated user. `get_pending_invite_for_email` is an email-existence oracle.
- **R20 — `cancel_escrow` writes an illegal `payment_status='cancelling'`** the CHECK constraint rejects; path is currently unwired (no `src/` caller) but fails 100% the moment it is.

- **R21 — post-redirect confirmations are now silent (surfaced by the toast sweep).** Three flows had toast-only feedback on a channel that no longer renders, so they now complete with *zero* acknowledgement: returning from Stripe Connect onboarding (`?connect=success`, `PaymentTab.tsx`), returning from Pro subscription checkout (`?pro=success`, `UserProfile.tsx`), and the 30-minute inactivity sign-out (`useSessionTimeout.ts`), which dumps the user at `/login` with no explanation of why they were logged out. The dead branches were removed with the sweep; the *feedback gap* is the finding. Fixing it needs a surface decision (inline banner on the destination screen, not a toast) — reported, not fixed, on your call.

- **R22 — measured contrast misses, all brand tokens (Chrome, 1440, both themes; WCAG AA).** Computed against the worst gradient stop under the text, decorative `aria-hidden` numerals excluded, pseudo-element pills verified by screenshot before dismissal. Four patterns, each uniform site-wide, all needing a colour-token call, not a per-page edit:
  1. **Primary CTA ink-on-olive (dark): 4.33 vs 4.5.** `rgb(20,22,26)` on `rgb(122,128,77)` — every "Get Started"/"Post a Job"/submit button in dark mode is 0.17 under AA. One token nudge fixes every page.
  2. **Sienna accents on dark footer: 3.80 vs 4.5.** `rgb(212,103,53)` on `rgb(43,45,49)` — footer column headers ("Company"/"Legal"/"Follow") and the "· LA" wordmark suffix, every page.
  3. **Gold category label (light): 2.37 vs 4.5.** `rgb(196,142,49)` on `rgb(234,232,234)` — the Help Center "Payments & Escrow" uppercase label; worst offender measured.
  4. **Hero toggle unselected state: 3.19 light / 4.06 dark vs 4.5.** "I want to work" at 75% olivewood alpha.

- **R23 — chunk-load failures masquerade as data errors.** A stale deploy makes SectionErrorBoundary render "Couldn't load your posts." for what is actually a failed dynamic import (`Failed to fetch dynamically imported module`). The boundary should detect chunk errors and show the existing "Update ready — reload" treatment. (The brief's SectionErrorBoundary trap, alive in one more spot; reproduced live during the overnight sweep.)
- **R24 — demo seed rows carry impossible chronology.** The seeded thread shows "Job awarded"/"Work started" dated after completion; buildTimeline's sort is correct, the fixture stamps are wrong. Cosmetic, owner's test data only.
- **R25 — the Done-stage action row omits the action its own copy names.** The auto-release countdown says "Approve & complete or request a revision before the timer expires" while the row offers only Message · Approve — Request Revision is reachable nowhere on the card at the stage the copy describes. Add the button or soften the copy.

### Open decisions (need your call — see pop-up)

- ~~**The ~230 suppressed toasts.**~~ **RESOLVED 2026-08-24.** Owner chose delete. 222 dead calls removed across 132 files (`93791628f`). Removing them orphaned the work that only fed them — empty `if/else` shells, a clipboard flag that only chose wording, and a per-login `profiles` round-trip that existed to greet by first name — all removed with them; net new lint debt zero. **Three were deliberately kept and the channel reopened for them** (`fc4b395bb`): a toast carrying an `action` is an affordance, not a confirmation (Undo-attachment, and the two "View" jumps), so `toastPolicy` now passes actionable toasts through and still swallows every actionless one. Pinned by `toastPolicy.test.ts`.
- ~~**lowercase "helper" across admin**~~ **RESOLVED 2026-08-24.** Owner: admins are users too. Swept to "Helpr" (`f4e8f1a5c`) across empty states, the IDV flag description, the formal-warning placeholder, the analytics funnel title and the dispute-split labels + `aria-label`. Internal identifiers (role strings, filter ids, CSV headers) deliberately left lowercase.
- **Document `<title>` conventions** mix "Dashboard — Helpr" vs "Complete your profile — Helpr" (Title vs sentence). Pick one.

---

## Deliberately NOT touched, and why

- **Every R-item above** — each touches money, legal, auth, or a product decision; the brief says flag, never silently reword/refactor. They are for your triage, not for a mechanical pass.
- **The visual / interaction / a11y lane** — not run this pass (see coverage). No screenshots taken, so per the standard nothing visual is claimed clean.
- **Eyebrows / subtitles** — retired (`display:none`); did not "restore" any.
- **`ForBusiness.tsx` local fee/seat duplication** — behind `BUSINESS_ENABLED=false`; dormant, reported not changed.
- **`statusLabels.ts`** — test-enforced; untouched.
- **Landing hero H1/subhead** — locked.

---

## Coverage manifest

| lane | who | status |
|---|---|---|
| **Language / copy / voice** | lead (foreground) | **DONE** — toasts, empty/error titles, "Couldn't" voice, button casing, canonical noun (src + edge). Applied list above. Open: suppressed toasts, admin "helper", doc titles (decisions). |
| **Money formulas** | opus sub-agent | **DONE (report)** — 4 seeds confirmed, ~15 recomputation sites, formatting-rule violations. R5/R6/R12–R16 above. Not applied (money = flag-not-fix). |
| **Client/edge parity** | opus sub-agent | **DONE (report)** — 15 parity tests classified (9 real, 3 inert), 21-row duplicate register. R18. |
| **Stripe / webhooks** | opus sub-agent | **DONE (report)** — 16 handlers, writer maps for 4 columns, dedupe sound. R3/R7/R8/R9. Two items VERIFY-LIVE (`charge.refunds` payload; `cancelling` constraint). |
| **Authorization / RLS** | opus sub-agent | **DONE (report), live-verified** — 93 tables, 174 definer fns, 10 buckets. R1/R2/R4/R10/R11/R19/R20. |
| **Visual / interaction / a11y** | — | **NOT RUN** — 57 routes × 4 widths × 2 themes + iOS sim not swept this pass. The single largest open lane. |

**Not reached, with reason:** the visual lane (browser pane + iOS sim) — deferred
to keep this pass to language + engineering-report; it is the recommended next
pass. Live-Stripe and live-mutation verification — excluded by the read-only
engineering brief; R-items flagged VERIFY-LIVE should be confirmed against
`pg_constraint` / a real webhook payload before code changes land.

**Release state:** typecheck + 1734 vitest green at HEAD; E2E fix pushed (CI
confirmation pending at time of writing). PR-ceremony-free per project rules.

---

# Web-surface lane — overnight 2026-08-24→25 (Fable, parallel to the iOS-sim session)

**Scope:** the WEBSITE only, per the overnight brief — every guest route and every
authed route (18 profile tabs, 27 admin views, 16 core/feature routes) in Chrome
at 375 / 768 / 1440 / 1536, light + dark, driven headlessly against the running
lh-dev server plus line-level source reads of the guest funnel. The iOS sim was
not touched. Numbering continues from R25 (R23–R25 were assigned by the parallel
session's overnight log above).

**Method notes for whoever picks this up:** screenshots + per-cell metrics
(title, h1, horizontal overflow, console errors) live in the session scratchpad
(`shots-authed/`, `metrics-authed.jsonl`) — scratchpads get wiped between
sessions, so re-run the sweep script rather than hunting for old files. Two
infrastructure traps burned real time tonight and are worth knowing: (1)
`node_modules/.vite/deps` was found EMPTY under the running dev server — every
cold lazy route 504'd ("Outdated Optimize Dep") until a `touch vite.config.ts`
forced an in-process Vite restart; if "Try again" boundaries appear app-wide,
check that cache before blaming code. (2) Committing to the repo while a
long-lived tab is open makes that tab's next lazy import fail its chunk fetch —
which now correctly surfaces as the "Update ready — reload" screen (R23's fix,
seen working in the wild tonight).

## APPLIED this lane (each gated typecheck + vitest, pushed direct to main)

| commit | what |
|---|---|
| `6c15357de` | **Un-broke Vitest on main.** `f29ebfbe0` (parallel session) deleted `supabase/functions/spawn-recurring-jobs` but left `recurringSeries.test.ts` reading the deleted file — the Test workflow had been red on every push since. The guard's intent survives stronger: the test now pins the function's ABSENCE (a reappearing second spawn path fails CI), and the orphaned `config.toml` entry went with it. |
| `24aa5b444` | **R26 fix — CSP allowlists.** The Capacitor meta-CSP (`index.html`) never allowed `cdn.apple-mapkit.com` / `*.apple-mapkit.com`, so every map in the shipped native app dies at the CSP layer (dev shows the same; prod web was already fine via `vercel.json`). It also blocked `api.pwnedpasswords.com` — the signup leaked-password check was silently skipped — and prod web blocked that same call, so the HIBP domain was added to `vercel.json` connect-src too. Pure allowlist additions for calls the shipped code already makes. |
| `03dacb8c2` | **Vitest no longer breaks the running dev server.** Vitest and `vite dev` shared `node_modules/.vite`; vitest clears that cache on start, so every local `vitest run` deleted the live server's optimized deps and each cold lazy route 504'd ("Outdated Optimize Dep") until re-optimize — surfacing to users as app-wide "Update ready"/"Try again" screens. `vitest.config.ts` now pins `cacheDir: node_modules/.vitest`. This was the root cause of tonight's mid-sweep 504 cascade (not the source commits themselves). |
| `743ddc615` | **SecurityTab dark-mode glare.** The active-sessions rows used hardcoded `hsla(0,0%,100%,.55)` white glass — correct on light, glaring on dark. Swapped to `hsl(var(--ivory-sand)/0.55)`; measured resolution: light = identical `rgba(255,255,255,.55)` (zero visual change), dark = `rgba(29,32,37,.55)`. Caught visually in the dark sweep block. |

## NEW FINDINGS — R26 onward

### HIGH

**R26 — CSP blocked Apple MapKit (native) and the HIBP breach check (native + prod web). FIXED, see applied table.** Left here as the record: this was why the map pane was dead and why weak-password signups sailed through the breach check. The `vercel.json` change deploys with the next Vercel build; the meta-CSP change ships with the next native build — the iOS lane should re-verify maps render in the sim after a rebuild.

**R27 — One Membership, two storefronts.** The in-app tab (`/profile?tab=subscription`, `SubscriptionTab.tsx`) sells FOUR tiers (Free/Basic/Pro/Elite) across THREE billing modes (Once / Monthly / Annual, with "$5/$10/$15 one-time" price lines); the public `/subscription` page (`SubscriptionPage.tsx`) sells THREE tiers (no Basic) across TWO modes (no Once). The public page's Basic-exclusion rationale is a comment claiming Basic has placeholder Stripe prices — **stale**: `_shared/proTiers.ts:40` now carries real, verified-live price IDs for every tier × cycle including one-time. So today a member is offered one-time purchases and a Basic tier that a logged-out visitor is told don't exist, and the Terms fee ladder (which lists Basic 11%) matches the in-app view, not the public one. Tonight's `fix(subscription)`→revert churn by the parallel session sits in this exact area. Needs a product call: either the public page gains Basic + Once, or the in-app tab loses them — then delete the stale comment either way.

**R28 — Signup verification email can take 5+ minutes; the auth hook can miss its deadline entirely.** `auth-email-hook` renders the React Email template TWICE (html + plaintext) plus 3 DB round-trips inside Supabase's ~5s auth-hook budget — ~2s warm, and a cold start was measured blowing the deadline (5.21s). Worse for the funnel: it only ENQUEUES to pgmq, and `process-email-queue` drains **every 5 minutes** — so a brand-new signup sits on "Check Your Email" for up to 5 min in the best case. Fix shape: hook writes raw template props to the queue and returns (render moves into the worker), and the queue cron tightens for `auth_emails` (or the hook sends auth mail synchronously via Resend and leaves the queue for the rest).

**R29 — ~~A keyboard user cannot create an account.~~ RESOLVED at HEAD within the hour** — the avatar input is now `sr-only` with a `focus-within` ring and full aria wiring; verified in source ~03:20. (Original finding kept for the record:) The required profile-photo control on signup step 2 is `<input id="avatar" type="file" className="hidden">` inside a non-focusable label (`SignupStep2.tsx:186-194`) — removed from tab order — while `validateAboutYouStep` makes the photo REQUIRED and the submit stays disabled without it. WCAG 2.1.1 failure on the funnel's critical path. Fix: `sr-only` (not `hidden`) input with a visible `focus-within` ring, or a real button that proxies `input.click()`.

### MEDIUM

**R30 — ~~RESOLVED at HEAD~~ (step 2 submit is now `disabled={loading}` only; Support's is `disabled={sending || identityPending}` — both reveal-all-errors branches are reachable again). Original: Step 2 and Support regress to the wordless-disabled-button dead end that `41ff2120e` just fixed on step 1.** Signup step 2's Create Account is `disabled` until avatar/name/DOB validate (`SignupStep2.tsx:320`), so the collect-all-errors branch in `validateAboutYouStep` is unreachable — a user faces a grey button and red asterisks. Same pattern on Support's submit (`Support.tsx:532`), whose reveal-all-errors branch is equally dead code. Pick the step-1 pattern (button stays active, tap names what's missing) for both.

**R31 — ~~RESOLVED at HEAD~~ (cooldown now arms only once a real `signUp` fires — the fix carries its own comment). Original: The signup cooldown punishes recovery.** `SIGNUP_COOLDOWN_KEY` is armed BEFORE the attempt (`Signup.tsx:287-296`), so a password rejected by the HIBP check or a network error costs the user a 60s "Too many attempts" lockout on their immediate corrected retry. Arm it only after `signUp` actually fires.

**R32 — "Already registered" is a silent teleport to Sign In.** `Signup.tsx:318-329` navigates to `/login` with no message (the comment claims a neutral line is shown; none is). Anti-enumeration doesn't require silence — show the same neutral line either way.

**R33 — PARTLY RESOLVED at HEAD.** The gate-screen half is fixed: all three account gates now redirect with `{replace:true}` and AccountDenied guards on `isLoading` (no flash). What remains: `Login.tsx` documents that `?redirect=` is used "ONLY to explain the bounce in the header copy" and that landing on /dashboard is deliberate — but the explainer copy is still unimplemented, so the param remains write-only. Either write the one line of header copy or delete the param end-to-end. Original finding: `ProtectedRoute` encodes the destination into `/login?redirect=…`; `Login.tsx:86-93` never reads it (hardcoded `/dashboard`) — a guest's deep link into any protected route is silently dropped (only the job-intent path survives). Related from the same enumeration pass: `/account-denied` and `/account-banned` paint their full card to a signed-out visitor BEFORE the redirect effect fires (`AccountDenied.tsx:18-23`, `AccountBanned.tsx:20-26` — `/account-pending` shows a skeleton, the right pattern), and all three gate redirects omit `{replace:true}`, so browser Back returns to the gate and re-bounces — a history trap.

**R34 — Wrapped's stat tiles render blank.** `/wrapped` ("Your 2026 so far") shows the headline card with four EMPTY tiles for this zero-activity account — no numbers, no labels, no zero-state copy (375 light, screenshot). If that's the loading skeleton it never resolved within ~2.5s on localhost; either way a new user sees a blank year-in-review. Needs a real zero-state ("Complete your first job and we'll start counting").

### LOW / polish

- **R35 — ~~mostly RESOLVED at HEAD~~**: step-1 error ids/roles/describedby, ForgotPassword's error wiring + dead imports, DatePickerField's describedby forwarding, Support's subject describedby, and the toggle label are all fixed in source as of ~03:20. Still open: ResetPassword remains on `usePageTitle` (no meta/canonical) and still lacks a show/hide toggle. Original batch: step-1 email/password inline errors are bare `<p>`s with no `id`/`role`/`aria-describedby` (SignupStep1.tsx:187-192,224-228 — step 2's `FieldError` does it right); same on ForgotPassword's email error (170-185); Support's Subject is the one field missing `aria-describedby` (485-494); `DatePickerField` doesn't forward `aria-describedby` so `dob-error` never associates (SignupStep2.tsx:234-243); the step-1 password toggle says "Show password**s**" for one field (213, Login uses singular); ForgotPassword imports `AuthBrandPane`/`HelprMark` and uses neither.
- **R36 — ~~RESOLVED at HEAD~~** (`claimErr` is now reported to monitoring). Original: invite auto-claim can fail silently. The `business_members` claim `.update()` result is never checked (`Signup.tsx:373-377`) — a dropped Supabase error in the exact block whose own comments lecture about reading errors (house rule violation).
- **R37 — login lockout counts network timeouts as failed attempts.** The 15s `signInWithTimeout` rejection lands in the same attempt ledger as a wrong password (`Login.tsx:133-150`) — flaky wifi can soft-lock a legitimate user for 5 min. Count only credential failures.
- **R38 — "No applications yet." keeps the period the empty-state ruling dropped.** The My Jobs empty title carries terminal punctuation; Messages' "No messages yet" (and the 1fa2f06 sweep) settled fragment titles take none. One character, but it's in the Activity surface the sim lane is actively editing — flagged instead of fixed to avoid a collision.
- **R39 — payment-success's no-reference title truncates as "We couldn't confirm your …" at 375.** The one-line-title rule cuts it mid-phrase, and the eyebrow directly above already reads "PAYMENT NOT CONFIRMED". Shorten the h1 (e.g. "Payment not confirmed") — the body copy ("Please don't pay again…") is excellent and carries the message.
- **R40 — dashboard console warnings.** React "Cannot update a component while rendering a different component" plus Radix "Select is changing from uncontrolled to controlled" ×3 fire on dashboard mount (375 capture) — technical-health noise that will mask real regressions in Sentry.
- **R42 — ~~admin calls the job poster "Customer" in 11 user-facing strings.~~ FIXED `dc334a052`.** Canonical vocabulary is **poster** (the DisputeCard's own variable is literally `posterName`), yet the admin console reads "Customer:" beside "Helpr:" in the dispute queue (`adminDisputes/DisputeCard.tsx:71`). **The contradiction is visible within one screenshot**: on `/admin?view=disputes` the "FILED BY" filter offers *Both · Poster · Helpr* while the very first card below it reads "Customer: Layla F. · Helpr: Camille R." — the same person, two different nouns, three rows apart. Full inventory, "Refund the Customer?" / "Refund Customer" on the money actions (`AdminDisputes.tsx:529,540`, `adminJobs/RefundJobDialog.tsx:43`, `adminJobs/JobDetailDialog.tsx:205`, `DisputeCard.tsx:174`, `adminJobs/StatusOverrideDialog.tsx:76`), "Customer activation" on the funnel (`AdminAnalytics.tsx:560`), "Customer pays" / "Customer service fee" in settings (`AdminSettings.tsx:341,354`) and "Posted (Customer)" in the user-detail filter (`userDetail/JobsTab.tsx:99`). Exactly the class the owner already ruled on for admin "helper"→"Helpr" (`f4e8f1a5c`, "admins are users too") — but several instances sit on refund buttons, and a half-swept vocabulary is worse than a consistent one, so this is one decision to make in a single pass. CSV headers (`AdminExport.tsx:92,111`) are machine-facing and should stay. **Not applied — your call on the noun.**
- **R43 — prod is majority test data, and every admin money figure counts it.** Measured against the live DB tonight: **30 of 61 `jobs` rows are seed/audit fixtures** (`a5eed000…` / `b0b00001…` ids, `AUDIT*` titles) and **20 of 23 `profiles` are test accounts** (mailinator/test/audit). Of the $4,875 in escrow/released/paid budget the admin tiles aggregate, **$2,795 (57%) is fake**. Consequences visible on `/admin`: "Payments Collected $5,289.34", "Platform Profit $923.24", "Active Jobs 26", the subscriber-distribution donut, the analytics funnel, and — most consequentially — the **parish tax-reserve estimate**, which is an IRS-facing number the owner is invited to act on. Also the source of the honest-looking "3 jobs marked released · no settled transfers" warning (all three are seed rows, so it is NOT a live payout break — verified). This is a launch-gating data decision, not a code defect: decide what gets purged vs retained, and whether admin aggregates should exclude a `is_seed`/test-account flag so the numbers stay trustworthy after launch. **Reported only — no prod rows touched.**
- **R44 — ~~job-card city truncates inconsistently across sibling cards.~~ FIXED `e7d1b7b81`.** In the dashboard feed the same parish renders "Lafayette", "Lafayet…" and "Lafay…" on adjacent cards, because the meta row is `flex-nowrap overflow-hidden` and the city (`truncate max-w-[150px]`, `dashboard/JobCard.tsx:478-482`) is the only shrinkable child — so any card carrying a rating chip eats the city instead. Legible but visibly ragged, and on a *local* marketplace the parish is arguably higher-signal than the exact minute. Options: give the city a `min-w` floor, drop the time before the city under pressure, or accept it. Design judgment → reported.
- **R45 — ~~Gift Card hides half its occasions on desktop while 60% of the screen sits empty.~~ FIXED `e7d1b7b81`.** The occasion picker is a phone scroll-rail (`flex overflow-x-auto no-scrollbar` + a right-edge fade mask, `PayItForward.tsx:430`) shipped unchanged to wide viewports. At 1440 it renders "Thank you · Birthday · Congratulation…" — clipped mid-word, with 3 of the 6 occasions (`giftCardDesigns.ts`) reachable only by a horizontal scroll gesture that has **no visible control on desktop** (the scrollbar is suppressed and the fade is the sole affordance). Meanwhile the form is pinned in a ~430px left column and the right two-thirds holds only two empty-state strips — so the space to simply wrap all six chips is right there. Since each occasion swaps the card art *and* the note placeholder, hidden occasions are hidden product. Fix shape: `flex-wrap` (drop the rail + mask) at `sm:`+ and let the two-column split rebalance. Layout/design judgment → reported, not changed.
- **R47 — the unrestricted MapKit token is still shipped, and the origin-locked one is only a preference.** `mapkit-token`'s own header explains why it exists: the build-time token "is UNRESTRICTED… anybody [can use it against] Apple account", so the function mints origin-locked one-hour tokens instead. But `useMapKitJs.resolveToken()` (`src/hooks/useMapKitJs.ts:117-120`) is `const served = await fetchServerToken(); if (served) return served; return getBuildTimeToken();` — every failure path of the edge function (non-2xx, the 6s abort, any throw → all `return null`) silently falls back to `VITE_APPLE_MAPKIT_TOKEN`, which is compiled into the client bundle and extractable by any visitor. Confirmed live in the browser console on `/dashboard`: **"[MapKit] Authorization token without origin restriction is not recommended in production environments."** — i.e. the fallback is what actually served the map. The hardening is real but bypassable by making the edge function hiccup, and the unrestricted token ships to production either way. Decision needed because removing the fallback trades a quota/billing exposure for maps that break whenever the function is down: (a) drop the build-time token and let maps degrade to the existing "missing-token" state, (b) keep it but issue a *separate* origin-restricted key for the bundle, or (c) accept it. **Ops/cost decision → reported, not changed.**
- **R41 — title/meta stragglers.** Dominant pattern is "X — Helpr"; `Support.tsx:182` appends "| Louisiana's Local Job Partner" (only non-root page that does); `ResetPassword` is the only funnel page on `usePageTitle` without meta/canonical, and the only password field in the funnel without a show/hide toggle; `HelpCenter.tsx` header comments describe a search UI that was removed.

## Coverage manifest — web lane

**Guest surface (signed out):** every public route enumerated from `App.tsx`
(landing, login incl. MFA-state source-read, signup steps 1–2, forgot/reset
password incl. all four token states, signup-pending, account-pending/denied/
banned, support incl. 3 topics, legal ×3 tabs + search + anchors, /jobs +
?job= dialog, /jobs/:id, /browse, /subscription, /help, 404) — swept at
375/1440 visually + 768/1536 by metrics in both themes pre-restart, plus a
line-level source audit of every funnel form (report reproduced above as
R29–R33/R35–R37/R41). The session restart destroyed the guest screenshot
archive; guest METRICS (overflow/console/title) were clean at all four widths.

**Authed surface (test account `Audit Weblane`, admin-elevated) — FINAL:** the
sweep ran to completion: **480 cells captured** (61 routes × 4 widths × 2
themes, minus the handful the mid-sweep commit polluted). Metrics verdict
across every captured cell: **zero horizontal overflow, zero stray console
errors** (after excluding the two known dev-only warnings and the mid-sweep
504 pollution, whose root cause is now fixed at `03dacb8c2`). Visually
reviewed before the environment was destroyed: all 18 profile tabs, the five
bottom-nav destinations, gift-card/benefits/wrapped/payment-success, and the
admin home/users/people/payouts views across 375/768/1440 light plus the dark
block samples — the one dark-block defect found (SecurityTab white glass) is
fixed at `743ddc615`. What did NOT survive: the screenshot/metrics archive and
the recapture of the ~8 polluted dark cells — two Claude Code restarts plus a
scratchpad cleanup deleted the artifacts and the sweep tooling before the
per-cell table could be written into this doc. The findings themselves are all
recorded above; nothing found was lost. **Morning follow-up (mechanical, ~1
hr): one clean re-run of the authed sweep (rebuild the small Playwright driver
+ sweep script; keep `npx vitest run` away from it — or rely on `03dacb8c2`
which removes that hazard) to produce the archival per-cell table and the
few dark cells never visually reviewed.**

**Excluded by brief:** iOS simulator (other session's lane); live-Stripe charge
paths (prod keys are LIVE — no test-mode environment exists tonight); prod-DB
mutations beyond the marked test account.

**Open for the morning (decisions, not defects):** R27 storefront unification;
R28 email-latency fix shape (owner may prefer synchronous auth mail); whether
"Once" memberships should exist at all publicly (product/legal — Terms describe
recurring subscriptions).

---

## OWNER-REPORTED QUEUE — 2026-08-25 afternoon (live walkthrough)

Reported by the owner while driving the site. Captured verbatim-in-substance so
none is lost; ✅ = fixed and verified, ⏳ = open.

### Fixed
- ✅ **Pages open wide then shrink when the side panel is there / landing "loads
  weird and jumps".** ONE root cause: `useAppShellViewport` set
  `web-desktop` / `app-shell` / `desktop-rail` in a `useEffect`, i.e. after
  first paint, so every desktop page painted full-width then reflowed 248px
  narrower. Now applied synchronously pre-paint (`prePaintShellClasses.ts`,
  `2662ce898`). Measured after: **CLS 0.0000, 0 layout shifts** on `/`,
  `/profile`, `/help`, `/legal` at 1440.
- ✅ **"Report user" not Title Case** — and the confirmation "Thanks — we've got
  it." Both fixed (`c9cb11a5f`). *Why it was missed:* the title is computed as
  `` `Report ${reportedType}` `` from the type union, so the literal string
  never existed in source for the lexical casing sweep to find; it rendered
  lowercase for all five report types.
- ✅ **Admin money figures counted fixture data** — `is_seed` flag shipped and
  backfilled (54 seed / 4 real jobs; 20 seed / 3 real profiles), wired into 21
  aggregate queries incl. the quarterly tax reserve.

### Open — triaged, not yet fixed
- ✅ **Block vs Report use different dialog shells — FIXED (`8ad6c06e1`).**
  `ReportDialog`, `BlockUserDialog`, and `MuteSheet` all now use
  `Dialog`+`DialogContent`+`DialogHero`.
- ⏳ **Browse Jobs → 404** and **Login → 404 then refreshes in.** Production
  deployments are all READY on the current commit and `vercel.json`'s SPA
  rewrite is correct, so this is NOT a stale deploy. Prime suspect is the
  service worker: `navigateFallback` is deliberately disabled and navigations
  run NetworkFirst, so a returning user on an old SW can be served a stale or
  failed navigation. Needs reproduction with SW inspection.
- ⏳ **"A lot of things need to be done twice before they work"** and **the Home
  filter button doesn't scroll until you click out and back in** — likely the
  same class (first interaction lost). High value: it makes the whole app feel
  broken.
- ✅ Help Center gap/collapsed tabs — FIXED (`9c34369d5`).
- ✅ Legal tab bar spacing / search left — FIXED (`2805ee382`).
- ✅ Public profile layout (name/location right of avatar) — FIXED
  (`372981c68`, `0ffe99fb1`). Reviews-tab blank state also fixed
  (`src/pages/UserProfile.tsx` — real empty state instead of 3 blank tabs).
- ✅ Job card: Verified badge removed, countdown moved to meta line — FIXED
  (`d4c2f769b`). Done-stage Review/Tip gating is correct-by-design (unlocks
  at Approve, which is the escrow release); an explainer was added
  (`3a6a46a5f`) instead of exposing the actions early.
- ✅ Toasts/error popups need a dismiss (X) before they fade — FIXED, Sonner
  `<Toaster>` `closeButton` (`src/components/ui/sonner.tsx`).
- ✅ Search field renders two X buttons — FIXED, native WebKit search-cancel
  icon suppressed in `src/index.css`, leaving only the custom X.
- ✅ Messages should open to Unread, not All — FIXED (`c3d508bfb`),
  `defaultInboxTab()` opens Unread whenever there is any.
- ✅ **Can't file a dispute; can't report a no-show — FIXED (`2d1faf935`).**
  Guards were correct and untouched (funded/start-passed/one-per-job); the
  defect was the precondition codes never surfacing to the user. Shared
  mapper in `src/lib/lifecycleErrors.ts` now turns codes into human copy.
- ⏳ Shared job link for a signed-out visitor: confirm `/jobs/:id` preview →
  signup → returns to that job rather than dropping the destination.
- ⏳ Post + Jobs pages "are bad" — needs the deep pass.
- ⏳ Deep landing + footer audit (requested; not yet run as its own pass).

---

## Session close — 2026-08-26 (decisions taken, and what is blocked on you)

### Decided and shipped

- **R47 MapKit — owner chose "secrets first, then remove".** Verified live this
  session: `POST /functions/v1/mapkit-token` still answers
  `503 {"error":"not_configured","detail":"Set APPLE_MAPKIT_PRIVATE_KEY,
  APPLE_MAPKIT_KEY_ID and APPLE_MAPKIT_TEAM_ID."}`. So the origin-locked path
  has **never minted a token**, and removing the fallback today would not
  degrade maps "if the function goes down" — it would break every map in
  production immediately. Removal is therefore sequenced AFTER the secrets
  exist. **Not yet applied.** See "Blocked on you" below.
- **Membership "Once" — owner: "just add a once toggle next to monthly and
  annual and wire it up".** Done (`b83f49d24`). The public storefront now
  offers the same three cycles as the in-app tab, closing the R27 divergence in
  the direction of showing the pass publicly. The pricing incoherence itself is
  **unchanged and deliberate**: a Once pass still costs the same as one month
  (`TIER_PERKS.price` feeds both), so it remains strictly worse value than
  Monthly for the buyer. Two of the three copy problems that created were
  fixed, mirroring what the in-app tab already did — the 30-day explainer, the
  "1 free Job Boost every month" → "for your 30 days" rewrite, and "Buy"
  instead of "Upgrade".
- **Seed rows — owner: keep visible until launch.** Unchanged. `is_seed` exists,
  admin aggregates already exclude it, and `npm run check:launch` now fails a
  release build while `SHOW_SEED_JOBS_PUBLICLY` is still `true`.

### Still wrong, and knowingly so

- **Elite's Once bullet still promises a cadence the pass cannot reach:**
  "Reliability Shield — first strike every 6 months forgiven", rendered under a
  30-day pass. The rewrite that fixes Pro's bullet only matches a trailing
  "every month", and this string has "forgiven" after the cadence. Reworded
  copy is a product-voice call, so it is reported rather than guessed at. Same
  limitation exists in the in-app tab.
- **A Once pass costs the same as Monthly.** Now visible on both storefronts
  rather than one. Owner has seen this and chosen to ship it.

### Blocked on you — credentials only you can supply

1. **MapKit secrets** (unblocks the R47 removal). Apple Developer →
   Certificates, Identifiers & Profiles → **Keys** → create a key with
   **MapKit JS** enabled. That gives a `.p8` file (the private key), a **Key
   ID**, and your **Team ID**. Set all three as Supabase Edge Function secrets:
   `APPLE_MAPKIT_PRIVATE_KEY` (full file contents including the BEGIN/END
   lines), `APPLE_MAPKIT_KEY_ID`, `APPLE_MAPKIT_TEAM_ID`. Then the endpoint
   stops 503-ing and the fallback can be deleted safely.
2. **Staging database password** (unblocks schema replication). Dashboard →
   the **Louisiana Helpr — Staging** project → Settings → Database → Reset
   database password. Then `npm run db:staging:link` + `npm run db:staging:push`
   replays all 471 migrations. Expect that replay to be a genuine test of
   whether production is rebuildable from the repo; a failure there is a
   finding, not a setup problem. See `docs/STAGING.md`.
